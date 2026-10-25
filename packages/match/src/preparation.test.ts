import { expect, test, vi } from 'vitest';
import { isTargetComplete, moveRobot } from '@robot-puzzle/game-engine';
import { puzzleCatalog, starterBoard, type PuzzleBoard } from '@robot-puzzle/puzzles';
import {
  prepareNextRound, RECOMMENDED_ROUND_SETUP_BUDGET,
} from '@robot-puzzle/puzzles/round-setup';
import {
  createMatch, prepareMatchRound, type FinishedMatchState, type MatchState, type PreparingMatchState,
  type RoundPreparationOptions, type ThinkingMatchState,
} from './index';
import { acceptRoundPreparation, prepareMatchRoundWith, snapshotRoundPreparation } from './preparation';

function create(puzzle = starterBoard): PreparingMatchState {
  return createMatch({ matchId: 'match-1', players: [{ seatId: 'maria', nickname: 'Maria' }, { seatId: 'alex', nickname: 'Alex' }], puzzle });
}

function options(puzzle = starterBoard): RoundPreparationOptions {
  return { candidateOrder: puzzle.targets.map((target) => target.id), budget: RECOMMENDED_ROUND_SETUP_BUDGET };
}

function proofFor(state: PreparingMatchState, config = options(state.puzzle)) {
  const request = snapshotRoundPreparation(state, config);
  const result = prepareNextRound(request.setup);
  expect(result.status).toBe('selected');
  if (result.status !== 'selected') throw new Error('Expected fixture to have a verified target.');
  return { request, result };
}

function thinking(state: MatchState): ThinkingMatchState {
  expect(state.phase).toBe('thinking');
  if (state.phase !== 'thinking') throw new Error('Expected a started round.');
  return state;
}

test.each(puzzleCatalog.map((puzzle) => [puzzle.id, puzzle] as const))('%s prepares and reveals a real verified first round', (_, puzzle) => {
  const initial = create(puzzle);
  const transition = prepareMatchRound(initial, options(puzzle));
  expect(transition.outcome.status).toBe('accepted');
  const state = thinking(transition.state);
  expect(state.round.number).toBe(1);
  expect(puzzle.targets).toContainEqual(state.round.target);
  expect(state.round.startRobots).toEqual(initial.officialRobots);
  expect(state.round.startRobots).not.toBe(initial.officialRobots);
  expect(state.officialRobots).toEqual(initial.officialRobots);
  expect(state.usedTargetIds).toEqual([state.round.target.id]);
  expect(state.completedRounds).toBe(0);
  expect(state.scores).toEqual(initial.scores);
  expect(state).not.toHaveProperty('preparation');
  expect(state).not.toHaveProperty('internalProof');
  expect(state).not.toHaveProperty('attempt');
  expect(state).not.toHaveProperty('deadlineAtMs');
  expect(initial.usedTargetIds).toEqual([]);
});

test('prepares from all current carry-forward positions, preserving score and used-target history', () => {
  const initial = create();
  const first = proofFor(initial).result;
  let robots = initial.officialRobots;
  for (const move of first.internalProof) {
    const moved = moveRobot(initial.puzzle.board, robots, move.robotId, move.direction);
    expect(moved.moved).toBe(true);
    robots = moved.robots;
  }
  expect(isTargetComplete(robots, first.round.target)).toBe(true);
  expect(robots.red).not.toEqual(initial.officialRobots.red);
  expect(robots.blue).not.toEqual(initial.officialRobots.blue);
  // Fixture for the future success/advance transitions, which are not implemented here.
  const carried: PreparingMatchState = {
    ...initial, officialRobots: robots, completedRounds: 1,
    usedTargetIds: [first.round.target.id], scores: { maria: 1, alex: 0 },
  };
  const { state } = prepareMatchRound(carried, options());
  const next = thinking(state);
  expect(next.round.number).toBe(2);
  expect(next.round.startRobots).toEqual(robots);
  expect(next.officialRobots).toEqual(robots);
  expect(next.scores).toEqual(carried.scores);
  expect(next.usedTargetIds).toEqual([first.round.target.id, next.round.target.id]);
  expect(next.round.target.id).not.toBe(first.round.target.id);
  expect(next.completedRounds).toBe(1);
});

