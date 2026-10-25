import { expect, expectTypeOf, test, vi } from 'vitest';
import { starterBoard } from '@robot-puzzle/puzzles';
import { prepareNextRound, RECOMMENDED_ROUND_SETUP_BUDGET } from '@robot-puzzle/puzzles/round-setup';
import {
  createMatch, getMatchResults, prepareMatchRound, transitionMatch,
  type FinishedMatchState, type MatchAction, type MatchState, type MatchTransition,
  type PlayerMatchCommand, type PreparingMatchState, type RoundNumber, type RoundResultMatchState, type ThinkingMatchState,
} from './index';
import { prepareMatchRoundWith } from './preparation';

const players = [
  { seatId: 'maria', nickname: 'Maria' }, { seatId: 'alex', nickname: 'Alex' }, { seatId: 'teo', nickname: 'Teo' },
];
const options = { candidateOrder: starterBoard.targets.map((target) => target.id), budget: RECOMMENDED_ROUND_SETUP_BUDGET };
function initial() { return createMatch({ matchId: 'match-1', players, puzzle: starterBoard }); }
function thinking(state: MatchState = initial()): ThinkingMatchState {
  const next = prepareMatchRound(state, options).state;
  if (next.phase !== 'thinking') throw new Error('Expected verified round.');
  return next;
}
function player(state: MatchState, command: PlayerMatchCommand, actorSeatId = 'maria', hostSeatId = 'maria', nowMs = 1000) {
  return transitionMatch(state, { source: 'player', command, context: { actorSeatId, hostSeatId, nowMs } });
}
function advance(state: MatchState, nowMs = 61_000) {
  return transitionMatch(state, { source: 'controller', command: { type: 'round.advance' }, context: { nowMs } });
}
function resolved(state: MatchState): RoundResultMatchState {
  if (state.phase !== 'round-result') throw new Error('Expected result.');
  return state;
}
function preparing(state: MatchState): PreparingMatchState {
  if (state.phase !== 'preparing') throw new Error('Expected preparation.');
  return state;
}
function skip(state: MatchState) { return player(state, { type: 'round.skip', confirmed: true }); }
function frozen<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) frozen(child);
    Object.freeze(value);
  }
  return value;
}

test('confirmed host skip resolves exactly one unbid round without changing official data', () => {
  const state = thinking();
  const result = skip(state);
  expect(result.outcome.status).toBe('accepted');
  const next = resolved(result.state);
  expect(next.outcome).toEqual({ kind: 'no-bid-skip' });
  expect(next.completedRounds).toBe(1);
  expect(next.scores).toBe(state.scores);
  expect(next.officialRobots).toBe(state.officialRobots);
  expect(next.usedTargetIds).toBe(state.usedTargetIds);
  expect(next.round).toBe(state.round);
  for (const field of ['bids', 'deadlineAtMs', 'attempt', 'bidderQueue']) expect(next).not.toHaveProperty(field);
  expect(skip(next)).toEqual({ state: next, outcome: { status: 'rejected', reason: 'wrong-phase' } });
});

test.each([
  ['maria', 'maria', false, 'confirmation-required'],
  ['alex', 'maria', true, 'not-host'],
  ['maria', 'alex', true, 'not-host'],
  ['ghost', 'maria', true, 'unknown-player'],
] as const)('skip by %s with current host %s and confirmation %s rejects as %s', (actor, host, confirmed, reason) => {
  const state = thinking();
  expect(player(state, { type: 'round.skip', confirmed }, actor, host)).toEqual({ state, outcome: { status: 'rejected', reason } });
});

test('a changed current host may confirm without changing roster or storing host identity', () => {
  const state = thinking();
  const next = resolved(player(state, { type: 'round.skip', confirmed: true }, 'alex', 'alex').state);
  expect(next.players).toBe(state.players);
  expect(next).not.toHaveProperty('hostSeatId');
});

test('skip after a bid never overrides bidding or demonstrations, including at exact expiry', () => {
  const open = player(thinking(), { type: 'bid.submit', value: 5 }).state;
  expect(player(open, { type: 'round.skip', confirmed: true })).toEqual({ state: open, outcome: { status: 'rejected', reason: 'wrong-phase' } });
  const late = player(open, { type: 'round.skip', confirmed: true }, 'maria', 'maria', 61_000);
  expect(late.outcome).toEqual({ status: 'rejected', reason: 'wrong-phase' });
  expect(late.state.phase).toBe('demonstrating');
  expect(late.state.completedRounds).toBe(0);
  expect(skip(late.state).state).toBe(late.state);
});

