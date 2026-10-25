import { expect, expectTypeOf, test } from 'vitest';
import { moveAttemptRobot } from '@robot-puzzle/game-engine';
import { starterBoard } from '@robot-puzzle/puzzles';
import { prepareNextRound, RECOMMENDED_ROUND_SETUP_BUDGET } from '@robot-puzzle/puzzles/round-setup';
import {
  BIDDING_WINDOW_MS, createMatch, prepareMatchRound, transitionMatch,
  type BiddingMatchState, type BiddingStageAction, type DemonstratingMatchState, type DemonstrationStageAction,
  type FinishedMatchState, type MatchAction, type MatchPlayer, type MatchState,
  type RoundResultMatchState, type ThinkingMatchState,
} from './index';
import { snapshotRoundPreparation } from './preparation';

const players: readonly MatchPlayer[] = [
  { seatId: 'maria', nickname: 'Maria' }, { seatId: 'alex', nickname: 'Alex' }, { seatId: 'teo', nickname: 'Teo' },
];
const setupOptions = {
  candidateOrder: ['blue-star', ...starterBoard.targets.map((target) => target.id).filter((id) => id !== 'blue-star')],
  budget: RECOMMENDED_ROUND_SETUP_BUDGET,
};

function initial(roster = players) {
  return createMatch({ matchId: 'match-1', players: roster, puzzle: starterBoard });
}

function ready(roster = players): ThinkingMatchState {
  const result = prepareMatchRound(initial(roster), setupOptions);
  if (result.state.phase !== 'thinking') throw new Error('Expected real T10 preparation to start a round.');
  return result.state;
}

function action(seatId: string, value: number, nowMs = 1_000): Extract<BiddingStageAction, { source: 'player' }> {
  return { source: 'player', command: { type: 'bid.submit', value }, context: { actorSeatId: seatId, hostSeatId: 'maria', nowMs } };
}

function bid(state: MatchState, seatId: string, value: number, nowMs = 1_000) {
  return transitionMatch(state, action(seatId, value, nowMs));
}

function tick(state: MatchState, nowMs: number) {
  return transitionMatch(state, { source: 'controller', command: { type: 'time.advance' }, context: { nowMs } });
}

function bidding(state: MatchState): BiddingMatchState {
  expect(state.phase).toBe('bidding');
  if (state.phase !== 'bidding') throw new Error('Expected bidding.');
  return state;
}

function demonstrating(state: MatchState): DemonstratingMatchState {
  expect(state.phase).toBe('demonstrating');
  if (state.phase !== 'demonstrating') throw new Error('Expected demonstration entry.');
  return state;
}

test('real create/prepare/first bid opens one absolute 60-second window', () => {
  const thinking = ready();
  const result = bid(thinking, 'maria', 7);
  expect(result.outcome.status).toBe('accepted');
  const state = bidding(result.state);
  expect(state.deadlineAtMs).toBe(1_000 + BIDDING_WINDOW_MS);
  expect(state.bids).toEqual([{ seatId: 'maria', value: 7, firstAcceptedOrder: 0 }]);
  expect(state.round).toEqual(thinking.round);
  expect(state.officialRobots).toEqual(thinking.officialRobots);
  expect(state.scores).toEqual(thinking.scores);
  expect(state.usedTargetIds).toEqual(thinking.usedTargetIds);
  expect(state.completedRounds).toBe(0);
  expect(state).not.toHaveProperty('attempt');
  expect(thinking).not.toHaveProperty('bids');
});

test.each([1, 7, Number.MAX_SAFE_INTEGER])('accepts any representable positive integer bid: %s', (value) => {
  expect(bid(ready(), 'maria', value).outcome.status).toBe('accepted');
});

test.each([0, -1, 1.5, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1, '7', null, undefined])(
  'invalid first or revised bid %s cannot start/extend a window', (value) => {
    const thinking = ready();
    const first = bid(thinking, 'maria', value as number);
    expect(first.outcome).toEqual({ status: 'rejected', reason: 'invalid-bid' });
    expect(first.state).toBe(thinking);
    const open = bidding(bid(thinking, 'maria', 7).state);
    const revision = bid(open, 'maria', value as number, 2_000);
    expect(revision.outcome).toEqual({ status: 'rejected', reason: 'invalid-bid' });
    expect(revision.state).toBe(open);
  },
);