test('target/round-start snapshots do not alias the preparer result, and proof-final positions are never committed', () => {
  const initial = create();
  const { request, result } = proofFor(initial);
  const next = thinking(acceptRoundPreparation(initial, request, result).state);
  expect(next.round.target).not.toBe(result.round.target);
  expect(next.round.target.position).not.toBe(result.round.target.position);
  expect(next.round.startRobots).not.toBe(result.round.roundStartRobots);
  expect(isTargetComplete(next.officialRobots, next.round.target)).toBe(false);
  expect(JSON.stringify(next)).not.toContain('internalProof');
});

test('a repeated acceptance cannot reveal the same target twice', () => {
  const initial = create();
  const { request, result } = proofFor(initial);
  const first = acceptRoundPreparation(initial, request, result);
  const repeated = acceptRoundPreparation(first.state, request, result);
  expect(repeated.outcome).toEqual({ status: 'rejected', reason: 'wrong-phase' });
  expect(repeated.state).toBe(first.state);
  expect(repeated.state.usedTargetIds).toHaveLength(1);
});

test('deferred preparation preserves official state and consumes no round; an explicit retry can succeed', () => {
  const initial = create();
  const zeroBudget = { ...options(), budget: { ...RECOMMENDED_ROUND_SETUP_BUDGET, maxTotalExpandedStates: 0 } };
  const first = prepareMatchRound(initial, zeroBudget);
  expect(first.outcome.status).toBe('accepted');
  expect(first.state).toMatchObject({
    phase: 'preparing', completedRounds: 0, usedTargetIds: [], scores: initial.scores,
    officialRobots: initial.officialRobots, preparation: { status: 'deferred', reason: 'total-expansion-limit' },
  });
  expect(first.state).not.toHaveProperty('round');
  expect(initial.preparation).toEqual({ status: 'not-attempted' });
  const retried = prepareMatchRound(first.state, options());
  expect(thinking(retried.state).round.number).toBe(1);
  expect(retried.state.usedTargetIds).toHaveLength(1);
});

test('an actual exhaustive T10 failure leaves the match Preparing without points, target use, or position changes', () => {
  const corners: PuzzleBoard = {
    ...starterBoard,
    board: { ...starterBoard.board, walls: [
      ...starterBoard.board.walls,
      { first: { row: 0, column: 0 }, second: { row: 0, column: 1 } },
      { first: { row: 0, column: 0 }, second: { row: 1, column: 0 } },
      { first: { row: 0, column: 14 }, second: { row: 0, column: 15 } },
      { first: { row: 0, column: 15 }, second: { row: 1, column: 15 } },
      { first: { row: 14, column: 0 }, second: { row: 15, column: 0 } },
      { first: { row: 15, column: 0 }, second: { row: 15, column: 1 } },
      { first: { row: 14, column: 15 }, second: { row: 15, column: 15 } },
      { first: { row: 15, column: 14 }, second: { row: 15, column: 15 } },
    ] },
  };
  const initial = create(corners);
  const transition = prepareMatchRound(initial, options(corners));
  expect(transition.outcome.status).toBe('accepted');
  expect(transition.state).toMatchObject({
    phase: 'preparing', officialRobots: initial.officialRobots, scores: initial.scores, completedRounds: 0, usedTargetIds: [],
    preparation: { status: 'unavailable', reason: 'all-eligible-targets-unsolvable' },
  });
  expect(transition.state).not.toHaveProperty('round');
});