test.each([undefined, 'true', 1, null])('malformed skip confirmation %j fails before deadline normalization', (confirmed) => {
  const state = player(thinking(), { type: 'bid.submit', value: 5 }).state;
  const action = { source: 'player', command: { type: 'round.skip', confirmed }, context: { actorSeatId: 'maria', hostSeatId: 'maria', nowMs: 61_000 } };
  expect(transitionMatch(state, action as unknown as MatchAction)).toEqual({ state, outcome: { status: 'rejected', reason: 'invalid-command' } });
});

test('round results remain stable until explicit controller advance; advance does not resolve again', () => {
  const state = resolved(skip(thinking()).state);
  for (const command of [{ type: 'bid.submit', value: 5 }, { type: 'attempt.giveUp' }, { type: 'attempt.undo' }] as const) {
    expect(player(state, command).state).toBe(state);
  }
  expect(transitionMatch(state, { source: 'controller', command: { type: 'time.advance' }, context: { nowMs: Number.MAX_SAFE_INTEGER } }).state).toBe(state);
  const next = preparing(advance(state).state);
  expect(next.completedRounds).toBe(1);
  expect(next.preparation).toEqual({ status: 'not-attempted' });
  for (const field of ['round', 'outcome', 'attempt', 'bids', 'deadlineAtMs', 'bidderQueue']) expect(next).not.toHaveProperty(field);
  for (const field of ['scores', 'officialRobots', 'usedTargetIds', 'puzzle', 'players'] as const) expect(next[field]).toBe(state[field]);
  expect(advance(next)).toEqual({ state: next, outcome: { status: 'rejected', reason: 'wrong-phase' } });
  expect(skip(next).outcome).toEqual({ status: 'rejected', reason: 'wrong-phase' });
});

test('advancing in an active phase rejects but retains due deadline expiry', () => {
  for (const state of [initial(), thinking()]) expect(advance(state).outcome).toEqual({ status: 'rejected', reason: 'wrong-phase' });
  const open = player(thinking(), { type: 'bid.submit', value: 5 }).state;
  expect(advance(open, 1000).state).toBe(open);
  const late = advance(open);
  expect(late.outcome).toEqual({ status: 'rejected', reason: 'wrong-phase' });
  expect(late.state.phase).toBe('demonstrating');
  expect(advance(late.state).state).toBe(late.state);
});

test('multi-robot success advances and really prepares from committed positions without scoring twice', () => {
  const state = thinking(); // First ordered target is red-star, requiring helper movement.
  const proof = prepareNextRound({ ...options, puzzle: state.puzzle, robots: state.officialRobots, usedTargetIds: [] });
  if (proof.status !== 'selected') throw new Error('Expected verified solution.');
  let current = player(state, { type: 'bid.submit', value: proof.internalProof.length }).state;
  current = transitionMatch(current, { source: 'controller', command: { type: 'time.advance' }, context: { nowMs: 61_000 } }).state;
  for (const step of proof.internalProof) current = player(current, { type: 'attempt.move', ...step }, 'maria', 'maria', 61_000).state;
  const result = resolved(current);
  expect(result.officialRobots.red).not.toEqual(state.officialRobots.red);
  expect(result.officialRobots.blue).not.toEqual(state.officialRobots.blue);
  const next = preparing(advance(result).state);
  expect(next.officialRobots).toEqual(result.officialRobots);
  expect(next.scores).toEqual({ maria: 1, alex: 0, teo: 0 });
  const ready = thinking(next);
  expect(ready.round.number).toBe(2);
  expect(ready.round.startRobots).toEqual(result.officialRobots);
  expect(ready.scores).toEqual(result.scores);
  expect(ready.usedTargetIds).toHaveLength(2);
  expect(ready.round.target.id).not.toBe(state.round.target.id);
  expect(ready.officialRobots).toEqual(result.officialRobots);
});

