import { test, expect } from '../support/fixtures';

test('production manifest and icons are served on entry and direct invite routes without changing entry behavior', async ({ page, context, baseURL }) => {
  for (const path of ['/', '/room/ABC234']) {
    await page.goto(path);
    await expect(page.getByRole('heading', { name: 'Robot Puzzle', exact: true })).toBeVisible();
    await expect(page.getByRole('contentinfo', { name: 'App version v0.1.0' })).toHaveText('v0.1.0');
    await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href', '/manifest.webmanifest');
    await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#080F1F');
    await expect(page.locator('meta[name="viewport"]')).toHaveAttribute('content', 'width=device-width, initial-scale=1.0, viewport-fit=cover');
    await expect(page.locator('meta[name="apple-mobile-web-app-capable"]')).toHaveAttribute('content', 'yes');
    await expect(page.getByRole('button', { name: 'Create Room', exact: true })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Join Room', exact: true })).toBeDisabled();
  }
  await expect(page.getByRole('textbox', { name: 'ROOM CODE', exact: true })).toHaveValue('ABC234');
  expect(await context.cookies()).toEqual([]); // No bootstrap/seat from loading or manifest fetching.

  const response = await page.request.get('/manifest.webmanifest');
  expect(response.status()).toBe(200);
  expect(response.headers()['content-type']).toMatch(/^application\/manifest\+json\b/);
  const manifest = await response.json();
  expect(manifest).toMatchObject({ id: '/', name: 'Robot Puzzle', short_name: 'Robot Puzzle',
    start_url: '/', scope: '/', display: 'standalone', background_color: '#080F1F', theme_color: '#080F1F' });
  expect(manifest).not.toHaveProperty('orientation');
  expect(manifest.icons).toEqual([
    { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  ]);
  for (const icon of [...manifest.icons, { src: '/icons/apple-touch-icon.png', sizes: '180x180' }]) {
    const asset = await page.request.get(icon.src);
    expect(asset.status()).toBe(200);
    expect(asset.headers()['content-type']).toMatch(/^image\/png\b/);
    const png = await asset.body();
    expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    const size = Number(icon.sizes.split('x')[0]);
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([size, size]);
  }
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute('href', '/icons/apple-touch-icon.png');
  const vector = await page.request.get('/icons/robot-puzzle.svg');
  expect(vector.status()).toBe(200);
  expect(vector.headers()['content-type']).toMatch(/^image\/svg\+xml\b/);

  // Check actual decoding, opacity and mask safety, not just file headers.
  const pixels = await page.evaluate(async () => {
    const image = new Image(); image.src = '/icons/icon-maskable-512.png'; await image.decode();
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 512;
    const ctx = canvas.getContext('2d')!; ctx.drawImage(image, 0, 0);
    const { data } = ctx.getImageData(0, 0, 512, 512);
    let opaque = true; let safe = true; let artwork = 0;
    for (let y = 0; y < 512; y++) for (let x = 0; x < 512; x++) {
      const offset = (y * 512 + x) * 4;
      if (data[offset + 3] !== 255) opaque = false;
      if (data[offset] !== 8 || data[offset + 1] !== 15 || data[offset + 2] !== 31) {
        artwork++;
        if (Math.hypot(x + 0.5 - 256, y + 0.5 - 256) > 512 * 0.4) safe = false;
      }
    }
    return { opaque, safe, artwork };
  });
  expect(pixels.opaque && pixels.safe).toBe(true); expect(pixels.artwork).toBeGreaterThan(10000);
  await expect.poll(() => page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.active?.state)).toBe('activated');
  expect(await page.evaluate(async () => (await navigator.serviceWorker.getRegistration())!.scope)).toBe(`${baseURL}/`);
  // A Chromium manifest parse is not a native launcher/physical device pass.
  const cdp = await context.newCDPSession(page);
  try {
    const parsed = await cdp.send('Page.getAppManifest');
    expect(parsed.url).toBe(`${baseURL}/manifest.webmanifest`);
    expect(parsed.errors).toEqual([]);
  } finally { await cdp.detach(); }
});
