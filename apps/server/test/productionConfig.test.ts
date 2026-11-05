import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { Miniflare } from 'miniflare';
import { expect, test } from 'vitest';
import { parseServerMessage } from '@robot-puzzle/shared';

const configDirectory = fileURLToPath(new URL('../production/', import.meta.url));
const config = JSON.parse(await readFile(join(configDirectory, 'wrangler.json'), 'utf8'));
const origin = 'https://robot-puzzle.tonyivanov88.workers.dev';

test('production configuration isolates local settings and binds the existing Worker and frontend', () => {
  expect(config.name).toBe('robot-puzzle');
  expect(config.vars).toEqual({ APP_ENV: 'production', ALLOWED_ORIGINS: origin });
  expect(config.workers_dev).toBe(true);
  expect(config.preview_urls).toBe(false);
  expect(config.observability).toEqual({ enabled: false });
  expect(config).not.toHaveProperty('dev');
  expect(config.assets.run_worker_first).toEqual(['/api', '/api/*']);
  expect(config.assets.not_found_handling).toBe('single-page-application');
  expect(resolve(configDirectory, config.assets.directory)).toBe(resolve('..', 'web', 'dist'));
  expect(config.durable_objects.bindings).toEqual([
    { name: 'REGISTRY', class_name: 'Registry' }, { name: 'ROOMS', class_name: 'Room' },
  ]);
  expect(config.migrations).toEqual([{ tag: 'v1', new_sqlite_classes: ['Registry', 'Room'] }]);
});

test('production API bypasses SPA fallback, exact Origin authenticates HTTP/WSS, and local hooks stay unavailable', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'rr-production-config-'));
  let runtime: Miniflare | undefined;
  let socket: WebSocket | undefined;
  try {
    // Small routing fixtures avoid making unit tests depend on an existing web build.
    const assets = join(directory, 'assets');
    await mkdir(assets);
    await writeFile(join(assets, 'index.html'), '<!doctype html><title>Routing fixture</title>');
    await writeFile(join(assets, 'robot-puzzle-sw.js'), '// Static routing fixture');
    const bundled = await build({ entryPoints: [resolve(configDirectory, config.main)],
      bundle: true, write: false, metafile: true, format: 'esm', platform: 'browser',
      target: 'es2022', external: ['cloudflare:workers'] });
    expect(Object.keys(bundled.metafile!.inputs).some((path) => /(?:^|[\\/])(?:test|tests|e2e)[\\/]/.test(path))).toBe(false);
    runtime = new Miniflare({ modules: true, script: bundled.outputFiles[0].text,
      host: '127.0.0.1', port: 0, durableObjectsPersist: join(directory, 'storage'),
      compatibilityDate: config.compatibility_date, bindings: config.vars,
      durableObjects: Object.fromEntries(config.durable_objects.bindings.map((binding: { name: string; class_name: string }) =>
        [binding.name, { className: binding.class_name, useSQLite: true }])),
      assets: { directory: assets,
        routerConfig: { has_user_worker: true, static_routing: { user_worker: config.assets.run_worker_first } },
        assetConfig: { not_found_handling: config.assets.not_found_handling } },
    });
    for (const path of ['/', '/room/ABC234']) {
      const reply = await runtime.dispatchFetch(`${origin}${path}`, { headers: { 'Sec-Fetch-Mode': 'navigate' } });
      expect(reply.status).toBe(200);
      expect(await reply.text()).toContain('Routing fixture');
    }
    const worker = await runtime.dispatchFetch(`${origin}/robot-puzzle-sw.js`);
    expect(worker.headers.get('Content-Type')).toMatch(/javascript/);
    expect(await worker.text()).toBe('// Static routing fixture');
    for (const path of ['/api', '/api/missing', '/api/health', '/api/__test/clock']) {
      const reply = await runtime.dispatchFetch(`${origin}${path}`, { headers: { 'Sec-Fetch-Mode': 'navigate' } });
      expect(reply.status).toBe(404);
      expect(reply.headers.get('Cache-Control')).toBe('no-store');
      expect(await reply.text()).not.toContain('Routing fixture');
    }
    const post = (path: string, command: object, cookie?: string, requestOrigin = origin) => runtime!.dispatchFetch(`${origin}${path}`, {
      // Workerd may close a Node keepalive connection after rejecting an unread
      // POST body. Do not reuse that transport in this deliberate rejection test.
      method: 'POST', headers: { Origin: requestOrigin, 'Content-Type': 'application/json', Connection: 'close', ...(cookie ? { Cookie: cookie } : {}) },
      body: JSON.stringify({ version: 2, commandId: crypto.randomUUID(), command }),
    });
    const refused = await post('/api/session', { type: 'session.open' }, undefined, 'https://localhost:5173');
    expect(refused.status).toBe(403);
    await refused.text();
    const identity = await post('/api/session', { type: 'session.open' });
    expect(identity.status).toBe(200);
    const cookie = identity.headers.get('Set-Cookie')!;
    expect(cookie).toContain('Secure; HttpOnly; SameSite=Lax');
    expect(await identity.json()).toMatchObject({ type: 'session.ready' });
    const created = await post('/api/rooms', { type: 'room.create', nickname: 'Production test' }, cookie.split(';')[0]);
    const parsed = parseServerMessage(await created.json());
    if (!parsed.ok || parsed.value.type !== 'room.entered') throw new Error('Expected room entry');
    const reply = await runtime.dispatchFetch(`${origin}/api/rooms/${parsed.value.roomId}/socket`, {
      headers: { Origin: origin, Cookie: cookie.split(';')[0], Upgrade: 'websocket' },
    });
    expect(reply.status).toBe(101);
    socket = reply.webSocket as unknown as WebSocket;
    const bound = new Promise<unknown>((resolveMessage) => socket!.addEventListener('message', (event) => resolveMessage(JSON.parse(String(event.data))), { once: true }));
    socket.addEventListener('close', () => { if (socket?.readyState === 2) socket.close(); });
    (socket as WebSocket & { accept(): void }).accept();
    expect(await bound).toMatchObject({ type: 'session.bound', roomId: parsed.value.roomId, seatId: parsed.value.seatId });
  } finally {
    socket?.close(1000);
    await runtime?.dispose();
    const target = resolve(directory);
    if (dirname(target) !== resolve(tmpdir()) || !basename(target).startsWith('rr-production-config-')) throw new Error('Unsafe test cleanup');
    await rm(target, { recursive: true, force: true });
  }
});
