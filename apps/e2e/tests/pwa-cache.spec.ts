import { test, expect } from '../support/fixtures';
import { createRoom, observeRooms } from '../support/lobby';

test.use({ pwaUpdates: true });

test('static-only offline shell, atomic failed update and waiting multi-tab deployment preserve live state', async ({ page, context, environment }) => {
  test.setTimeout(120_000);
  const credentialedStaticDownloads: boolean[] = [];
  context.on('request', async (request) => {
    if (request.serviceWorker()) {
      // Retain only a boolean, never cookie/header contents in diagnostics.
      credentialedStaticDownloads.push(Boolean((await request.allHeaders()).cookie));
    }
  });
  const protocol = await context.newCDPSession(page);
  const errors: string[] = [];
  protocol.on('ServiceWorker.workerErrorReported', ({ errorMessage }) => errors.push(errorMessage.errorMessage));
  await protocol.send('ServiceWorker.enable');
  const room = observeRooms(page);
  const code = await createRoom(page, 'PWA Host');
  // A bounded wait reports failed installation instead of hanging on `ready`.
  await expect.poll(async () => ({
    state: await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.getRegistration();
      return registration?.active?.state ?? registration?.installing?.state ?? 'absent';
    }), errors,
  })).toEqual({ state: 'activated', errors: [] });
  await protocol.detach();
  // No forced initial takeover: a normal next navigation starts control.
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Match setup', exact: true })).toBeVisible();
  expect(await page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.dataset.pwaBuild)).toBe('a');
  const initial = room()!;
  const cacheNames = await page.evaluate(() => caches.keys());
  const owned = cacheNames.filter((name) => name.startsWith('robot-puzzle-static-v1-'));
  expect(owned).toHaveLength(1);
  await page.evaluate(async () => { await (await caches.open('unrelated-app-cache')).put('/unrelated', new Response('keep')); });

  // Real network/API rejection through a controlled page, never a cached snapshot.
  expect(await page.evaluate(async () => (await fetch('/api/health')).status)).toBe(200);
  expect(await page.evaluate(async () => (await fetch('/api/does-not-exist')).status)).toBe(404);
  const stored = await page.evaluate(async () => {
    const names = (await caches.keys()).filter((name) => name.startsWith('robot-puzzle-static-v1-'));
    return (await Promise.all(names.map(async (name) => (await (await caches.open(name)).keys()).map((request) => new URL(request.url).pathname)))).flat();
  });
  expect(stored).toContain('/index.html');
  expect(stored.every((path) => path === '/index.html' || path === '/manifest.webmanifest' || path.startsWith('/icons/') || path.startsWith('/assets/'))).toBe(true);
  expect(stored.some((path) => path.startsWith('/api'))).toBe(false);

  await context.setOffline(true);
  expect(await page.evaluate(async () => { try { await fetch('/api/health'); return 'unexpected'; } catch { return 'offline'; } })).toBe('offline');
  await page.reload();
  await expect(page.getByText('Internet connection required.', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Match setup', exact: true })).toHaveCount(0);
  // No cached live board/roster masquerades as a connected room.
  const invite = await context.newPage();
  await invite.goto(`/room/${code}`);
  await expect(invite.getByRole('textbox', { name: 'ROOM CODE', exact: true })).toHaveValue(code);
  await expect(invite.getByText('You are offline. Internet connection required.', { exact: true })).toBeVisible();
  await expect(invite.getByRole('button', { name: 'Create Room', exact: true })).toBeDisabled();
  await expect(invite.getByRole('button', { name: 'Join Room', exact: true })).toBeDisabled();
  await invite.close();
  // Missing files aren't replaced by the shell while offline.
  expect(await page.evaluate(async () => { try { await fetch('/missing.js'); return 'unexpected'; } catch { return 'offline'; } })).toBe('offline');
  await context.setOffline(false);
  await expect(page.getByRole('heading', { name: 'Match setup', exact: true })).toBeVisible();
  expect(room()!.roomId).toBe(initial.roomId);

  const second = await context.newPage(); await second.goto('/');
  await expect(second.getByRole('heading', { name: 'Robot Puzzle', exact: true })).toBeVisible();
  await page.evaluate(() => { (window as unknown as { noReload: string }).noReload = 'alive'; });
  await environment.publishWebBuild!('broken');
  const failed = await page.evaluate(async () => {
    const registration = (await navigator.serviceWorker.getRegistration())!;
    const finished = new Promise<string>((resolve) => registration.addEventListener('updatefound', () => {
      const candidate = registration.installing!;
      candidate.addEventListener('statechange', () => { if (candidate.state === 'redundant') resolve(candidate.state); });
    }, { once: true }));
    await registration.update(); return finished;
  });
  expect(failed).toBe('redundant');
  expect(await page.evaluate(() => caches.keys())).toContain(owned[0]);
  expect(await page.evaluate(async () => (await caches.keys()).filter((name) => name.startsWith('robot-puzzle-static-v1-')))).toEqual(owned);

  await environment.publishWebBuild!('b');
  await page.evaluate(async () => { await (await navigator.serviceWorker.getRegistration())!.update(); });
  await expect.poll(() => page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.waiting?.state)).toBe('installed');
  expect(await page.evaluate(() => document.documentElement.dataset.pwaBuild)).toBe('a');
  expect(await page.evaluate(() => (window as unknown as { noReload: string }).noReload)).toBe('alive');
  // Even a new tab while A controls clients receives A's matching HTML/chunks.
  await second.reload();
  expect(await second.evaluate(() => document.documentElement.dataset.pwaBuild)).toBe('a');
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Match setup', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.dataset.pwaBuild)).toBe('a');
  expect(room()!.roomId).toBe(initial.roomId);
  const previousBoard = room()!.puzzle.id;
  await page.getByRole('button', { name: 'Shuffle Board', exact: true }).click();
  await expect.poll(() => room()?.puzzle.id).not.toBe(previousBoard);
  const latest = room()!;
  await second.close(); await page.close();

  // Wait on the SW itself, not a new tab that could keep the previous build alive.
  await expect.poll(async () => {
    const worker = context.serviceWorkers()[0];
    if (!worker) return false;
    try { return await worker.evaluate(async () => {
      const scope = globalThis as unknown as { registration: { active?: { state: string }; waiting: unknown } };
      return scope.registration.active?.state === 'activated' && !scope.registration.waiting &&
        (await caches.keys()).filter((name) => name.startsWith('robot-puzzle-static-v1-')).length === 1;
    }); } catch { return false; }
  }).toBe(true);
  const relaunched = await context.newPage(); const resumed = observeRooms(relaunched);
  await relaunched.goto('/');
  await expect(relaunched.getByRole('heading', { name: 'Robot Puzzle', exact: true })).toBeVisible();
  expect(await relaunched.evaluate(() => document.documentElement.dataset.pwaBuild)).toBe('b');
  expect(await relaunched.evaluate(() => caches.has('unrelated-app-cache'))).toBe(true);
  await relaunched.getByRole('textbox', { name: 'ROOM CODE', exact: true }).fill(code);
  await relaunched.getByRole('button', { name: 'Join Room', exact: true }).click();
  await expect(relaunched.getByRole('heading', { name: 'Match setup', exact: true })).toBeVisible();
  await expect.poll(() => resumed()?.revision).toBeGreaterThanOrEqual(latest.revision);
  expect(resumed()!.roomId).toBe(initial.roomId);
  expect(resumed()!.hostSeatId).toBe(initial.hostSeatId);
  expect(resumed()!.players.map((player) => player.seatId)).toEqual(initial.players.map((player) => player.seatId));
  expect(resumed()!.puzzle.id).toBe(latest.puzzle.id);
  expect(credentialedStaticDownloads.length).toBeGreaterThan(0);
  expect(credentialedStaticDownloads.some(Boolean)).toBe(false);
  await relaunched.close();
});
