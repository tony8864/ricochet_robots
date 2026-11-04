import { test, expect } from '../support/fixtures';
import { createRoom, observeRooms } from '../support/lobby';
import { advanceServer, recoveryTransport } from '../support/recovery';
import { expectRobots, placeBid } from '../support/gameplay';
import { DIRECTIONS, ROBOT_IDS, isTargetComplete, moveRobot } from '../../../packages/game-engine/src';

test.use({ controlledTime: true });

async function join(page: import('@playwright/test').Page, code: string) {
  await page.goto(`/room/${code}`);
  await page.getByRole('textbox', { name: 'YOUR NICKNAME' }).fill('Alex');
  await page.getByRole('button', { name: 'Join Room', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Match setup', exact: true })).toBeVisible();
}

test('inline entry failure retries; tab-local Leave and offline recovery preserve original seats and host', async ({ page, guestPage, guestContext, context }) => {
  test.setTimeout(90_000);
  const hostRoom = observeRooms(page);
  await page.route('**/api/session', (route) => route.abort('connectionfailed'));
  await page.goto('/'); await page.getByRole('textbox', { name: 'YOUR NICKNAME' }).fill('Maria');
  await page.getByRole('button', { name: 'Create Room', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText('Connection lost. Check your connection, then retry.');
  await page.unroute('**/api/session');
  await page.getByRole('button', { name: 'Retry Create Room', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Match setup', exact: true })).toBeVisible();
  const code = (await page.getByRole('button', { name: /^Copy room code / }).innerText()).trim();
  await join(guestPage, code);
  await expect(page.getByRole('status').filter({ hasText: /^2 online$/ })).toBeVisible();
  const seats = hostRoom()!.players.map((player) => player.seatId);
  const tab = await guestContext.newPage();
  try {
    await join(tab, code);
    await guestPage.getByRole('button', { name: 'More actions', exact: true }).click();
    await guestPage.getByRole('button', { name: 'Leave Room', exact: true }).click();
    await guestPage.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(guestPage.getByRole('heading', { name: 'Match setup', exact: true })).toBeVisible();
    await guestPage.getByRole('button', { name: 'More actions', exact: true }).click();
    await guestPage.getByRole('button', { name: 'Leave Room', exact: true }).click();
    await guestPage.getByRole('dialog').getByRole('button', { name: 'Leave Room', exact: true }).click();
    await expect(guestPage.getByRole('heading', { name: 'Robot Puzzle', exact: true })).toBeVisible();
    await expect(page.getByRole('status').filter({ hasText: /^2 online$/ })).toBeVisible();
    await guestPage.reload(); await expect(guestPage.getByRole('heading', { name: 'Robot Puzzle', exact: true })).toBeVisible();
    await join(guestPage, code);
  } finally { await tab.close(); }
  for (const [offline, other] of [[context, guestPage], [guestContext, page]] as const) {
    await offline.setOffline(true);
    await expect(other.getByRole('status').filter({ hasText: /^1 online$/ })).toBeVisible({ timeout: 40_000 });
    if (offline === context) await expect(page.getByRole('button', { name: 'Shuffle Board', exact: true })).toBeDisabled();
    await offline.setOffline(false);
    for (const player of [page, guestPage]) await expect(player.getByRole('status').filter({ hasText: /^2 online$/ })).toBeVisible({ timeout: 20_000 });
  }
  expect(hostRoom()!.players.map((player) => player.seatId)).toEqual(seats);
  expect(hostRoom()!.hostSeatId).toBe(seats[0]);
  await expect(page.getByRole('button', { name: 'Shuffle Board', exact: true })).toBeEnabled();
  await expect(guestPage.getByRole('button', { name: 'Start Match', exact: true })).toHaveCount(0);
});

test('lost move reply survives refresh; Leave/return, grace cancel/skip, modal recovery and End are safe', async ({ page, guestPage, guestContext, environment }) => {
  test.setTimeout(150_000);
  const host = await recoveryTransport(page); const guest = await recoveryTransport(guestPage);
  const code = await createRoom(page); await join(guestPage, code);
  await expect(page.getByRole('status').filter({ hasText: /^2 online$/ })).toBeVisible();
  await page.getByRole('button', { name: 'Start Match', exact: true }).click();
  for (const player of [page, guestPage]) await expect(player.getByRole('heading', { name: 'Thinking', exact: true })).toBeVisible();
  const thinking = host.room()!;
  if (thinking.status !== 'playing' || thinking.match.phase !== 'thinking') throw new Error('Expected verified Thinking');
  const roomId = thinking.roomId; const seats = thinking.players.map((player) => player.seatId);
  const start = thinking.match.round.startRobots; const targetId = thinking.match.round.targetId;
  const target = thinking.puzzle.targets.find((item) => item.id === targetId)!;
  const move = ROBOT_IDS.flatMap((robotId) => DIRECTIONS.map((direction) => ({ robotId, direction }))).find((candidate) => {
    const moved = moveRobot(thinking.puzzle.board, start, candidate.robotId, candidate.direction);
    return moved.moved && !isTargetComplete(moved.robots, target);
  })!;
  const moved = moveRobot(thinking.puzzle.board, start, move.robotId, move.direction).robots;
  await placeBid(guestPage, 4); await placeBid(page, 5);
  const bidding = host.room()!;
  if (bidding.status !== 'playing' || bidding.match.phase !== 'bidding') throw new Error('Expected bidding');
  await advanceServer(environment, roomId, bidding.match.deadlineAtMs + 1, [host, guest]);
  await expect(guestPage.getByRole('region', { name: 'Demonstration controls' })).toBeVisible();
  guest.dropNextMoveReply();
  await guestPage.getByRole('button', { name: `Select ${move.robotId} robot`, exact: true }).click();
  await guestPage.getByRole('button', { name: `Move selected robot ${move.direction}`, exact: true }).click();
  await expect.poll(guest.dropped).toBe(1);
  await expectRobots([page, guestPage], moved);
  await guestPage.reload();
  await expect(guestPage.getByRole('button', { name: 'Retry pending request', exact: true })).toBeEnabled();
  await guestPage.getByRole('button', { name: 'Retry pending request', exact: true }).click();
  await expect.poll(guest.duplicate).toBe(true);
  expect(guest.moves()).toHaveLength(2); expect(guest.moves()[0]).toBe(guest.moves()[1]);
  await expect(guestPage.getByText('Moves: 1 / 4', { exact: true })).toBeVisible();
  await expectRobots([page, guestPage], moved);
  await guestPage.getByRole('button', { name: 'More actions', exact: true }).click();
  await guestPage.getByRole('button', { name: 'Leave Room', exact: true }).click();
  await guestPage.getByRole('dialog').getByRole('button', { name: 'Leave Room', exact: true }).click();
  await expect(guestPage.getByRole('heading', { name: 'Robot Puzzle', exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Disconnected demonstration' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Skip Attempt', exact: true })).toBeDisabled();
  await guestPage.getByRole('button', { name: 'Join Room', exact: true }).click();
  await expect(guestPage.getByRole('button', { name: 'Undo last move', exact: true })).toBeEnabled();
  await expect(page.getByRole('region', { name: 'Disconnected demonstration' })).toHaveCount(0);
  await guestPage.getByRole('button', { name: 'Undo last move', exact: true }).click();
  await expectRobots([page, guestPage], start);
  await guestPage.getByRole('button', { name: `Move selected robot ${move.direction}`, exact: true }).click();
  await expect(guestPage.getByText('Moves: 1 / 4', { exact: true })).toBeVisible();
  await guestContext.setOffline(true); guest.disconnect();
  await expect(guestPage.getByRole('button', { name: `Move selected robot ${move.direction}`, exact: true })).toBeDisabled();
  await expect(page.getByRole('region', { name: 'Disconnected demonstration' })).toBeVisible();
  const absent = host.room()!;
  if (absent.status !== 'playing' || absent.match.phase !== 'demonstrating' || !absent.match.disconnect) throw new Error('Missing grace');
  const deadline = absent.match.disconnect.skipAllowedAtMs;
  expect(deadline - absent.match.disconnect.disconnectedAtMs).toBe(60_000);
  await advanceServer(environment, roomId, deadline - 5_000, [host]);
  await expect(page.getByRole('button', { name: 'Skip Attempt', exact: true })).toBeDisabled();
  await advanceServer(environment, roomId, deadline + 1, [host]);
  await expect(page.getByRole('button', { name: 'Skip Attempt', exact: true })).toBeEnabled();
  const eligible = host.room()!;
  if (eligible.status !== 'playing' || eligible.match.phase !== 'demonstrating') throw new Error('No active attempt');
  expect(eligible.match.activeBidderIndex).toBe(0); // Never an automatic forfeiture.
  page.once('dialog', (dialog) => dialog.dismiss());
  await page.getByRole('button', { name: 'Skip Attempt', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Skip Attempt', exact: true })).toBeEnabled();
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Skip Attempt', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Demonstration controls' })).toBeVisible();
  await expectRobots([page], start);
  await guestContext.setOffline(false);
  await expect(guestPage.getByRole('status').filter({ hasText: /^2 online$/ })).toBeVisible({ timeout: 20_000 });
  await expect(guestPage.getByRole('region', { name: 'Demonstration controls' })).toHaveCount(0);
  await expectRobots([guestPage], start);
  await page.getByRole('button', { name: 'Give up', exact: true }).click();
  for (const player of [page, guestPage]) await expect(player.getByRole('dialog')).toBeVisible();
  await guestContext.setOffline(true); guest.disconnect();
  await expect(guestPage.getByRole('dialog').getByRole('button', { name: 'Reconnect', exact: true })).toBeVisible();
  await guestContext.setOffline(false);
  await expect(guestPage.getByRole('dialog').getByRole('button', { name: 'Reconnect', exact: true })).toHaveCount(0, { timeout: 20_000 });
  expect(host.room()!.players.map((player) => player.seatId)).toEqual(seats);
  const result = host.room()!;
  if (result.status !== 'playing' || result.match.phase !== 'round-result') throw new Error('Missing preserved result');
  expect(result.match.scores).toEqual(thinking.match.scores); expect(result.match.officialRobots).toEqual(start);
  for (const cancel of [true, false]) {
    await page.getByRole('dialog').getByRole('button', { name: 'More actions', exact: true }).click();
    await page.getByRole('button', { name: 'End Room', exact: true }).click();
    const confirmation = page.getByRole('dialog', { name: 'End this room for everyone?' });
    await confirmation.getByRole('button', { name: cancel ? 'Cancel' : 'End Room', exact: true }).click();
  }
  for (const player of [page, guestPage]) {
    await expect(player.getByRole('heading', { name: 'Robot Puzzle', exact: true })).toBeVisible();
    await expect(player.getByText('The host ended this room.', { exact: true })).toBeVisible();
  }
  await guestPage.getByRole('button', { name: 'Join Room', exact: true }).click();
  await expect(guestPage.getByRole('alert')).toHaveText('The host ended this room. Create or join another room.');
});

test('private controlled server time expires an empty room; browser refresh learns expiry without identity replacement', async ({ page, guestPage, context, guestContext, environment }) => {
  const host = observeRooms(page);
  const code = await createRoom(page); await join(guestPage, code);
  await expect(page.getByRole('status').filter({ hasText: /^2 online$/ })).toBeVisible();
  const roomId = host()!.roomId;
  const credential = (await context.cookies()).find((cookie) => cookie.name === '__Host-rr-session')!.value;
  expect(await page.evaluate(async () => (await fetch('/api/__test/clock')).status)).toBe(404);
  await context.setOffline(true); await guestContext.setOffline(true);
  const now = await environment.clock!.now();
  await advanceServer(environment, roomId, now + 30 * 60_000 + 31_000);
  for (const browser of [context, guestContext]) await browser.setOffline(false);
  for (const player of [page, guestPage]) {
    await expect(player.getByRole('heading', { name: 'Robot Puzzle', exact: true })).toBeVisible({ timeout: 20_000 });
    await expect(player.getByText('This room has expired.', { exact: true })).toBeVisible();
  }
  await guestPage.getByRole('button', { name: 'Join Room', exact: true }).click();
  await expect(guestPage.getByRole('alert')).toHaveText('This room has expired. Create or join another room.');
  await page.getByRole('button', { name: 'Create Room', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Match setup', exact: true })).toBeVisible();
  expect((await context.cookies()).find((cookie) => cookie.name === '__Host-rr-session')!.value === credential).toBe(true);
});
