import { env, SELF, runInDurableObject } from 'cloudflare:test';
import { describe, expect, test } from 'vitest';
import { initializeStorage } from '../src/storageSchema';
import worker from '../src/index';

declare module 'cloudflare:test' {
  interface ProvidedEnv extends Env {}
}

describe('local Worker boundary', () => {
  test('serves a minimal uncached health response without cookies or CORS', async () => {
    const response = await SELF.fetch('https://example.test/api/health');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok', checkpoint: 'T14.1' });
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(response.headers.has('Set-Cookie')).toBe(false);
    expect(response.headers.has('Access-Control-Allow-Origin')).toBe(false);
  });

  test('health does not accept mutations', async () => {
    const response = await SELF.fetch('https://example.test/api/health', { method: 'POST' });
    expect(response.status).toBe(405);
    expect(response.headers.get('Allow')).toBe('GET');
  });

  test('does not expose the development health route outside local mode', async () => {
    const response = await worker.fetch(new Request('https://example.test/api/health'), {
      ...env, APP_ENV: 'production',
    });
    expect(response.status).toBe(404);
  });

  test('socket route rejects non-GET requests', async () => {
    const response = await SELF.fetch('https://example.test/api/rooms/00000000-0000-4000-8000-000000000001/socket', { method: 'POST' });
    expect(response.status).toBe(405);
    expect(response.headers.has('Set-Cookie')).toBe(false);
  });

  test.each(['/api/registry', '/api/rooms/reset', '/api/rooms/seed', '/unknown'])(
    'does not expose internal/test operations at %s', async (path) => {
      expect((await SELF.fetch(`https://example.test${path}`)).status).toBe(404);
    },
  );
});

describe('SQLite object scaffolds', () => {
  test('both configured bindings initialize independent versioned SQLite storage', async () => {
    const registry = env.REGISTRY.get(env.REGISTRY.idFromName('registry-v1'));
    const room = env.ROOMS.get(env.ROOMS.idFromName('room-a'));
    expect(await registry.getStorageVersion()).toBe(1);
    expect(await room.getStorageVersion()).toBe(1);

    await runInDurableObject(registry, async (_instance, ctx) => {
      await ctx.storage.put('test-marker', 'registry-only');
    });
    await runInDurableObject(room, async (_instance, ctx) => {
      expect(await ctx.storage.get('test-marker')).toBeUndefined();
    });
  });

  test('room instances cannot share each other\'s storage', async () => {
    const first = env.ROOMS.get(env.ROOMS.idFromName('room-a'));
    const second = env.ROOMS.get(env.ROOMS.idFromName('room-b'));
    await runInDurableObject(first, async (_instance, ctx) => {
      await ctx.storage.put('test-marker', 'first-room-only');
    });
    await runInDurableObject(second, async (_instance, ctx) => {
      expect(await ctx.storage.get('test-marker')).toBeUndefined();
    });
  });

  test('test storage is isolated from the earlier test using the same object name', async () => {
    const room = env.ROOMS.get(env.ROOMS.idFromName('room-a'));
    await runInDurableObject(room, async (_instance, ctx) => {
      expect(await ctx.storage.get('test-marker')).toBeUndefined();
    });
  });

  test('initialization is repeatable without deleting existing data', async () => {
    const room = env.ROOMS.get(env.ROOMS.idFromName('schema-repeat'));
    await runInDurableObject(room, async (_instance, ctx) => {
      await ctx.storage.put('test-marker', 'preserved');
      initializeStorage(ctx.storage);
      initializeStorage(ctx.storage);
      expect(await ctx.storage.get('test-marker')).toBe('preserved');
    });
    expect(await room.getStorageVersion()).toBe(1);
  });

  test('unknown schema versions fail without overwriting the saved version or data', async () => {
    const room = env.ROOMS.get(env.ROOMS.idFromName('schema-newer'));
    await runInDurableObject(room, async (_instance, ctx) => {
      ctx.storage.sql.exec('UPDATE app_metadata SET value = 2 WHERE key = ?', 'schema_version');
      await ctx.storage.put('test-marker', 'preserved');
      expect(() => initializeStorage(ctx.storage)).toThrow('Unsupported persisted schema version');
      expect(ctx.storage.sql.exec('SELECT value FROM app_metadata').one()).toEqual({ value: 2 });
      expect(await ctx.storage.get('test-marker')).toBe('preserved');
    });
  });
});