test('exhausted bidders resolve once; next preparation retains unchanged official positions', () => {
  const state = thinking();
  const open = player(state, { type: 'bid.submit', value: 5 }).state;
  const demo = transitionMatch(open, { source: 'controller', command: { type: 'time.advance' }, context: { nowMs: 61_000 } }).state;
  const moved = player(demo, { type: 'attempt.move', robotId: 'blue', direction: 'down' }).state;
  const result = resolved(player(moved, { type: 'attempt.giveUp' }).state);
  expect(result.outcome).toEqual({ kind: 'all-bidders-gave-up' });
  const next = preparing(advance(result).state);
  expect(next.completedRounds).toBe(1);
  expect(next.scores).toEqual(state.scores);
  expect(next.officialRobots).toEqual(state.officialRobots);
  expect(next.usedTargetIds).toEqual(state.usedTargetIds);
  expect(thinking(next).round.startRobots).toEqual(state.officialRobots);
});

test('deferred preparation after advancement consumes nothing; explicit retry reveals only the next round', () => {
  const committed = resolved(skip(thinking()).state);
  const state = preparing(advance(committed).state);
  const lowBudget = { ...options, budget: { perCandidate: { maxExpandedStates: 0, maxStoredStates: 1 }, maxTotalExpandedStates: 0 } };
  const failed = preparing(prepareMatchRound(state, lowBudget).state);
  expect(failed.preparation.status).toBe('deferred');
  expect(failed.completedRounds).toBe(1);
  expect(failed.usedTargetIds).toEqual(committed.usedTargetIds);
  expect(failed.officialRobots).toEqual(committed.officialRobots);
  expect(failed.scores).toEqual(committed.scores);
  expect(failed).not.toHaveProperty('round');
  const ready = thinking(failed);
  expect(ready.round.number).toBe(2);
  expect(ready.completedRounds).toBe(1);
  expect(ready.usedTargetIds).toHaveLength(2);
});

test('unavailable preparation after advance preserves the resolved state and count', () => {
  const state = preparing(advance(resolved(skip(thinking()).state)).state);
  // Controlled trusted T10 result: lifecycle preservation is independent of search feasibility.
  const real = prepareNextRound({ ...options, puzzle: state.puzzle, robots: state.officialRobots, usedTargetIds: state.usedTargetIds });
  const preparer = vi.fn(() => ({ status: 'unavailable' as const, reason: 'all-eligible-targets-unsolvable' as const, diagnostics: real.diagnostics }));
  const next = preparing(prepareMatchRoundWith(state, options, preparer).state);
  expect(preparer).toHaveBeenCalledOnce();
  expect(next.preparation.status).toBe('unavailable');
  expect(next.completedRounds).toBe(state.completedRounds);
  expect(next.officialRobots).toEqual(state.officialRobots);
  expect(next.scores).toEqual(state.scores);
  expect(next.usedTargetIds).toEqual(state.usedTargetIds);
  expect(next).not.toHaveProperty('round');
});

function tenthResult(): RoundResultMatchState {
  const ready = thinking();
  // Boundary fixture; mixed real ten-round flow is T11.6.
  return {
    ...resolved(skip(ready).state), completedRounds: 10,
    round: { ...ready.round, number: 10 }, usedTargetIds: options.candidateOrder.slice(0, 10),
  };
}
function finished(): FinishedMatchState {
  const state = advance(tenthResult()).state;
  if (state.phase !== 'finished') throw new Error('Expected finished match.');
  return state;
}

test('tenth result advances directly to Finished, keeps final data, and cannot prepare round eleven', () => {
  const result = tenthResult();
  const transition = advance(result);
  expect(transition.outcome.status).toBe('accepted');
  const next = transition.state;
  expect(next.phase).toBe('finished');
  expect(next.completedRounds).toBe(10);
  expect(next.usedTargetIds).toHaveLength(10);
  expect(next.scores).toBe(result.scores);
  expect(next.officialRobots).toBe(result.officialRobots);
  for (const field of ['round', 'outcome', 'preparation', 'attempt', 'bidderQueue', 'deadlineAtMs']) expect(next).not.toHaveProperty(field);
  const preparer = vi.fn(prepareNextRound);
  expect(prepareMatchRoundWith(next, options, preparer).outcome).toEqual({ status: 'rejected', reason: 'match-finished' });
  expect(preparer).not.toHaveBeenCalled();
  expect(advance(next)).toEqual({ state: next, outcome: { status: 'rejected', reason: 'match-finished' } });
});

