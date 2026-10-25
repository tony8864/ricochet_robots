import { expect, test, vi } from 'vitest';
import { createMatch, prepareMatchRound, transitionMatch, type MatchState, type PlayerMatchCommand } from '@robot-puzzle/match';
import { starterBoard } from '@robot-puzzle/puzzles';
import { prepareNextRound, RECOMMENDED_ROUND_SETUP_BUDGET } from '@robot-puzzle/puzzles/round-setup';
import { createLocalMatchController } from './controller';
import { createDevelopmentController } from './developmentScenario';
import { DEMO_BOARD_ID, LOCAL_PLAYERS } from './config';

const options = {
  candidateOrder: ['blue-star', ...starterBoard.targets.map((target) => target.id).filter((id) => id !== 'blue-star')],
  budget: RECOMMENDED_ROUND_SETUP_BUDGET,
};

function thinking() {
  const initial = createMatch({ matchId: 'adapter-test', players: LOCAL_PLAYERS, puzzle: starterBoard });
  const state = prepareMatchRound(initial, options).state;
  if (state.phase !== 'thinking') throw new Error('Expected verified fixture round.');
  return state;
}

function controllerAt(match: MatchState, now: () => number = () => 61_000) {
  return createLocalMatchController({ match, now, hostSeatId: 'maria', actingSeatId: 'maria' });
}

function start(bid = 3) {
  let nowMs = 1_000;
  const controller = controllerAt(thinking(), () => nowMs);
  controller.sendPlayer({ type: 'bid.submit', value: bid });
  controller.actAs('alex');
  controller.sendPlayer({ type: 'bid.submit', value: bid + 1 });
  nowMs = 61_000;
  controller.advanceTime();
  controller.actAs('maria');
  return controller;
}

test('development starter uses a verified real round, actual bids, and expiry, without proof in its snapshot', () => {
  const controller = createDevelopmentController();
  const state = controller.getSnapshot().match;
  expect(state.puzzle.id).toBe(DEMO_BOARD_ID);
  expect(state.phase).toBe('demonstrating');
  if (state.phase !== 'demonstrating') throw new Error('Expected development demonstration.');
  expect(state.bidderQueue.map(({ seatId, value }) => [seatId, value])).toEqual([['maria', 10], ['alex', 12]]);
  expect(state.usedTargetIds).toEqual([state.round.target.id]);
  expect(state.round.target.id).toBe('blue-star');
  expect(state.attempt.moves).toEqual([]);
  expect(state.completedRounds).toBe(0);
  expect(state.scores).toEqual({ maria: 0, alex: 0, teo: 0 });
  expect(JSON.stringify(controller.getSnapshot())).not.toContain('internalProof');
});

test('switching seats preserves exact match identity, host, attempt, and scores', () => {
  const controller = start();
  controller.sendPlayer({ type: 'attempt.move', robotId: 'blue', direction: 'down' });
  const before = controller.getSnapshot().match;
  for (const seat of ['alex', 'teo', 'maria']) {
    controller.actAs(seat);
    expect(controller.getSnapshot().match).toBe(before);
    expect(controller.getSnapshot().hostSeatId).toBe('maria');
    expect(controller.getSnapshot().actingSeatId).toBe(seat);
  }
});

test.each<PlayerMatchCommand>([
  { type: 'attempt.move', robotId: 'blue', direction: 'down' },
  { type: 'attempt.undo' }, { type: 'attempt.reset' }, { type: 'attempt.giveUp' },
])('watcher and inactive host cannot issue %j through the controller', (command) => {
  const controller = start();
  controller.actAs('teo');
  const before = controller.getSnapshot().match;
  expect(controller.sendPlayer(command)).toEqual({ status: 'rejected', reason: 'not-active-bidder' });
  expect(controller.getSnapshot().match).toBe(before);
  controller.actAs('maria');
  controller.sendPlayer({ type: 'attempt.giveUp' });
  const next = controller.getSnapshot().match;
  expect(controller.sendPlayer(command)).toEqual({ status: 'rejected', reason: 'not-active-bidder' });
  expect(controller.getSnapshot().match).toBe(next);
});

test('at the move cap blocked inputs remain free; extra moves reject while undo/reset stay usable', () => {
  const controller = start(1);
  expect(controller.sendPlayer({ type: 'attempt.undo' }).status).toBe('no-op');
  expect(controller.sendPlayer({ type: 'attempt.reset' }).status).toBe('no-op');
  controller.sendPlayer({ type: 'attempt.move', robotId: 'blue', direction: 'down' });
  const capped = controller.getSnapshot().match;
  expect(controller.sendPlayer({ type: 'attempt.move', robotId: 'blue', direction: 'down' })).toEqual({ status: 'no-op', reason: 'blocked-move' });
  expect(controller.sendPlayer({ type: 'attempt.move', robotId: 'blue', direction: 'left' })).toEqual({ status: 'rejected', reason: 'bid-limit' });
  expect(controller.getSnapshot().match).toBe(capped);
  expect(controller.sendPlayer({ type: 'attempt.undo' }).status).toBe('accepted');
  controller.sendPlayer({ type: 'attempt.move', robotId: 'blue', direction: 'down' });
  expect(controller.sendPlayer({ type: 'attempt.reset' }).status).toBe('accepted');
  const reset = controller.getSnapshot().match;
  if (reset.phase !== 'demonstrating') throw new Error('The cap must not end a demonstration.');
  expect(reset.attempt.moves).toEqual([]);
  expect(reset.attempt.robots).toEqual(reset.round.startRobots);
});