test.each(['match', 'round-count', 'board-geometry', 'positions', 'used-targets'] as const)('rejects a stale %s request', (changed) => {
  const initial = create();
  const { request, result } = proofFor(initial);
  let current: PreparingMatchState = initial;
  if (changed === 'match') current = { ...initial, matchId: 'other-match' };
  if (changed === 'round-count') current = { ...initial, completedRounds: 1, usedTargetIds: ['blue-star'] };
  if (changed === 'board-geometry') current = { ...initial, puzzle: { ...puzzleCatalog[1], id: initial.puzzle.id } };
  if (changed === 'positions') current = { ...initial, officialRobots: moveRobot(initial.puzzle.board, initial.officialRobots, 'red', 'right').robots };
  if (changed === 'used-targets') {
    current = { ...initial, completedRounds: 1, usedTargetIds: ['blue-star'] };
    // Match the round number so this specifically tests the used-target snapshot.
    (request as { completedRounds: number }).completedRounds = 1;
  }
  const rejected = acceptRoundPreparation(current, request, result);
  expect(rejected.outcome).toEqual({ status: 'rejected', reason: 'stale-preparation' });
  expect(rejected.state).toBe(current);
});

test('snapshots own board, positions, used IDs, candidate order, and budget data', () => {
  const initial = JSON.parse(JSON.stringify(create())) as PreparingMatchState;
  const config = JSON.parse(JSON.stringify(options())) as RoundPreparationOptions;
  const request = snapshotRoundPreparation(initial, config);
  expect(request.setup.puzzle).not.toBe(initial.puzzle);
  expect(request.setup.puzzle.board.walls[0].first).not.toBe(initial.puzzle.board.walls[0].first);
  expect(request.setup.robots.red).not.toBe(initial.officialRobots.red);
  expect(request.setup.usedTargetIds).not.toBe(initial.usedTargetIds);
  expect(request.setup.candidateOrder).not.toBe(config.candidateOrder);
  expect(request.setup.budget.perCandidate).not.toBe(config.budget.perCandidate);
});

test.each(['wrong-board', 'foreign-target', 'changed-target', 'wrong-start', 'empty-proof', 'bad-proof'] as const)('rejects %s selected data', (invalid) => {
  const initial = create();
  const { request, result: valid } = proofFor(initial);
  const result = JSON.parse(JSON.stringify(valid)) as typeof valid;
  if (invalid === 'wrong-board') (result.round as { boardId: string }).boardId = 'other-board';
  if (invalid === 'foreign-target') (result.round.target as { id: string }).id = 'not-on-board';
  if (invalid === 'changed-target') (result.round.target.position as { row: number }).row = 4;
  if (invalid === 'wrong-start') (result.round.roundStartRobots.red as { column: number }).column = 1;
  if (invalid === 'empty-proof') (result as { internalProof: readonly unknown[] }).internalProof = [];
  if (invalid === 'bad-proof') (result as { internalProof: readonly unknown[] }).internalProof = [{ robotId: 'blue', direction: 'up' }];
  const rejected = acceptRoundPreparation(initial, request, result);
  expect(rejected.outcome).toEqual({ status: 'rejected', reason: 'invalid-preparation' });
  expect(rejected.state).toBe(initial);
});

test('rejects an already-used selected target even with a fresh request', () => {
  const initial = create();
  const result = proofFor(initial).result;
  const used: PreparingMatchState = { ...initial, completedRounds: 1, usedTargetIds: [result.round.target.id] };
  const rejected = acceptRoundPreparation(used, snapshotRoundPreparation(used, options()), result);
  expect(rejected.outcome).toEqual({ status: 'rejected', reason: 'invalid-preparation' });
});

test('an already-complete selected target cannot start a zero-move round', () => {
  const initial = create();
  const result = proofFor(initial).result;
  const target = result.round.target;
  if (target.kind !== 'colored') throw new Error('Expected colored fixture.');
  const complete = { ...initial, officialRobots: { ...initial.officialRobots, [target.robotId]: target.position } };
  const request = snapshotRoundPreparation(complete, options());
  const modified = { ...result, round: { ...result.round, roundStartRobots: complete.officialRobots } };
  expect(acceptRoundPreparation(complete, request, modified).outcome).toEqual({ status: 'rejected', reason: 'invalid-preparation' });
});

