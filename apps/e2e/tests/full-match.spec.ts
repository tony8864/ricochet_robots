import type { BrowserContext, Page } from '@playwright/test';
import type { PublicRoomState } from '../../../packages/shared/src';
import { DIRECTIONS, ROBOT_IDS, isTargetComplete, moveRobot } from '../../../packages/game-engine/src';
import { test, expect } from '../support/fixtures';
import { createRoom, observeRooms, renderedBoard } from '../support/lobby';
import { clickMove, expectRobots, placeBid, planRound } from '../support/gameplay';

async function join(page: Page, code: string, nickname: string) {
  await page.goto(`/room/${code}`);
  await page.getByRole('textbox', { name: 'YOUR NICKNAME' }).fill(nickname);
  await page.getByRole('button', { name: 'Join Room', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Match setup', exact: true })).toBeVisible();
}

// Ignore transport-only revisions/online flags when comparing gameplay state.
const signature = (room: PublicRoomState | undefined) => room && ({
  roomId: room.roomId, code: room.roomCode, host: room.hostSeatId,
  seats: room.players.map(({ seatId, nickname }) => ({ seatId, nickname })),
  board: room.puzzle.id, status: room.status,
  state: room.status === 'lobby' ? room.lobbyId : room.match,
});

test('two browsers finish ten rounds with success, exhausted bidders, skips, results refresh and fresh rematch', async ({ page, guestPage }) => {
  test.setTimeout(240_000); // Two real 60-second bidding windows; no clock hooks.
  const pages = [page, guestPage];
  const hostRoom = observeRooms(page); const guestRoom = observeRooms(guestPage);
  const shared = async () => {
    const room = hostRoom()!;
    await expect.poll(() => signature(guestRoom())).toEqual(signature(room));
    return room;
  };
  const code = await createRoom(page);
  await join(guestPage, code, 'Alex');
  await expect(page.getByRole('status').filter({ hasText: /^2 online$/ })).toBeVisible();
  const lobby = await shared();
  if (lobby.status !== 'lobby') throw new Error('Expected initial lobby');
  const seats = lobby.players.map((player) => player.seatId);
  const [hostSeat, guestSeat] = seats;
  let official = lobby.puzzle.initialRobots;
  let scores = { [hostSeat]: 0, [guestSeat]: 0 };
  const targets = new Set<string>();
  let matchId = '';
  await page.getByRole('button', { name: 'Start Match', exact: true }).click();
  for (let round = 1; round <= 10; round++) {
    await test.step(`Round ${round}: reveal, outcome and host advancement`, async () => {
      for (const player of pages) {
        await expect(player.getByRole('heading', { name: 'Thinking', exact: true })).toBeVisible();
        await expect(player.locator('.active-match-header__round')).toHaveText(`ROUND ${round} / 10`);
      }
      const thinking = await shared();
      if (thinking.status !== 'playing' || thinking.match.phase !== 'thinking') throw new Error(`Round ${round} preparation did not reveal a verified target`);
      const targetId = thinking.match.round.targetId;
      matchId ||= thinking.match.matchId;
      expect(thinking.match.matchId).toBe(matchId);
      expect(thinking.puzzle).toEqual(lobby.puzzle);
      expect(thinking.match.completedRounds).toBe(round - 1);
      expect(thinking.match.scores).toEqual(scores);
      expect(thinking.match.officialRobots).toEqual(official);
      expect(thinking.match.round.startRobots).toEqual(official);
      expect(targets.has(thinking.match.round.targetId)).toBe(false);
      targets.add(thinking.match.round.targetId);
      expect(thinking.match.usedTargetIds).toHaveLength(round);
      await expectRobots(pages, official);
      if (round <= 2) {
        const plan = round === 1 ? planRound(thinking) : null;
        const bid = plan ? plan.solution.length + 3 : 5;
        await placeBid(page, bid);
        await expect(guestPage.getByRole('heading', { name: 'Bidding', exact: true })).toBeVisible();
        await placeBid(guestPage, bid + 1);
        const bidding = await shared();
        if (bidding.status !== 'playing' || bidding.match.phase !== 'bidding') throw new Error(`Round ${round}: missing bidding`);
        const deadline = bidding.match.deadlineAtMs;
        await test.step(`Round ${round}: wait for actual server bidding deadline`, async () => {
          for (const player of pages) await expect(player.getByRole('heading', { name: 'Demonstration', exact: true })).toBeVisible({ timeout: 75_000 });
          expect(Date.now()).toBeGreaterThanOrEqual(deadline);
        });
        if (plan) {
          await clickMove(page, plan.detour[0]);
          await page.getByRole('button', { name: 'Undo last move', exact: true }).click();
          await expectRobots(pages, official);
          for (const move of plan.detour) await clickMove(page, move);
        } else {
          const target = thinking.puzzle.targets.find((item) => item.id === targetId)!;
          const safe = ROBOT_IDS.flatMap((robotId) => DIRECTIONS.map((direction) => ({ robotId, direction }))).find((move) => {
            const result = moveRobot(thinking.puzzle.board, official, move.robotId, move.direction);
            return result.moved && !isTargetComplete(result.robots, target);
          });
          if (!safe) throw new Error('No safe failure-path move');
          await clickMove(page, safe);
        }
        await page.getByRole('button', { name: 'Give up', exact: true }).click();
        await expect(guestPage.getByRole('region', { name: 'Demonstration controls' })).toBeVisible();
        await expectRobots(pages, official);
        const second = await shared();
        if (second.status !== 'playing' || second.match.phase !== 'demonstrating') throw new Error(`Round ${round}: missing second bidder`);
        expect(second.match.activeBidderIndex).toBe(1);
        expect(second.match.scores).toEqual(scores);
        expect(second.match.officialRobots).toEqual(official);
        if (plan) {
          for (let i = 0; i < plan.solution.length; i++) {
            const move = plan.solution[i];
            if (i < plan.solution.length - 1) await clickMove(guestPage, move);
            else {
              await guestPage.getByRole('button', { name: `Select ${move.robotId} robot`, exact: true }).click();
              await guestPage.getByRole('button', { name: `Move selected robot ${move.direction}`, exact: true }).click();
            }
          }
          official = plan.final; scores = { ...scores, [guestSeat]: scores[guestSeat] + 1 };
        } else await guestPage.getByRole('button', { name: 'Give up', exact: true }).click();
      } else {
        page.once('dialog', async (dialog) => { expect(dialog.type()).toBe('confirm'); await dialog.accept(); });
        await page.getByRole('button', { name: 'More actions', exact: true }).click();
        await page.getByRole('button', { name: 'Skip Round', exact: true }).click();
      }
      for (const player of pages) {
        await expect(player.getByRole('dialog')).toBeVisible();
        await expect(player.getByRole('heading', { name: `ROUND ${round} COMPLETE`, exact: true })).toBeVisible();
        await expect(player.getByText(round === 1 ? 'Alex solved the target!' : round === 2 ? 'Nobody solved this round.' : 'Round skipped.', { exact: true })).toBeVisible();
      }
      const result = await shared();
      if (result.status !== 'playing' || result.match.phase !== 'round-result') throw new Error(`Round ${round}: missing result`);
      expect(result.match.completedRounds).toBe(round);
      expect(result.match.outcome.kind).toBe(round === 1 ? 'success' : round === 2 ? 'all-bidders-gave-up' : 'no-bid-skip');
      expect(result.match.scores).toEqual(scores);
      expect(result.match.officialRobots).toEqual(official);
      expect(result.hostSeatId).toBe(hostSeat);
      expect(result.players.map((player) => player.seatId)).toEqual(seats);
      await expectRobots(pages, official);
      const action = round === 10 ? 'View Results' : 'Continue';
      await expect(guestPage.getByRole('button', { name: action, exact: true })).toHaveCount(0);
      await page.getByRole('button', { name: action, exact: true }).click();
      for (const player of pages) await expect(player.getByRole('dialog')).toHaveCount(0);
    });
  }
  expect(targets.size).toBe(10);
  const standings = async (player: Page) => player.locator('.final-standings__row').evaluateAll((rows) => rows.map((row) => ({
    name: row.querySelector('.final-standings__nickname')?.textContent,
    score: row.querySelector('.final-standings__score')?.textContent,
    rank: row.querySelector('.final-standings__rank')?.textContent,
  })));
  const checkFinished = async () => {
    for (const player of pages) {
      await expect(player.getByRole('heading', { name: 'Alex wins!', exact: true })).toBeVisible();
      await expect(player.getByText('10 rounds played', { exact: true })).toBeVisible();
      await expect(player.locator('.active-match-header')).toHaveCount(0);
    }
    const finished = await shared();
    if (finished.status !== 'finished') throw new Error('Missing final match result');
    expect(finished.match.matchId).toBe(matchId);
    expect(finished.match.completedRounds).toBe(10);
    expect(finished.match.usedTargetIds).toHaveLength(10);
    expect(finished.match.scores).toEqual(scores);
    expect(finished.match.officialRobots).toEqual(official);
    await expect(page.getByRole('button', { name: 'New Match', exact: true })).toBeEnabled();
    await expect(guestPage.getByRole('button', { name: 'New Match', exact: true })).toHaveCount(0);
    await expect(guestPage.getByText('Waiting for Maria to start a new match.', { exact: true })).toBeVisible();
    expect(await standings(page)).toEqual([{ name: 'Alex', score: '1', rank: '1' }, { name: 'Maria', score: '0', rank: '2' }]);
    expect(await standings(guestPage)).toEqual(await standings(page));
  };
  await test.step('Finished is stable across both browser refreshes', async () => {
    await checkFinished();
    for (const player of pages) await player.reload();
    await checkFinished();
  });
  await test.step('Finished keeps recovery reachable for guest and host while offline', async () => {
    for (const player of [guestPage, page]) {
      await player.context().setOffline(true);
      await expect(player.getByRole('button', { name: 'Reconnect', exact: true })).toBeVisible();
      if (player === page) await expect(player.getByRole('button', { name: 'New Match', exact: true })).toBeDisabled();
      await player.context().setOffline(false);
      await expect(player.getByRole('button', { name: 'Reconnect', exact: true })).toHaveCount(0, { timeout: 20_000 });
      await checkFinished();
    }
  });
  await test.step('New Match returns the same seats/code to lobby; explicit Start creates clean state', async () => {
    await page.getByRole('button', { name: 'New Match', exact: true }).click();
    for (const player of pages) {
      await expect(player.getByRole('heading', { name: 'Match setup', exact: true })).toBeVisible();
      await expect(player.getByRole('button', { name: `Copy room code ${code}`, exact: true })).toBeVisible();
    }
    const returned = await shared();
    if (returned.status !== 'lobby') throw new Error('Missing rematch lobby');
    expect(returned.lobbyId).not.toBe(lobby.lobbyId);
    expect(returned.roomId).toBe(lobby.roomId); expect(returned.hostSeatId).toBe(hostSeat);
    expect(returned.players.map((player) => player.seatId)).toEqual(seats);
    expect(returned.puzzle).toEqual(lobby.puzzle);
    await expectRobots(pages, lobby.puzzle.initialRobots);
    await page.getByRole('button', { name: 'Start Match', exact: true }).click();
    for (const player of pages) await expect(player.getByRole('heading', { name: 'Thinking', exact: true })).toBeVisible();
    const fresh = await shared();
    if (fresh.status !== 'playing' || fresh.match.phase !== 'thinking') throw new Error('Missing fresh match');
    expect(fresh.match.matchId).not.toBe(matchId);
    expect(fresh.match.completedRounds).toBe(0); expect(fresh.match.round.number).toBe(1);
    expect(fresh.match.usedTargetIds).toHaveLength(1);
    expect(fresh.match.scores).toEqual({ [hostSeat]: 0, [guestSeat]: 0 });
    expect(fresh.match.officialRobots).toEqual(lobby.puzzle.initialRobots);
    expect(fresh.match.round.startRobots).toEqual(lobby.puzzle.initialRobots);
    await expectRobots(pages, lobby.puzzle.initialRobots);
  });
});

test('six independent browser identities share roster, bids, ordering and board', async ({ page, guestPage, browser, baseURL }) => {
  test.setTimeout(60_000);
  const owned: BrowserContext[] = [];
  const pages = [page, guestPage];
  const observations = [observeRooms(page), observeRooms(guestPage)];
  const names = ['Maria', 'Alex', 'Player 3', 'Player 4', 'Player 5', 'Player 6'];
  try {
    const code = await createRoom(page);
    for (let i = 1; i < 6; i++) {
      if (i > 1) {
        const context = await browser.newContext({ baseURL, ignoreHTTPSErrors: true }); owned.push(context);
        const player = await context.newPage(); pages.push(player); observations.push(observeRooms(player));
      }
      await join(pages[i], code, names[i]);
    }
    for (const player of pages) {
      await expect(player.getByRole('status').filter({ hasText: /^6 online$/ })).toBeVisible();
      await expect(player.getByRole('region', { name: 'Players', exact: true }).getByRole('listitem')).toHaveCount(6);
    }
    await page.getByRole('button', { name: 'Start Match', exact: true }).click();
    for (const player of pages) await expect(player.getByRole('heading', { name: 'Thinking', exact: true })).toBeVisible();
    const values = [8, 9, 6, 7, 5, 4];
    for (let i = 0; i < 6; i++) await placeBid(pages[i], values[i]);
    await placeBid(pages[2], 3); await placeBid(pages[3], 3);
    const expected = observations[0]()!;
    if (expected.status !== 'playing' || expected.match.phase !== 'bidding') throw new Error('Expected six-player bidding');
    expect(expected.players).toHaveLength(6); expect(new Set(expected.players.map((player) => player.seatId)).size).toBe(6);
    expect(expected.match.bids).toHaveLength(6);
    for (let i = 0; i < 6; i++) {
      const player = pages[i];
      await expect.poll(() => signature(observations[i]())).toEqual(signature(expected));
      await expect(player.getByRole('list', { name: 'Player bids list' }).getByRole('listitem')).toContainText(
        ['Player 3', 'Player 4', 'Player 6', 'Player 5', 'Maria', 'Alex']);
      await expect(player.locator('.player-bids__row--current')).toHaveAttribute('data-seat-id', expected.players[i].seatId);
      await expect(player.getByRole('region', { name: 'Demonstration controls' })).toHaveCount(0);
      expect(await renderedBoard(player)).toEqual(await renderedBoard(page));
    }
  } finally { await Promise.all(owned.map((context) => context.close())); }
});
