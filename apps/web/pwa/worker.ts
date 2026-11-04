interface StaticAsset { readonly url: string; readonly sha256: string; readonly type: string }
declare const __STATIC_APP_CONFIG__: { readonly cacheName: string; readonly assets: readonly StaticAsset[] };

const worker = globalThis as unknown as ServiceWorkerGlobalScope;
const { cacheName, assets } = __STATIC_APP_CONFIG__;
const namespace = 'robot-puzzle-static-v1-';
const allowed = new Map(assets.map((asset) => [asset.url, asset]));

async function verified(response: Response, asset: StaticAsset): Promise<boolean> {
  if (!response.ok || response.redirected || response.type !== 'basic') return false;
  if (/\b(?:private|no-store)\b/i.test(response.headers.get('cache-control') ?? '')) return false;
  const type = response.headers.get('content-type')?.split(';')[0].trim();
  if (type !== asset.type && !(asset.type === 'text/javascript' && type === 'application/javascript')) return false;
  const digest = await crypto.subtle.digest('SHA-256', await response.clone().arrayBuffer());
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('') === asset.sha256;
}

async function download(asset: StaticAsset): Promise<Response> {
  // No session cookie is sent, and response bytes must match the public build.
  // The asset host canonicalizes /index.html to /. Download the canonical URL
  // without following redirects; retain /index.html as our internal shell key.
  const response = await fetch(asset.url === '/index.html' ? '/' : asset.url,
    { credentials: 'omit', cache: 'no-store', redirect: 'error' });
  if (!await verified(response, asset)) throw new Error(`Incomplete static application build: ${asset.url}`);
  return response;
}

worker.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    // Fetch/validate everything before opening a new version's cache. Activation
    // is forbidden if any download or cache write fails. Never touch active data.
    const responses = await Promise.all(assets.map(download));
    try {
      const cache = await caches.open(cacheName);
      for (let index = 0; index < assets.length; index++) await cache.put(assets[index].url, responses[index]);
    } catch (error) {
      await caches.delete(cacheName);
      throw error;
    }
  })());
  // Deliberately no skipWaiting: updates must not interrupt existing clients.
});

worker.addEventListener('activate', (event) => {
  // Default activation waits until the old worker has no controlled clients.
  event.waitUntil((async () => {
    for (const name of await caches.keys()) {
      if (name.startsWith(namespace) && name !== cacheName) await caches.delete(name);
    }
  })());
  // No clients.claim, controllerchange reload, credential storage or command queue.
});

async function shell(request: Request): Promise<Response> {
  try {
    const response = await fetch(request, { credentials: 'omit', cache: 'no-store', redirect: 'error' });
    // Do not disguise an actual route rejection as a successful cached page.
    if (response.status >= 400 && response.status < 500) return response;
    if (await verified(response, allowed.get('/index.html')!)) return response;
    // A different deployment's HTML can reference chunks this worker does not
    // own. Pin to this complete build until the normal update lifecycle finishes.
  } catch { /* Offline/failed navigation may use only this version's public shell. */ }
  const response = await (await caches.open(cacheName)).match('/index.html');
  return response ?? new Response('App files unavailable. Connect to the internet, close the app and reopen it.',
    { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } });
}

worker.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== worker.location.origin ||
      url.pathname === '/api' || url.pathname.startsWith('/api/')) return;
  const navigation = request.mode === 'navigate' &&
    (url.pathname === '/' || url.pathname === '/index.html' || /^\/room\/[^/]+\/?$/.test(url.pathname));
  if (navigation) { event.respondWith(shell(request)); return; }
  // Unknown files, query variants and cross-origin requests are never cached or
  // replaced with HTML. No runtime cache.put: only validated install assets persist.
  const asset = !url.search ? allowed.get(url.pathname) : undefined;
  if (!asset) return;
  event.respondWith((async () => (await (await caches.open(cacheName)).match(asset.url)) ?? download(asset))());
});
