import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build as bundleWorker } from 'esbuild';
import { Miniflare } from 'miniflare';
import { build as buildWeb } from 'vite';

const root = fileURLToPath(new URL('../../', import.meta.url));
const prefix = 'robot-puzzle-e2e-';
interface ClockNamespace {
  idFromName(name: string): unknown;
  get(id: unknown): { fetch(url: string, init: { method: string; body: string }): Promise<Response> };
}

export interface E2eEnvironment {
  readonly origin: string;
  readonly directory: string;
  readonly clock?: { now(): Promise<number>; advanceTo(now: number, roomId: string): Promise<number> };
  close(): Promise<void>;
}

/** No dev vars/config, existing servers, external certificates or production hooks. */
export async function startEnvironment(controlledTime = false): Promise<E2eEnvironment> {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  let runtime: Miniflare | undefined;
  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    try { await runtime?.dispose(); }
    finally {
      const target = resolve(directory);
      if (dirname(target) !== resolve(tmpdir()) || !basename(target).startsWith(prefix)) throw new Error('Unsafe E2E cleanup target');
      await rm(target, { recursive: true, force: true });
    }
  };
  try {
    const webRoot = join(root, 'web');
    await buildWeb({
      root: webRoot,
      configFile: join(webRoot, 'vite.config.ts'),
      envDir: false,
      mode: 'production',
      logLevel: 'warn',
      build: { outDir: join(directory, 'assets'), emptyOutDir: true },
    });
    const bundle = await bundleWorker({
      entryPoints: [join(root, 'server/src/index.ts')],
      bundle: true, write: false, metafile: true,
      format: 'esm', platform: 'browser', target: 'es2022',
      external: ['cloudflare:workers'],
    });
    // The only backend entry is production routing; fixtures/debug clocks cannot leak.
    if (Object.keys(bundle.metafile.inputs).some((path) => /(?:^|[\\/])(?:test|tests|e2e)[\\/]/.test(path))) {
      throw new Error('Test-only input leaked into production Worker graph');
    }
    const script = controlledTime ? (await bundleWorker({
      entryPoints: [join(root, 'server/test/browserRecovery.worker.ts')], bundle: true, write: false,
      format: 'esm', platform: 'browser', target: 'es2022', external: ['cloudflare:workers'],
    })).outputFiles[0].text : bundle.outputFiles[0].text;
    const options = {
      modules: true as const,
      script,
      compatibilityDate: '2025-10-11',
      host: '127.0.0.1', port: 0, https: true,
      durableObjects: {
        REGISTRY: { className: 'Registry', useSQLite: true },
        ROOMS: { className: 'Room', useSQLite: true },
        ...(controlledTime ? { RECOVERY_CLOCK: { className: 'RecoveryClock', useSQLite: true } } : {}),
      },
      durableObjectsPersist: join(directory, 'storage'),
      assets: {
        directory: join(directory, 'assets'),
        routerConfig: { has_user_worker: true, static_routing: { user_worker: ['/api/*'] } },
        assetConfig: { not_found_handling: 'single-page-application' as const },
      },
      bindings: { APP_ENV: 'local', ALLOWED_ORIGINS: 'https://unconfigured.invalid' },
    };
    runtime = new Miniflare(options);
    const origin = (await runtime.ready).origin;
    // Port 0 is OS-selected. Configure the exact allowlist after binding; fail if
    // updating bindings unexpectedly changes the origin rather than using a wrong one.
    await runtime.setOptions({ ...options, bindings: { APP_ENV: 'local', ALLOWED_ORIGINS: origin } });
    if ((await runtime.ready).origin !== origin) throw new Error('E2E origin changed during setup');
    const health = await runtime.dispatchFetch(`${origin}/api/health`);
    if (health.status !== 200 || (await health.json() as { status?: string }).status !== 'ok') throw new Error('E2E Worker did not become ready');
    let clock: E2eEnvironment['clock'];
    if (controlledTime) {
      // Bridge Miniflare's workerd namespace type to this Node/DOM test project.
      const namespace = await runtime.getDurableObjectNamespace('RECOVERY_CLOCK') as unknown as ClockNamespace;
      const control = namespace.get(namespace.idFromName('controller'));
      const request = async (input: { now?: number; roomId?: string }) => {
        const response = await control.fetch('https://e2e-clock.internal/control', { method: 'POST', body: JSON.stringify(input) });
        if (!response.ok) throw new Error('Private test clock failed');
        return (await response.json() as { now: number }).now;
      };
      clock = { now: () => request({}), advanceTo: (now, roomId) => request({ now, roomId }) };
    }
    return { origin, directory, close, clock };
  } catch (error) {
    await close();
    throw error;
  }
}
