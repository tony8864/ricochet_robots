import { test, expect } from '../support/fixtures';
import { createRoom } from '../support/lobby';
import { advanceServer, recoveryTransport } from '../support/recovery';
import { placeBid } from '../support/gameplay';
import { expectMobileLayout, layoutSizes } from '../support/mobileLayout';

test.use({ controlledTime: true, environmentKey: 'pwa-mobile' });

test('offline entry prevents click/keyboard submission and preserves manual exact retry across network events', async ({ page, context }) => {
  let posts = 0;
  page.on('request', (request) => { if (request.method() === 'POST' && new URL(request.url()).pathname.startsWith('/api/')) posts++; });
  await page.goto('/room/ABC234');
  await page.getByLabel('YOUR NICKNAME').fill('Mobile player');
  await expect(page.getByRole('button', { name: 'Join Room', exact: true })).toBeEnabled();
  await context.setOffline(true);
  await expect(page.getByText('You are offline. Internet connection required.', { exact: true })).toBeVisible();
  for (const name of ['Create Room', 'Join Room']) await expect(page.getByRole('button', { name, exact: true })).toBeDisabled();
  await expect(page.getByLabel('YOUR NICKNAME')).toBeEditable();
  await page.locator('form').evaluate((form) => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  await page.getByRole('textbox', { name: 'ROOM CODE', exact: true }).press('Enter');
  await context.setOffline(false);
  await expect(page.getByRole('button', { name: 'Create Room', exact: true })).toBeEnabled();
  expect(posts).toBe(0);
  await expect(page.getByRole('textbox', { name: 'ROOM CODE', exact: true })).toHaveValue('ABC234');

  await page.route('**/api/session', (route) => route.abort('connectionfailed'));
  await page.getByRole('button', { name: 'Create Room', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Retry Create Room', exact: true })).toBeEnabled();
  const before = posts;
  await context.setOffline(true);
  await expect(page.getByRole('button', { name: 'Retry Create Room', exact: true })).toBeDisabled();
  await expect(page.getByLabel('YOUR NICKNAME')).toBeDisabled();
  await page.locator('form').evaluate((form) => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  await context.setOffline(false);
  await expect(page.getByRole('button', { name: 'Retry Create Room', exact: true })).toBeEnabled();
  expect(posts).toBe(before); // No background replay on an online hint.
  await page.unroute('**/api/session');
  await page.getByRole('button', { name: 'Retry Create Room', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Match setup', exact: true })).toBeVisible();
});

test('entry, live board, menus, attempt controls and results retain square geometry and accessible targets at responsive sizes', async ({ page, guestPage, environment }, info) => {
  test.setTimeout(90_000);
  await page.goto('/');
  for (const size of layoutSizes) {
    await page.setViewportSize(size);
    await page.getByLabel('YOUR NICKNAME').focus();
    await expectMobileLayout(page, false);
    expect(await page.getByLabel('YOUR NICKNAME').evaluate((input) => getComputedStyle(input).fontSize)).toBe('16px');
    await page.getByRole('button', { name: 'Join Room', exact: true }).scrollIntoViewIfNeeded();
    const button = (await page.getByRole('button', { name: 'Join Room', exact: true }).boundingBox())!;
    expect(button.y + button.height).toBeLessThanOrEqual(size.height + 1);
  }
  await page.screenshot({ path: info.outputPath('short-entry.png') });
  const host = await recoveryTransport(page); const guest = await recoveryTransport(guestPage);
  const code = await createRoom(page, 'Maria');
  await guestPage.goto(`/room/${code}`);
  await guestPage.getByLabel('YOUR NICKNAME').fill('Alex');
  await guestPage.getByRole('button', { name: 'Join Room', exact: true }).click();
  await expect(guestPage.getByRole('heading', { name: 'Match setup', exact: true })).toBeVisible();
  for (const size of layoutSizes) {
    await page.setViewportSize(size); await expectMobileLayout(page);
    await page.getByRole('button', { name: 'More actions', exact: true }).click();
    const menu = (await page.locator('.match-actions__panel').boundingBox())!;
    expect(menu.x).toBeGreaterThanOrEqual(0); expect(menu.x + menu.width).toBeLessThanOrEqual(size.width);
    await page.keyboard.press('Escape');
  }
  await page.getByRole('button', { name: 'More actions', exact: true }).click();
  await page.getByRole('button', { name: 'End Room', exact: true }).click();
  const end = page.getByRole('dialog');
  await expect(end).toBeVisible(); await expectMobileLayout(page);
  await end.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('button', { name: 'Start Match', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Thinking', exact: true })).toBeVisible();
  for (const size of layoutSizes) { await page.setViewportSize(size); await expectMobileLayout(page); }
  await placeBid(guestPage, 4); await placeBid(page, 5);
  const bidding = host.room()!;
  if (bidding.status !== 'playing' || bidding.match.phase !== 'bidding') throw new Error('Expected bidding');
  await advanceServer(environment, bidding.roomId, bidding.match.deadlineAtMs + 1, [host, guest]);
  await expect(guestPage.getByRole('region', { name: 'Demonstration controls' })).toBeVisible();
  for (const size of layoutSizes) { await guestPage.setViewportSize(size); await expectMobileLayout(guestPage); }
  await guestPage.screenshot({ path: info.outputPath('short-demonstration.png') });
  await guestPage.getByRole('button', { name: 'Give up', exact: true }).click();
  await page.getByRole('button', { name: 'Give up', exact: true }).click();
  for (const size of layoutSizes) {
    await page.setViewportSize(size);
    await expect(page.getByRole('dialog')).toBeVisible(); await expectMobileLayout(page);
    const panel = (await page.locator('.round-result-panel').boundingBox())!;
    expect(panel.y).toBeGreaterThanOrEqual(0); expect(panel.y + panel.height).toBeLessThanOrEqual(size.height + 1);
    await page.getByRole('button', { name: 'Continue', exact: true }).scrollIntoViewIfNeeded();
  }
});
