import { test, expect } from '../support/fixtures';
import { createRoom, observeRooms } from '../support/lobby';
import { clickMove, expectRobots, placeBid, planRound } from '../support/gameplay';
import { moveRobot } from '../../../packages/game-engine/src';

test('real bidding, corrections, rollback, successful multi-robot carry-forward and host Continue', async ({ page, guestPage }) => {
  test.setTimeout(150_000); // Includes the actual 60-second server bidding window.
  const hostRoom = observeRooms(page); const guestRoom = observeRooms(guestPage);
  const pages = [page, guestPage];
  const code = await createRoom(page);
  await guestPage.goto(`/room/${code}`);
  await guestPage.getByRole('textbox', { name: 'YOUR NICKNAME' }).fill('Alex');
  await guestPage.getByRole('button', { name: 'Join Room', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: /^2 online$/ })).toBeVisible();
  await page.getByRole('button', { name: 'Start Match', exact: true }).click();
  for (const player of pages) await expect(player.getByRole('heading', { name: 'Thinking', exact: true })).toBeVisible();
  const thinking = hostRoom()!;
  if (thinking.status !== 'playing' || thinking.match.phase !== 'thinking') throw new Error('No real verified round');
  const plan = planRound(thinking);
  const hostSeat = thinking.hostSeatId;
  const guestSeat = thinking.players.find((player) => player.seatId !== hostSeat)!.seatId;
  for (const player of pages) {
    await expect(player.getByRole('region', { name: 'Demonstration controls' })).toHaveCount(0);
    await expect(player.locator('.game-board__robot--interactive')).toHaveCount(0);
  }
  await expectRobots(pages, plan.start);
  page.once('dialog', async (dialog) => { expect(dialog.type()).toBe('confirm'); await dialog.dismiss(); });
  await page.getByRole('button', { name: 'More actions', exact: true }).click();
  await page.getByRole('button', { name: 'Skip Round', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Thinking', exact: true })).toBeVisible();
  expect(hostRoom()!.revision).toBe(thinking.revision);
  await expectRobots(pages, plan.start);
  const finalBid = plan.solution.length + 3;
  const beforeFirstBid = Date.now();
  await placeBid(page, finalBid + 1);
  const bidding = hostRoom()!;
  if (bidding.status !== 'playing' || bidding.match.phase !== 'bidding') throw new Error('Expected bidding');
  const deadline = bidding.match.deadlineAtMs;
  expect(deadline).toBeGreaterThanOrEqual(beforeFirstBid + 60_000);
  expect(deadline).toBeLessThanOrEqual(Date.now() + 60_000);
  const firstOrder = bidding.match.bids[0].firstAcceptedOrder;
  await expect(guestPage.getByRole('heading', { name: 'Bidding', exact: true })).toBeVisible();
  await placeBid(guestPage, finalBid + 2); // Higher than somebody else's bid is legal.
  await placeBid(guestPage, finalBid);
  for (const player of pages) await expect(player.getByRole('list', { name: 'Player bids list' }).getByRole('listitem').first()).toContainText('Alex');
  await placeBid(page, finalBid); // Earlier first bid still wins the final tie.
  for (const player of pages) {
    const list = player.getByRole('list', { name: 'Player bids list' });
    await expect(list.getByRole('listitem')).toHaveCount(2);
    await expect(list.getByRole('listitem').first()).toContainText('Maria');
    await expect(list.getByRole('listitem')).toContainText([`${finalBid} moves`, `${finalBid} moves`]);
    await expect(player.locator('.active-match-header__phase')).toContainText(/(?:1:00|0:\d\d)/);
    await expect(player.getByRole('button', { name: 'Skip Round', exact: true })).toHaveCount(0);
    await expect(player.getByRole('region', { name: 'Demonstration controls' })).toHaveCount(0);
  }
  await page.getByRole('textbox', { name: 'YOUR BID' }).fill(String(finalBid + 1));
  await expect(page.getByRole('button', { name: 'Place Bid', exact: true })).toBeDisabled();
  await expect(page.getByRole('status').filter({ hasText: 'You can only lower your own bid.' })).toBeVisible();
  const revised = hostRoom()!;
  if (revised.status !== 'playing' || revised.match.phase !== 'bidding') throw new Error('Expected revised bidding');
  expect(revised.match.deadlineAtMs).toBe(deadline);
  expect(revised.match.bids.find((bid) => bid.seatId === hostSeat)!.firstAcceptedOrder).toBe(firstOrder);
  await expect.poll(() => { const state = guestRoom(); return state?.status === 'playing' && state.match.phase === 'bidding' ? state.match.deadlineAtMs : null; }).toBe(deadline);
  // Condition polling, not a fixed sleep or client-clock override; the server advances.
  for (const player of pages) await expect(player.getByRole('heading', { name: 'Demonstration', exact: true })).toBeVisible({ timeout: 75_000 });
  const demo = hostRoom()!;
  if (demo.status !== 'playing' || demo.match.phase !== 'demonstrating') throw new Error('Expected demonstration');
  expect(Date.now()).toBeGreaterThanOrEqual(deadline);
  expect(demo.match.bidderQueue.map((bid) => bid.seatId)).toEqual([hostSeat, guestSeat]);
  await expect(page.getByRole('region', { name: 'Demonstration controls' })).toBeVisible();
  await expect(guestPage.getByRole('region', { name: 'Demonstration controls' })).toHaveCount(0);
  let robots = plan.start;
  const checkCount = async (count: number) => {
    for (const player of pages) await expect(player.getByText(`Moves: ${count} / ${finalBid}`, { exact: true })).toBeVisible();
  };
  await clickMove(page, plan.detour[0]);
  robots = moveRobot(thinking.puzzle.board, robots, plan.detour[0].robotId, plan.detour[0].direction).robots;
  await checkCount(1); await expectRobots(pages, robots);
  const afterMove = hostRoom()!;
  if (afterMove.status !== 'playing' || afterMove.match.phase !== 'demonstrating') throw new Error('Expected first move');
  await clickMove(page, plan.detour[0]); // Same direction at the stop is a no-op.
  await expect(page.getByText('That robot cannot move in that direction.', { exact: true })).toBeVisible();
  await checkCount(1); await expectRobots(pages, robots);
  const afterNoop = hostRoom()!;
  if (afterNoop.status !== 'playing' || afterNoop.match.phase !== 'demonstrating') throw new Error('Expected no-op');
  expect(afterNoop.match.attempt.version).toBe(afterMove.match.attempt.version);
  await page.getByRole('button', { name: 'Undo last move', exact: true }).click();
  await checkCount(0); await expectRobots(pages, plan.start);
  for (const move of plan.detour) await clickMove(page, move);
  await checkCount(2);
  await page.getByRole('button', { name: 'Reset attempt', exact: true }).click();
  await checkCount(0); await expectRobots(pages, plan.start);
  for (const move of plan.detour) await clickMove(page, move);
  await checkCount(2);
  await page.getByRole('button', { name: 'Give up', exact: true }).click();
  await expect(guestPage.getByRole('region', { name: 'Demonstration controls' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Demonstration controls' })).toHaveCount(0);
  await checkCount(0); await expectRobots(pages, plan.start);
  const next = guestRoom()!;
  if (next.status !== 'playing' || next.match.phase !== 'demonstrating') throw new Error('Expected second bidder');
  expect(next.match.activeBidderIndex).toBe(1);
  expect(next.match.scores).toEqual(demo.match.scores);
  expect(next.match.officialRobots).toEqual(plan.start);
  for (let i = 0; i < plan.solution.length; i++) {
    const move = plan.solution[i];
    if (i === plan.solution.length - 1) {
      await guestPage.getByRole('button', { name: `Select ${move.robotId} robot`, exact: true }).click();
      await guestPage.getByRole('button', { name: `Move selected robot ${move.direction}`, exact: true }).click();
    } else await clickMove(guestPage, move);
  }
  for (const player of pages) {
    await expect(player.getByRole('dialog')).toBeVisible();
    await expect(player.getByText('Alex solved the target!', { exact: true })).toBeVisible();
    await expect(player.getByText(`${plan.solution.length} moves · Bid: ${finalBid} ·`, { exact: false })).toBeVisible();
    await expect(player.getByText('+1 point', { exact: true })).toBeVisible();
  }
  await expectRobots(pages, plan.final);
  const result = hostRoom()!;
  if (result.status !== 'playing' || result.match.phase !== 'round-result') throw new Error('Expected result');
  expect(result.match.scores).toEqual({ ...demo.match.scores, [guestSeat]: demo.match.scores[guestSeat] + 1 });
  expect(result.match.officialRobots).toEqual(plan.final);
  await expect(guestPage.getByRole('button', { name: 'Continue', exact: true })).toHaveCount(0);
  await expect(guestPage.getByText('Waiting for Maria to continue.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  for (const player of pages) {
    await expect(player.getByRole('dialog')).toHaveCount(0);
    await expect(player.locator('.active-match-header__round')).toHaveText('ROUND 2 / 10');
    await expect(player.getByRole('heading', { name: 'Thinking', exact: true })).toBeVisible();
  }
  await expectRobots(pages, plan.final);
  for (const observation of [hostRoom, guestRoom]) {
    const state = observation()!;
    if (state.status !== 'playing' || state.match.phase !== 'thinking') throw new Error('Expected verified next round');
    expect(state.match.scores).toEqual(result.match.scores);
    expect(state.match.officialRobots).toEqual(plan.final);
    expect(state.match.round.startRobots).toEqual(plan.final);
    expect(state.match.round.targetId).not.toBe(thinking.match.round.targetId);
    expect(state.puzzle.id).toBe(thinking.puzzle.id);
  }
});
