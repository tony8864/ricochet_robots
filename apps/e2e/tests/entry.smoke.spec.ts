import { test, expect } from '../support/fixtures';

test('production entry renders over HTTPS with independent player contexts', async ({ page, guestPage, baseURL }) => {
  expect(baseURL).toMatch(/^https:\/\/127\.0\.0\.1:\d+$/);
  for (const player of [page, guestPage]) {
    await player.goto('/');
    await expect(player.getByRole('heading', { name: 'Robot Puzzle', exact: true })).toBeVisible();
    await expect(player.getByLabel('YOUR NICKNAME')).toBeVisible();
    await expect(player.getByRole('textbox', { name: 'ROOM CODE', exact: true })).toBeVisible();
    await expect(player.getByRole('button', { name: 'Create Room', exact: true })).toBeDisabled();
    await expect(player.getByRole('button', { name: 'Join Room', exact: true })).toBeDisabled();
  }
  await page.getByLabel('YOUR NICKNAME').fill('Harness Host');
  await expect(page.getByRole('button', { name: 'Create Room', exact: true })).toBeEnabled();
  await expect(guestPage.getByLabel('YOUR NICKNAME')).toHaveValue('');
  await page.reload();
  await expect(page.getByLabel('YOUR NICKNAME')).toHaveValue('Harness Host');
  await expect(guestPage.getByLabel('YOUR NICKNAME')).toHaveValue('');
  await expect(page.getByRole('link', { name: /local simulator/i })).toHaveCount(0);
});

test('real bootstrap uses isolated Secure cookies and production routes reject test hooks and unbound WSS', async ({ page, guestPage, context, guestContext, baseURL }) => {
  for (const player of [page, guestPage]) {
    await player.goto('/');
    const opened = await player.evaluate(async () => {
      const response = await fetch('/api/session', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ version: 2, commandId: crypto.randomUUID(), command: { type: 'session.open' } }),
      });
      const message = await response.json();
      return { status: response.status, type: message.type };
    });
    expect(opened).toEqual({ status: 200, type: 'session.ready' });
    // No raw cookie or private identity is attached to test output.
    expect(await player.evaluate(() => document.cookie)).not.toContain('__Host-rr-session');
  }
  const hostCookie = (await context.cookies()).find((cookie) => cookie.name === '__Host-rr-session');
  const guestCookie = (await guestContext.cookies()).find((cookie) => cookie.name === '__Host-rr-session');
  expect(!!hostCookie && !!guestCookie).toBe(true);
  expect(hostCookie!.secure && hostCookie!.httpOnly && hostCookie!.path === '/' && hostCookie!.sameSite === 'Lax').toBe(true);
  expect(guestCookie!.secure && guestCookie!.httpOnly).toBe(true);
  expect(hostCookie!.value !== guestCookie!.value).toBe(true);
  expect(await page.evaluate(async () => (await fetch('/api/__test/clock')).status)).toBe(404);
  // Assert the actual TLS WebSocket handshake status, not merely an error that
  // could also come from a certificate failure. Do not retain headers/cookies.
  const protocol = await context.newCDPSession(page);
  await protocol.send('Network.enable');
  const handshake = new Promise<number>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('No WSS handshake response')), 10_000);
    protocol.once('Network.webSocketHandshakeResponseReceived', (event) => {
      clearTimeout(timer); resolve(event.response.status);
    });
    protocol.once('Network.webSocketFrameError', (event) => {
      clearTimeout(timer);
      const status = /Unexpected response code: (\d+)/.exec(event.errorMessage);
      if (status) resolve(Number(status[1]));
      else reject(new Error('WSS failed before an HTTP rejection response'));
    });
  });
  const unbound = await page.evaluate((origin) => new Promise<string>((resolve) => {
    const socket = new WebSocket(`${origin.replace('https:', 'wss:')}/api/rooms/${crypto.randomUUID()}/socket`);
    socket.onopen = () => { socket.close(); resolve('unexpectedly bound'); };
    socket.onerror = () => { socket.close(); resolve('rejected'); };
  }), baseURL!);
  expect(unbound).toBe('rejected');
  expect(await handshake).toBe(404);
  await protocol.detach();
});
