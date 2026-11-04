import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { transformWithEsbuild, type Plugin, type ResolvedConfig } from 'vite';

const publicAssets = [
  'manifest.webmanifest', 'icons/robot-puzzle.svg', 'icons/icon-192.png',
  'icons/icon-512.png', 'icons/icon-maskable-512.png', 'icons/apple-touch-icon.png',
];
const mime: Readonly<Record<string, string>> = {
  html: 'text/html', js: 'text/javascript', css: 'text/css', webmanifest: 'application/manifest+json',
  svg: 'image/svg+xml', png: 'image/png', woff2: 'font/woff2',
};
const hash = (data: string | Uint8Array) => createHash('sha256').update(data).digest('hex');

/** Production-only, build-owned public assets. No app/API state or runtime dependency. */
export function staticPwa(): Plugin {
  let config: ResolvedConfig;
  return {
    name: 'robot-puzzle-static-pwa', apply: 'build', enforce: 'post',
    configResolved(value) { config = value; },
    generateBundle: { order: 'post', async handler(_options, bundle) {
      if (config.base !== '/' || !config.publicDir) throw new Error('PWA requires root-scoped public assets');
      const files = new Map<string, string | Uint8Array>();
      for (const [name, entry] of Object.entries(bundle)) {
        if (name === 'index.html' || name.startsWith('assets/')) {
          if (name.endsWith('.map')) continue;
          files.set(name, entry.type === 'chunk' ? entry.code : entry.source);
        }
      }
      if (!files.has('index.html')) throw new Error('PWA shell missing from build');
      for (const name of publicAssets) files.set(name, await readFile(join(config.publicDir, name)));
      const assets = [...files].sort(([a], [b]) => a.localeCompare(b)).map(([name, data]) => {
        const type = mime[name.split('.').pop()!];
        if (!type) throw new Error(`Unreviewed static asset type: ${name}`);
        return { url: `/${name}`, sha256: hash(data), type };
      });
      const source = await readFile(join(config.root, 'pwa/worker.ts'), 'utf8');
      const code = (await transformWithEsbuild(source, 'worker.ts', { loader: 'ts', target: 'es2022', format: 'iife' })).code;
      const cacheName = `robot-puzzle-static-v1-${hash(code + JSON.stringify(assets)).slice(0, 24)}`;
      this.emitFile({ type: 'asset', fileName: 'robot-puzzle-sw.js',
        source: `const __STATIC_APP_CONFIG__=${JSON.stringify({ cacheName, assets })};\n${code}` });
    } },
  };
}