test.each([1, 2, 3, 4, 5, 6, 7, 8, 9] as const)('resolved round %i advances to Preparing, never prematurely Finished', (count) => {
  const base = tenthResult();
  const state: RoundResultMatchState = {
    ...base, completedRounds: count, round: { ...base.round, number: count },
    usedTargetIds: options.candidateOrder.slice(0, count),
  };
  const next = preparing(advance(state).state);
  expect(next.completedRounds).toBe(count);
  expect(next.usedTargetIds).toEqual(state.usedTargetIds);
});

test('success in round ten awards once before advancement and preserves final all-robot positions', () => {
  const first = thinking();
  const state: ThinkingMatchState = {
    ...first, completedRounds: 9,
    round: { ...first.round, number: 10 as RoundNumber },
    usedTargetIds: [
      ...options.candidateOrder.filter((id) => id !== first.round.target.id).slice(0, 9), first.round.target.id,
    ],
  };
  const proof = prepareNextRound({ ...options, puzzle: state.puzzle, robots: state.officialRobots, usedTargetIds: [] });
  if (proof.status !== 'selected') throw new Error('Expected verified solution.');
  let current = player(state, { type: 'bid.submit', value: proof.internalProof.length }).state;
  for (const step of proof.internalProof) current = player(current, { type: 'attempt.move', ...step }, 'maria', 'maria', 61_000).state;
  const result = resolved(current);
  expect(result.completedRounds).toBe(10);
  expect(result.scores.maria).toBe(1);
  const next = advance(result).state;
  expect(next.phase).toBe('finished');
  expect(next.scores.maria).toBe(1);
  expect(next.officialRobots).toEqual(result.officialRobots);
  expect(next.usedTargetIds).toHaveLength(10);
});

test.each<PlayerMatchCommand>([
  { type: 'bid.submit', value: 1 }, { type: 'round.skip', confirmed: true },
  { type: 'attempt.move', robotId: 'blue', direction: 'down' },
  { type: 'attempt.undo' }, { type: 'attempt.reset' }, { type: 'attempt.giveUp' },
])('finished match rejects gameplay %j without changes', (command) => {
  const state = finished();
  expect(player(state, command)).toEqual({ state, outcome: { status: 'rejected', reason: 'match-finished' } });
});

test.each([
  [{ maria: 1, alex: 5, teo: 2 }, ['alex', 'teo', 'maria'], ['alex']],
  [{ maria: 4, alex: 1, teo: 4 }, ['maria', 'teo', 'alex'], ['maria', 'teo']],
  [{ maria: 0, alex: 0, teo: 0 }, ['maria', 'alex', 'teo'], ['maria', 'alex', 'teo']],
] as const)('final results sort scores and include every shared winner (%j)', (scores, order, winners) => {
  const state = frozen({ ...finished(), scores });
  const before = JSON.stringify(state);
  const results = getMatchResults(state);
  expect(results.standings.map((row) => row.seatId)).toEqual(order);
  expect(results.winnerSeatIds).toEqual(winners);
  expect(results.standings).toContainEqual({ seatId: 'alex', nickname: 'Alex', score: scores.alex });
  expect(JSON.stringify(state)).toBe(before);
  expect(getMatchResults(state)).toEqual(results);
  expect(state.players.map((seat) => seat.seatId)).toEqual(['maria', 'alex', 'teo']);
});

test('final result selector rejects a non-finished state supplied outside its type contract', () => {
  expect(() => getMatchResults(initial() as unknown as FinishedMatchState)).toThrow(TypeError);
});

test('skip and advancement deterministically preserve frozen inputs', () => {
  const start = frozen(thinking());
  const before = JSON.stringify(start);
  const result = frozen(resolved(skip(start).state));
  expect(skip(start).state).toEqual(result);
  expect(advance(result)).toEqual(advance(result));
  expect(JSON.stringify(start)).toBe(before);
  expectTypeOf<typeof transitionMatch>().toEqualTypeOf<MatchTransition>();
});
