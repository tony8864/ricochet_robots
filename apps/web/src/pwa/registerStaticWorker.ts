/** Best-effort static caching; installation failure must not prevent online play. */
export function registerStaticWorker(): void {
  if (!window.isSecureContext || !('serviceWorker' in navigator)) return;
  const register = async () => {
    try {
      const script = new URL('/robot-puzzle-sw.js', location.origin).href;
      const existing = await navigator.serviceWorker.getRegistration('/');
      // Do not overwrite a different application's root registration.
      if (existing && [existing.active, existing.waiting, existing.installing]
        .some((worker) => worker && worker.scriptURL !== script)) return;
      await navigator.serviceWorker.register(script, { scope: '/', updateViaCache: 'none' });
    } catch { /* Online app remains usable; next launch can retry installation. */ }
  };
  if (document.readyState === 'complete') void register();
  else window.addEventListener('load', () => { void register(); }, { once: true });
}