test.each([5, 7, 12])('another player may bid %i when the existing bid is 7', (value) => {
  const first = bidding(bid(ready(), 'maria', 7).state);
  const result = bid(first, 'alex', value, 30_000);
  expect(result.outcome.status).toBe('accepted');
  const state = bidding(result.state);
  expect(state.bids[1]).toEqual({ seatId: 'alex', value, firstAcceptedOrder: 1 });
  expect(state.deadlineAtMs).toBe(first.deadlineAtMs);
});

test('own reductions retain first acceptance; identical bid is no-op and own raises fail', () => {
  let state = bidding(bid(ready(), 'maria', 9).state);
  state = bidding(bid(state, 'alex', 7, 2_000).state);
  const lowered = bidding(bid(state, 'maria', 7, 60_000).state);
  expect(lowered.bids[0]).toEqual({ seatId: 'maria', value: 7, firstAcceptedOrder: 0 });
  expect(lowered.deadlineAtMs).toBe(state.deadlineAtMs);
  const same = bid(lowered, 'maria', 7, 60_001);
  expect(same.outcome).toEqual({ status: 'no-op', reason: 'same-bid' });
  expect(same.state).toBe(lowered);
  const raised = bid(lowered, 'maria', 8, 60_002);
  expect(raised.outcome).toEqual({ status: 'rejected', reason: 'bid-increase' });
  expect(raised.state).toBe(lowered);
  expect(demonstrating(tick(lowered, lowered.deadlineAtMs).state).bidderQueue.map((entry) => entry.seatId)).toEqual(['maria', 'alex']);
});

test('equal timestamps and reductions still prioritize original first acceptance', () => {
  let state = bidding(bid(ready(), 'maria', 10).state);
  state = bidding(bid(state, 'alex', 7).state);
  state = bidding(bid(state, 'teo', 7).state);
  state = bidding(bid(state, 'maria', 7, 50_000).state);
  const expired = demonstrating(tick(state, 61_000).state);
  expect(expired.bidderQueue).toEqual([
    { seatId: 'maria', value: 7, firstAcceptedOrder: 0 },
    { seatId: 'alex', value: 7, firstAcceptedOrder: 1 },
    { seatId: 'teo', value: 7, firstAcceptedOrder: 2 },
  ]);
});

test('six-player bids sort by final value then acceptance, never nickname or seat order', () => {
  const roster = Array.from({ length: 6 }, (_, index) => ({ seatId: index === 0 ? 'maria' : `seat-${index}`, nickname: 'Same nickname' }));
  let state: MatchState = ready(roster);
  const values = [5, 3, 3, 10, 1, 4];
  for (let index = 0; index < roster.length; index++) state = bid(state, roster[index].seatId, values[index]).state;
  const expired = demonstrating(tick(state, 61_000).state);
  expect(expired.bidderQueue.map((entry) => entry.seatId)).toEqual(['seat-4', 'seat-1', 'seat-2', 'seat-5', 'maria', 'seat-3']);
});

test('expiry freezes final bids and creates the first attempt without changing official state', () => {
  const first = bidding(bid(ready(), 'maria', 7).state);
  const open = bidding(bid(first, 'alex', 5, 2_000).state);
  const result = tick(open, open.deadlineAtMs);
  expect(result.outcome.status).toBe('accepted');
  const state = demonstrating(result.state);
  expect(state.bidderQueue.map((entry) => entry.seatId)).toEqual(['alex', 'maria']);
  expect(state.bidderQueue.some((entry) => entry.seatId === 'teo')).toBe(false);
  expect(state.activeBidderIndex).toBe(0);
  expect(state.bidderQueue[0].value).toBe(5);
  expect(state.attempt.robots).toEqual(open.round.startRobots);
  expect(state.attempt.roundStartRobots).toEqual(open.round.startRobots);
  expect(state.attempt.moves).toEqual([]);
  expect(state.attempt.roundStartRobots).not.toBe(open.round.startRobots);
  expect(state.officialRobots).toEqual(open.officialRobots);
  expect(state.scores).toEqual(open.scores);
  expect(state.usedTargetIds).toEqual(open.usedTargetIds);
  expect(state.completedRounds).toBe(open.completedRounds);
  expect(state).not.toHaveProperty('deadlineAtMs');
  expect(state).not.toHaveProperty('bids');
  expect(state.bidderQueue[0]).not.toBe(open.bids[1]);
});