test('does not invoke the preparer outside Preparing or select an eleventh round', () => {
  const initial = create();
  const active = prepareMatchRound(initial, options()).state;
  const finished: FinishedMatchState = { ...initial, phase: 'finished', completedRounds: 10 };
  const preparer = vi.fn<typeof prepareNextRound>();
  expect(prepareMatchRoundWith(active, options(), preparer).outcome).toEqual({ status: 'rejected', reason: 'wrong-phase' });
  expect(prepareMatchRoundWith(finished, options(), preparer).outcome).toEqual({ status: 'rejected', reason: 'match-finished' });
  expect(preparer).not.toHaveBeenCalled();
});

test('rejects inconsistent preparation counts before doing solver work', () => {
  const initial = create();
  const preparer = vi.fn<typeof prepareNextRound>();
  const invalidStates = [
    { ...initial, completedRounds: 10 },
    { ...initial, completedRounds: -1 },
    { ...initial, completedRounds: 1, usedTargetIds: [] },
  ];
  for (const state of invalidStates) {
    const transition = prepareMatchRoundWith(state as MatchState, options(), preparer);
    expect(transition.outcome).toEqual({ status: 'rejected', reason: 'invalid-preparation' });
    expect(transition.state).toBe(state);
  }
  expect(preparer).not.toHaveBeenCalled();
});

test('only one T10 call occurs on an inconclusive result, with no implicit retry', () => {
  const initial = create();
  const config = { ...options(), budget: { ...RECOMMENDED_ROUND_SETUP_BUDGET, maxTotalExpandedStates: 0 } };
  const preparer = vi.fn(prepareNextRound);
  prepareMatchRoundWith(initial, config, preparer);
  expect(preparer).toHaveBeenCalledTimes(1);
});

test.each([
  null, { candidateOrder: [], budget: RECOMMENDED_ROUND_SETUP_BUDGET },
  { ...options(), candidateOrder: ['missing', ...options().candidateOrder.slice(1)] },
  { ...options(), budget: { ...RECOMMENDED_ROUND_SETUP_BUDGET, maxTotalExpandedStates: -1 } },
])('fails clearly for invalid preparation options %#', (config) => {
  expect(() => prepareMatchRound(create(), config as unknown as RoundPreparationOptions)).toThrow();
});

function freeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

test('frozen inputs are unchanged and successful/deferred results are deterministic', () => {
  const initial = freeze(create());
  const selectedOptions = freeze(JSON.parse(JSON.stringify(options())) as RoundPreparationOptions);
  const before = JSON.stringify(initial);
  const first = prepareMatchRound(initial, selectedOptions);
  expect(prepareMatchRound(initial, selectedOptions)).toEqual(first);
  const deferredOptions = freeze({ ...selectedOptions, budget: { ...RECOMMENDED_ROUND_SETUP_BUDGET, maxTotalExpandedStates: 0 } });
  expect(prepareMatchRound(initial, deferredOptions)).toEqual(prepareMatchRound(initial, deferredOptions));
  expect(JSON.stringify(initial)).toBe(before);
});

test('failure diagnostics are copied without proof metadata', () => {
  const initial = create();
  const request = snapshotRoundPreparation(initial, options());
  const failure = prepareNextRound({ ...request.setup, budget: { ...RECOMMENDED_ROUND_SETUP_BUDGET, maxTotalExpandedStates: 0 } });
  if (failure.status === 'selected') throw new Error('Expected inconclusive fixture.');
  const extra = { ...failure, internalProof: ['do-not-store'] };
  const transition = acceptRoundPreparation(initial, request, extra);
  expect(transition.state.phase).toBe('preparing');
  if (transition.state.phase !== 'preparing' || transition.state.preparation.status === 'not-attempted') throw new Error('Expected failed preparation.');
  expect(transition.state.preparation.diagnostics).not.toBe(failure.diagnostics);
  expect(JSON.stringify(transition.state)).not.toContain('internalProof');
});