test('multi-robot Give Up creates a fresh next attempt; exhaustion returns a no-point result', () => {
  const controller = start();
  const initial = controller.getSnapshot().match;
  controller.sendPlayer({ type: 'attempt.move', robotId: 'blue', direction: 'down' });
  controller.sendPlayer({ type: 'attempt.move', robotId: 'red', direction: 'right' });
  controller.sendPlayer({ type: 'attempt.giveUp' });
  const next = controller.getSnapshot().match;
  if (next.phase !== 'demonstrating') throw new Error('Expected next bidder.');
  expect(next.activeBidderIndex).toBe(1);
  expect(next.attempt.robots).toEqual(initial.officialRobots);
  expect(next.attempt.moves).toEqual([]);
  expect(next.scores).toBe(initial.scores);
  controller.actAs('alex');
  controller.sendPlayer({ type: 'attempt.giveUp' });
  expect(controller.getSnapshot().match).toMatchObject({ phase: 'round-result', outcome: { kind: 'all-bidders-gave-up' }, completedRounds: 1 });
  expect(controller.getSnapshot().match.officialRobots).toEqual(initial.officialRobots);
});

test('real verified solution through adapter commits all robots and scores once; late reset cannot undo it', () => {
  const controller = createDevelopmentController();
  const initial = controller.getSnapshot().match;
  if (initial.phase !== 'demonstrating') throw new Error('Expected demonstration.');
  const proof = prepareNextRound({ ...options, puzzle: initial.puzzle, robots: initial.officialRobots, usedTargetIds: [] });
  if (proof.status !== 'selected') throw new Error('Expected verified proof.');
  expect(proof.round.target).toEqual(initial.round.target);
  expect(proof.internalProof.length).toBeLessThanOrEqual(initial.bidderQueue[0].value);
  for (const step of proof.internalProof) expect(controller.sendPlayer({ type: 'attempt.move', ...step }).status).toBe('accepted');
  const result = controller.getSnapshot().match;
  expect(result).toMatchObject({ phase: 'round-result', scores: { maria: 1, alex: 0, teo: 0 }, completedRounds: 1 });
  expect(controller.sendPlayer({ type: 'attempt.reset' })).toEqual({ status: 'rejected', reason: 'wrong-phase' });
  expect(controller.getSnapshot().match).toBe(result);
});

test('supplied time and latest acting seat govern commands; a rejected late bid still stores due expiry', () => {
  let nowMs = 1_000;
  const controller = controllerAt(thinking(), () => nowMs);
  controller.sendPlayer({ type: 'bid.submit', value: 3 });
  controller.actAs('alex');
  nowMs = 61_000;
  expect(controller.sendPlayer({ type: 'bid.submit', value: 2 })).toEqual({ status: 'rejected', reason: 'bidding-closed' });
  const state = controller.getSnapshot().match;
  if (state.phase !== 'demonstrating') throw new Error('Rejected action must preserve due expiry.');
  expect(state.bidderQueue.map((bid) => bid.seatId)).toEqual(['maria']);
  controller.actAs('maria');
  controller.sendPlayer({ type: 'attempt.move', robotId: 'blue', direction: 'down' });
  const progressed = controller.getSnapshot().match;
  nowMs += 1_000_000;
  controller.advanceTime();
  expect(controller.getSnapshot().match).toBe(progressed);
});

test('snapshots are stable until an action; subscriptions clean up without creating a new match or reading time', () => {
  const now = vi.fn(() => 1_000);
  const controller = controllerAt(thinking(), now);
  const listener = vi.fn();
  const snapshot = controller.getSnapshot();
  const stop = controller.subscribe(listener);
  expect(controller.getSnapshot()).toBe(snapshot);
  expect(now).not.toHaveBeenCalled();
  controller.actAs('alex');
  expect(listener).toHaveBeenCalledOnce();
  expect(now).not.toHaveBeenCalled();
  controller.actAs('alex');
  expect(listener).toHaveBeenCalledOnce();
  stop();
  controller.sendPlayer({ type: 'bid.submit', value: 4 });
  expect(listener).toHaveBeenCalledOnce();
  expect(now).toHaveBeenCalledOnce();
});

test('unknown seats cannot replace actor or host', () => {
  const controller = start();
  const before = controller.getSnapshot();
  expect(() => controller.actAs('unknown')).toThrow(TypeError);
  expect(controller.getSnapshot()).toBe(before);
  expect(() => createLocalMatchController({ match: before.match, hostSeatId: 'unknown', actingSeatId: 'maria', now: () => 0 })).toThrow(TypeError);
});