test('time immediately before the deadline is no-op; exactly at/after it closes bidding', () => {
  const open = bidding(bid(ready(), 'maria', 7).state);
  const early = tick(open, open.deadlineAtMs - 1);
  expect(early.outcome).toEqual({ status: 'no-op', reason: 'deadline-not-due' });
  expect(early.state).toBe(open);
  const at = tick(open, open.deadlineAtMs);
  expect(at.outcome.status).toBe('accepted');
  demonstrating(at.state);
  expect(tick(open, open.deadlineAtMs + 1).state).toEqual(at.state);
  const stillOpen = bid(open, 'alex', 5, open.deadlineAtMs - 1);
  expect(stillOpen.outcome.status).toBe('accepted');
});

test.each([0, 1, 10_000])('a late new bid closes the window without entering the queue (offset %i)', (offset) => {
  const open = bidding(bid(ready(), 'maria', 7).state);
  const result = bid(open, 'alex', 1, open.deadlineAtMs + offset);
  expect(result.outcome).toEqual({ status: 'rejected', reason: 'bidding-closed' });
  expect(demonstrating(result.state).bidderQueue).toEqual([{ seatId: 'maria', value: 7, firstAcceptedOrder: 0 }]);
});

test.each([3, 7, 10, NaN])('a late revision %s is rejected without changing the final bid', (value) => {
  const open = bidding(bid(ready(), 'maria', 7).state);
  const result = bid(open, 'maria', value, open.deadlineAtMs);
  expect(result.outcome).toEqual({ status: 'rejected', reason: 'bidding-closed' });
  expect(demonstrating(result.state).bidderQueue[0].value).toBe(7);
});

test('an unknown actor cannot bid, but cannot suppress an independently due deadline either', () => {
  const thinking = ready();
  for (const seatId of ['ghost', '__proto__']) {
    const first = bid(thinking, seatId, 7);
    expect(first.outcome).toEqual({ status: 'rejected', reason: 'unknown-player' });
    expect(first.state).toBe(thinking);
  }
  const open = bidding(bid(thinking, 'maria', 7).state);
  const late = bid(open, 'ghost', 1, open.deadlineAtMs);
  expect(late.outcome).toEqual({ status: 'rejected', reason: 'unknown-player' });
  demonstrating(late.state);
});

test.each([NaN, Infinity, -1, 0.5, Number.MAX_SAFE_INTEGER + 1, '1000', null, undefined])('invalid authoritative timestamp %s leaves state unchanged', (nowMs) => {
  const thinking = ready();
  const bad = action('maria', 7, nowMs as number);
  // Passing undefined as a defaulted helper argument would otherwise select 1000.
  const malformed = { ...bad, context: { ...bad.context, nowMs } } as unknown as BiddingStageAction;
  const result = transitionMatch(thinking, malformed);
  expect(result.outcome).toEqual({ status: 'rejected', reason: 'invalid-context' });
  expect(result.state).toBe(thinking);
  const controller = tick(thinking, nowMs as number);
  expect(controller.outcome).toEqual({ status: 'rejected', reason: 'invalid-context' });
  expect(controller.state).toBe(thinking);
});

test('zero time and the largest safe deadline work; unsafe deadline addition is rejected', () => {
  expect(bidding(bid(ready(), 'maria', 1, 0).state).deadlineAtMs).toBe(60_000);
  const latestStart = Number.MAX_SAFE_INTEGER - BIDDING_WINDOW_MS;
  const valid = bidding(bid(ready(), 'maria', 1, latestStart).state);
  expect(valid.deadlineAtMs).toBe(Number.MAX_SAFE_INTEGER);
  demonstrating(tick(valid, Number.MAX_SAFE_INTEGER).state);
  const thinking = ready();
  const invalid = bid(thinking, 'maria', 1, latestStart + 1);
  expect(invalid.outcome).toEqual({ status: 'rejected', reason: 'invalid-context' });
  expect(invalid.state).toBe(thinking);
});

test.each([
  null,
  { actorSeatId: 'maria', nowMs: 1000 },
  { actorSeatId: 'maria', hostSeatId: 'ghost', nowMs: 1000 },
  { actorSeatId: '', hostSeatId: 'maria', nowMs: 1000 },
])('rejects malformed trusted player context %#', (context) => {
  const thinking = ready();
  const result = transitionMatch(thinking, { source: 'player', command: { type: 'bid.submit', value: 7 }, context } as unknown as BiddingStageAction);
  expect(result.outcome).toEqual({ status: 'rejected', reason: 'invalid-context' });
  expect(result.state).toBe(thinking);
});

test('current host can change in trusted context without modifying the roster or bids', () => {
  const thinking = ready();
  const supplied = action('maria', 7);
  const result = transitionMatch(thinking, { ...supplied, context: { actorSeatId: 'maria', hostSeatId: 'alex', nowMs: 1000 } });
  expect(result.outcome.status).toBe('accepted');
  expect(result.state.players).toEqual(thinking.players);
  expect(result.state).not.toHaveProperty('hostSeatId');
});

test('bid payload metadata cannot override the trusted actor or authoritative time', () => {
  const supplied = {
    source: 'player',
    command: { type: 'bid.submit', value: 7, actorSeatId: 'alex', nowMs: 999_999 },
    context: { actorSeatId: 'maria', hostSeatId: 'maria', nowMs: 1000 },
  } as unknown as BiddingStageAction;
  const state = bidding(transitionMatch(ready(), supplied).state);
  expect(state.bids[0].seatId).toBe('maria');
  expect(state.deadlineAtMs).toBe(61_000);
});

test.each([
  null, { source: 'other', command: { type: 'time.advance' }, context: { nowMs: 1000 } },
  { source: 'player', command: null, context: { actorSeatId: 'maria', hostSeatId: 'maria', nowMs: 1000 } },
  { source: 'player', command: { type: 'time.advance' }, context: { actorSeatId: 'maria', hostSeatId: 'maria', nowMs: 1000 } },
  { source: 'controller', command: { type: 'bid.submit', value: 7 }, context: { nowMs: 1000 } },
  { source: 'controller', command: { type: 'round.skip', confirmed: true }, context: { nowMs: 1000 } },
  { source: 'player', command: { type: 'round.advance' }, context: { actorSeatId: 'maria', hostSeatId: 'maria', nowMs: 1000 } },
])('malformed/source-mismatched command %# is rejected', (supplied) => {
  const thinking = ready();
  const result = transitionMatch(thinking, supplied as unknown as BiddingStageAction);
  expect(result.outcome).toEqual({ status: 'rejected', reason: 'invalid-command' });
  expect(result.state).toBe(thinking);
});

test('time checks outside bidding do not add thinking/demonstration timers or restart progressed attempts', () => {
  const thinking = ready();
  const result: RoundResultMatchState = { ...thinking, phase: 'round-result', completedRounds: 1, outcome: { kind: 'no-bid-skip' } };
  const { round: _round, ...common } = thinking;
  const finished: FinishedMatchState = { ...common, phase: 'finished', completedRounds: 10, usedTargetIds: starterBoard.targets.slice(0, 10).map((target) => target.id) };
  const open = bid(bid(thinking, 'maria', 7).state, 'alex', 5, 2000).state;
  const first = demonstrating(tick(open, 61_000).state);
  // Legal fixture for future attempt handlers; time normalization must preserve it.
  const progressed = { ...first, activeBidderIndex: 1, attempt: moveAttemptRobot(first.puzzle.board, first.attempt, 'blue', 'down').attempt };
  for (const state of [initial(), thinking, progressed, result, finished]) {
    const checked = tick(state, Number.MAX_SAFE_INTEGER);
    expect(checked.outcome).toEqual({ status: 'no-op', reason: 'no-active-deadline' });
    expect(checked.state).toBe(state);
  }
  expect(progressed.attempt.moves).toHaveLength(1);
  expect(progressed.activeBidderIndex).toBe(1);
  expect(tick(progressed, 61_000).state).toBe(progressed);
});

test('bids in preparing, round-result, finished, or demonstrating cannot alter match rules', () => {
  const thinking = ready();
  const { round: _round, ...common } = thinking;
  const finished: FinishedMatchState = { ...common, phase: 'finished', completedRounds: 10, usedTargetIds: starterBoard.targets.slice(0, 10).map((target) => target.id) };
  const result: RoundResultMatchState = { ...thinking, phase: 'round-result', completedRounds: 1, outcome: { kind: 'no-bid-skip' } };
  const demo = demonstrating(tick(bid(thinking, 'maria', 7).state, 61_000).state);
  for (const [state, reason] of [[initial(), 'wrong-phase'], [result, 'wrong-phase'], [finished, 'match-finished'], [demo, 'bidding-closed']] as const) {
    const rejected = bid(state, 'maria', 1, 62_000);
    expect(rejected.outcome).toEqual({ status: 'rejected', reason });
    expect(rejected.state).toBe(state);
  }
});

test('controller-prepared results route to the existing handler and cannot be forged as player commands', () => {
  const state = initial();
  const request = snapshotRoundPreparation(state, setupOptions);
  const result = prepareNextRound(request.setup);
  const prepared = { type: 'round.prepared', request, result } as const;
  const accepted = transitionMatch(state, { source: 'controller', command: prepared, context: { nowMs: 0 } });
  expect(accepted.outcome.status).toBe('accepted');
  expect(accepted.state.phase).toBe('thinking');
  expect(accepted.state).not.toHaveProperty('internalProof');
  const forged = transitionMatch(state, { source: 'player', command: prepared, context: { actorSeatId: 'maria', hostSeatId: 'maria', nowMs: 0 } } as unknown as BiddingStageAction);
  expect(forged.outcome).toEqual({ status: 'rejected', reason: 'invalid-command' });
  expect(forged.state).toBe(state);
  const stale = transitionMatch({ ...state, matchId: 'different' }, { source: 'controller', command: prepared, context: { nowMs: 0 } });
  expect(stale.outcome).toEqual({ status: 'rejected', reason: 'stale-preparation' });
  const open = bidding(bid(accepted.state, 'maria', 7).state);
  const wrongPhase = transitionMatch(open, { source: 'controller', command: prepared, context: { nowMs: open.deadlineAtMs } });
  expect(wrongPhase.outcome).toEqual({ status: 'rejected', reason: 'wrong-phase' });
  demonstrating(wrongPhase.state);
});

function freeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

test('frozen state/actions remain unchanged across bids, corrections, rejections, and expiry', () => {
  const thinking = freeze(ready());
  const firstAction = freeze(action('maria', 9));
  const first = transitionMatch(thinking, firstAction);
  expect(transitionMatch(thinking, firstAction)).toEqual(first);
  let state = freeze(bidding(first.state));
  state = freeze(bidding(bid(state, 'alex', 7, 2_000).state));
  const before = JSON.stringify(state);
  const reduced = bid(state, 'maria', 7, 3_000);
  expect(bid(state, 'maria', 7, 3_000)).toEqual(reduced);
  const expired = tick(freeze(reduced.state), 61_000);
  expect(tick(reduced.state, 61_000)).toEqual(expired);
  expect(JSON.stringify(state)).toBe(before);
  expect(state.bids[0].value).toBe(9);
  expect(demonstrating(expired.state).bidderQueue[0].seatId).toBe('maria');
});

test('incremental reducer exposes only implemented commands, as a subset of the full action contract', () => {
  expectTypeOf<Parameters<typeof transitionMatch>[1]>().toEqualTypeOf<MatchAction>();
  expectTypeOf<BiddingStageAction>().toExtend<MatchAction>();
  expectTypeOf<BiddingStageAction>().toExtend<DemonstrationStageAction>();
  expectTypeOf<MatchAction>().not.toExtend<DemonstrationStageAction>();
  expectTypeOf<Extract<Extract<BiddingStageAction, { source: 'player' }>['command'], { type: 'attempt.move' | 'round.skip' }>>().toBeNever();
});
