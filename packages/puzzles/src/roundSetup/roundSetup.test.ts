import { expect, test, vi } from 'vitest';
import { ROBOT_IDS, type RobotPositions } from '@robot-puzzle/game-engine';
import { starterBoard } from '../boards/starterBoard';
import { puzzleCatalog } from '../catalog';
import { MAX_STORED_STATES, solvePuzzle, type SolverResult, type SolverStats } from '../solver';
import { replaySolution } from '../solver/fixtures';
import { validateCatalog } from '../validation';
import {
  prepareNextRound, RECOMMENDED_ROUND_SETUP_BUDGET,
  type RoundSetupBudget, type RoundSetupInput, type RoundSetupResult,
} from './index';
import { isolatedRobotsBoard } from './fixtures';
import { prepareRoundWithSolver } from './prepare';

const ids = starterBoard.targets.map((target) => target.id);
const base: RoundSetupInput = {
  puzzle: starterBoard, robots: starterBoard.initialRobots,
  usedTargetIds: [], candidateOrder: ids, budget: RECOMMENDED_ROUND_SETUP_BUDGET,
};
const blueStarProof = [{ robotId: 'blue', direction: 'down' }, { robotId: 'blue', direction: 'left' }] as const;

function ordered(first: readonly string[]): string[] {
  return [...first, ...ids.filter((id) => !first.includes(id))];
}

function onlyUnused(unused: readonly string[]): RoundSetupInput {
  return { ...base, usedTargetIds: ids.filter((id) => !unused.includes(id)) };
}

function stats(expandedStates: number): SolverStats {
  return { expandedStates, attemptedMoves: expandedStates * 16, generatedStates: expandedStates,
    peakStoredStates: 1, searchArrayBytes: 9 };
}

function unknown(expandedStates: number, reason: 'expansion-limit' | 'storage-limit' = 'expansion-limit'): SolverResult {
  return { status: 'unknown', reason, stats: stats(expandedStates) };
}

function selected(result: RoundSetupResult) {
  expect(result.status).toBe('selected');
  if (result.status !== 'selected') throw new Error('Expected a prepared round.');
  replaySolution({ board: starterBoard.board, robots: result.round.roundStartRobots, target: result.round.target }, result.internalProof);
  return result;
}

test('selects the first supplied verified target and returns a snapshot, separate from its proof', () => {
  const input = { ...base, candidateOrder: ordered(['blue-star']) };
  const result = selected(prepareNextRound(input));
  expect(result.round.boardId).toBe(starterBoard.id);
  expect(result.round.target.id).toBe('blue-star');
  expect(result.internalProof).toEqual(blueStarProof);
  expect(result.round).not.toHaveProperty('internalProof');
  expect(result.round.roundStartRobots).toEqual(input.robots);
  expect(result.round.roundStartRobots).not.toBe(input.robots);
  for (const id of ROBOT_IDS) expect(result.round.roundStartRobots[id]).not.toBe(input.robots[id]);
  const original = starterBoard.targets.find((target) => target.id === 'blue-star')!;
  expect(result.round.target).not.toBe(original);
  expect(result.round.target.position).not.toBe(original.position);
  expect(result.diagnostics.candidates).toHaveLength(1);
  expect(result.diagnostics.untestedTargetCount).toBe(16);
  expect(input.usedTargetIds).toEqual([]);
  expect(prepareNextRound(input)).toEqual(result);
});

test.each(['success', 'failure', 'skip'])('a revealed target cannot repeat after %s', () => {
  const input = { ...base, candidateOrder: ordered(['blue-star']) };
  const first = selected(prepareNextRound(input));
  // The match layer records the revealed ID regardless of the round's outcome.
  const usedTargetIds = [first.round.target.id];
  const next = selected(prepareNextRound({ ...input, usedTargetIds }));
  expect(next.round.target.id).not.toBe(first.round.target.id);
  expect(next.diagnostics.usedTargetCount).toBe(1);
  expect(usedTargetIds).toEqual(['blue-star']);
});

test.each(puzzleCatalog.map((puzzle) => [puzzle.id, puzzle] as const))('%s returns a target belonging to that board', (_, puzzle) => {
  const result = prepareNextRound({ ...base, puzzle, robots: puzzle.initialRobots, candidateOrder: puzzle.targets.map((target) => target.id) });
  expect(result.status).toBe('selected');
  if (result.status !== 'selected') throw new Error('Expected a verified catalog target.');
  expect(puzzle.targets).toContainEqual(result.round.target);
  replaySolution({ board: puzzle.board, robots: puzzle.initialRobots, target: result.round.target }, result.internalProof);
});

test('uses all carried positions after a helper-robot solution, not starts or proof-final positions', () => {
  const first = selected(prepareNextRound(base));
  expect(first.internalProof.some((move) => move.robotId !== 'red')).toBe(true);
  const robots = replaySolution({ board: starterBoard.board, robots: base.robots, target: first.round.target }, first.internalProof);
  expect(robots.red).not.toEqual(base.robots.red);
  expect(robots.blue).not.toEqual(base.robots.blue);
  const input = { ...base, robots, usedTargetIds: [first.round.target.id], candidateOrder: ordered(['blue-star']) };
  const next = selected(prepareNextRound(input));
  expect(next.round.roundStartRobots).toEqual(robots);
  expect(next.round.roundStartRobots).not.toEqual(base.robots);
  const finalRobots = replaySolution({ board: starterBoard.board, robots, target: next.round.target }, next.internalProof);
  expect(next.round.roundStartRobots).not.toEqual(finalRobots);
});

test('filters matching colors and vortex, leaving them unused', () => {
  const red = starterBoard.targets.find((target) => target.id === 'red-star')!;
  const vortex = starterBoard.targets.find((target) => target.kind === 'wildcard')!;
  const robots = { ...base.robots, red: red.position, yellow: vortex.position };
  const solve = vi.fn<typeof solvePuzzle>().mockReturnValue(unknown(1));
  const result = prepareRoundWithSolver({ ...base, robots, candidateOrder: ordered([red.id, vortex.id]) }, solve);
  expect(result).toMatchObject({ status: 'deferred', reason: 'unverified-candidates' });
  expect(result.diagnostics.alreadyCompleteTargetCount).toBe(2);
  expect(result.diagnostics.candidates.map((candidate) => candidate.targetId)).not.toContain(red.id);
  expect(result.diagnostics.candidates.map((candidate) => candidate.targetId)).not.toContain(vortex.id);
  expect(base.usedTargetIds).toEqual([]);
});

test.each(ROBOT_IDS)('filters a vortex occupied by %s', (robotId) => {
  const vortex = starterBoard.targets.find((target) => target.kind === 'wildcard')!;
  const input = { ...onlyUnused([vortex.id]), robots: { ...base.robots, [robotId]: vortex.position } };
  const solve = vi.fn<typeof solvePuzzle>();
  expect(prepareRoundWithSolver(input, solve)).toMatchObject({ status: 'unavailable', reason: 'all-unused-targets-complete' });
  expect(solve).not.toHaveBeenCalled();
});

test('does not filter a colored target occupied by the wrong robot', () => {
  const target = starterBoard.targets.find((candidate) => candidate.id === 'red-star')!;
  const input = { ...onlyUnused([target.id]), robots: { ...base.robots, blue: target.position } };
  const solve = vi.fn<typeof solvePuzzle>().mockReturnValue(unknown(1));
  const result = prepareRoundWithSolver(input, solve);
  expect(result.diagnostics.alreadyCompleteTargetCount).toBe(0);
  expect(solve).toHaveBeenCalledTimes(1);
  expect(solve.mock.calls[0][0].robots).toEqual(input.robots);
});

test('does not count an already-complete used target as filtered twice', () => {
  const target = starterBoard.targets.find((candidate) => candidate.id === 'red-star')!;
  const solve = vi.fn<typeof solvePuzzle>();
  const result = prepareRoundWithSolver({ ...base, robots: { ...base.robots, red: target.position }, usedTargetIds: ids }, solve);
  expect(result).toMatchObject({ status: 'unavailable', reason: 'all-targets-used' });
  expect(result.diagnostics).toMatchObject({ usedTargetCount: 17, alreadyCompleteTargetCount: 0, eligibleTargetCount: 0, untestedTargetCount: 0, totalExpandedStates: 0 });
  expect(solve).not.toHaveBeenCalled();
});

test('multiple already-complete remaining targets produce no eligible round', () => {
  const targetIds = ['red-star', 'blue-star', 'green-star', 'wildcard-vortex'];
  const positions = targetIds.map((id) => starterBoard.targets.find((target) => target.id === id)!.position);
  const robots: RobotPositions = { red: positions[0], blue: positions[1], green: positions[2], yellow: positions[3] };
  const result = prepareNextRound({ ...onlyUnused(targetIds), robots });
  expect(result).toMatchObject({ status: 'unavailable', reason: 'all-unused-targets-complete' });
  expect(result.diagnostics.alreadyCompleteTargetCount).toBe(4);
});

test('debits unknown and unsolvable work, reducing the final candidate allowance', () => {
  const solve = vi.fn<typeof solvePuzzle>()
    .mockReturnValueOnce(unknown(5))
    .mockReturnValueOnce({ status: 'unsolvable', stats: stats(3) })
    .mockReturnValueOnce({ status: 'solved', moves: blueStarProof, stats: stats(2) });
  const budget = { perCandidate: { maxExpandedStates: 5, maxStoredStates: 7 }, maxTotalExpandedStates: 10 };
  const input = { ...base, candidateOrder: ordered(['red-star', 'red-crescent', 'blue-star']), budget };
  const result = selected(prepareRoundWithSolver(input, solve));
  expect(result.diagnostics.totalExpandedStates).toBe(10);
  expect(result.diagnostics.candidates.map((candidate) => candidate.status)).toEqual(['unknown', 'unsolvable', 'solved']);
  expect(solve.mock.calls.map(([, limits]) => limits)).toEqual([
    { maxExpandedStates: 5, maxStoredStates: 7 }, { maxExpandedStates: 5, maxStoredStates: 7 }, { maxExpandedStates: 2, maxStoredStates: 7 },
  ]);
});

test('stops at the aggregate cap without classifying untested targets as unreachable', () => {
  const solve = vi.fn<typeof solvePuzzle>().mockReturnValueOnce({ status: 'unsolvable', stats: stats(2) });
  const budget = { perCandidate: { maxExpandedStates: 10, maxStoredStates: 5 }, maxTotalExpandedStates: 2 };
  const result = prepareRoundWithSolver({ ...base, budget }, solve);
  expect(result).toMatchObject({ status: 'deferred', reason: 'total-expansion-limit' });
  expect(result.diagnostics).toMatchObject({ totalExpandedStates: 2, untestedTargetCount: 16 });
  expect(solve).toHaveBeenCalledTimes(1);
  expect(solve.mock.calls[0][1].maxExpandedStates).toBe(2);
});

test.each([
  { perCandidate: { maxExpandedStates: 10, maxStoredStates: 5 }, maxTotalExpandedStates: 0 },
  { perCandidate: { maxExpandedStates: 0, maxStoredStates: 5 }, maxTotalExpandedStates: 10 },
])('zero work budget does not call the solver: %j', (budget) => {
  const solve = vi.fn<typeof solvePuzzle>();
  const result = prepareRoundWithSolver({ ...base, budget }, solve);
  expect(result.status).toBe('deferred');
  expect(result.diagnostics.totalExpandedStates).toBe(0);
  expect(result.diagnostics.untestedTargetCount).toBe(17);
  expect(solve).not.toHaveBeenCalled();
});

test('unknown storage cutoffs remain inconclusive after every eligible candidate is examined', () => {
  const budget = { perCandidate: { maxExpandedStates: 10, maxStoredStates: 1 }, maxTotalExpandedStates: 200 };
  const result = prepareNextRound({ ...base, budget });
  expect(result).toMatchObject({ status: 'deferred', reason: 'unverified-candidates' });
  expect(result.diagnostics.candidates).toHaveLength(17);
  expect(result.diagnostics.untestedTargetCount).toBe(0);
  expect(result.diagnostics.candidates.every((candidate) => candidate.status === 'unknown' && candidate.reason === 'storage-limit')).toBe(true);
  expect(result.diagnostics.candidates.every((candidate) => candidate.stats.peakStoredStates <= 1)).toBe(true);
});

test('finite candidate traversal also terminates when a controlled solver reports no expansions', () => {
  const solve = vi.fn<typeof solvePuzzle>().mockReturnValue(unknown(0, 'storage-limit'));
  const result = prepareRoundWithSolver(base, solve);
  expect(result.status).toBe('deferred');
  expect(result.diagnostics.candidates).toHaveLength(17);
  expect(new Set(result.diagnostics.candidates.map((candidate) => candidate.targetId)).size).toBe(17);
});

test('mixed unknown and exhaustive failure is never all-unsolvable', () => {
  const solve = vi.fn<typeof solvePuzzle>()
    .mockReturnValueOnce(unknown(1))
    .mockReturnValue({ status: 'unsolvable', stats: stats(1) });
  const result = prepareRoundWithSolver(base, solve);
  expect(result).toMatchObject({ status: 'deferred', reason: 'unverified-candidates' });
  expect(result.diagnostics.untestedTargetCount).toBe(0);
});

test('real solver proves all eligible targets unreachable, including exact aggregate exhaustion', () => {
  expect(validateCatalog([isolatedRobotsBoard]).valid).toBe(true);
  const input = {
    ...base, puzzle: isolatedRobotsBoard, robots: isolatedRobotsBoard.initialRobots,
    budget: { perCandidate: { maxExpandedStates: 1, maxStoredStates: 1 }, maxTotalExpandedStates: 17 },
  };
  const result = prepareNextRound(input);
  expect(result).toMatchObject({ status: 'unavailable', reason: 'all-eligible-targets-unsolvable' });
  expect(result.diagnostics).toMatchObject({ totalExpandedStates: 17, untestedTargetCount: 0 });
  expect(result.diagnostics.candidates.every((candidate) => candidate.status === 'unsolvable')).toBe(true);
});

test.each([
  { moves: [] }, { moves: [{ robotId: 'blue', direction: 'up' }] }, { moves: [{ robotId: 'red', direction: 'down' }] },
] as const)('rejects invalid solver proof %j', ({ moves }) => {
  const solve = vi.fn<typeof solvePuzzle>().mockReturnValue({ status: 'solved', moves, stats: stats(1) });
  expect(() => prepareRoundWithSolver({ ...base, candidateOrder: ordered(['blue-star']) }, solve)).toThrow(/Invalid round setup proof/);
});

test('rejects solver statistics that violate its supplied budget', () => {
  const solve = vi.fn<typeof solvePuzzle>().mockReturnValue(unknown(base.budget.perCandidate.maxExpandedStates + 1));
  expect(() => prepareRoundWithSolver(base, solve)).toThrow(/statistics outside its budget/);
});

test.each([
  { usedTargetIds: ['foreign-target'] }, { usedTargetIds: ['red-star', 'red-star'] },
  { usedTargetIds: null }, { candidateOrder: ids.slice(1) },
  { candidateOrder: ['foreign-target', ...ids.slice(1)] }, { candidateOrder: [ids[1], ...ids.slice(1)] },
  { candidateOrder: null },
])('rejects malformed target tracking/order %j', (changes) => {
  expect(() => prepareNextRound({ ...base, ...changes } as unknown as RoundSetupInput)).toThrow(TypeError);
});

test.each([NaN, Infinity, -1, 0.5, Number.MAX_SAFE_INTEGER + 1])('rejects invalid aggregate work budget %s', (maxTotalExpandedStates) => {
  expect(() => prepareNextRound({ ...base, budget: { ...base.budget, maxTotalExpandedStates } })).toThrow(RangeError);
});

test.each([
  { maxExpandedStates: -1, maxStoredStates: 10 }, { maxExpandedStates: Infinity, maxStoredStates: 10 },
  { maxExpandedStates: 0.5, maxStoredStates: 10 }, { maxExpandedStates: 10, maxStoredStates: 0 },
  { maxExpandedStates: 10, maxStoredStates: 0.5 }, { maxExpandedStates: 10, maxStoredStates: MAX_STORED_STATES + 1 },
])('rejects invalid per-candidate budget %j', (perCandidate) => {
  expect(() => prepareNextRound({ ...base, budget: { ...base.budget, perCandidate } })).toThrow(RangeError);
});

test('validates board, positions and budgets before any early return', () => {
  expect(() => prepareNextRound(null as unknown as RoundSetupInput)).toThrow(TypeError);
  expect(() => prepareNextRound({ ...base, puzzle: null as unknown as RoundSetupInput['puzzle'] })).toThrow(/Invalid round setup board/);
  expect(() => prepareNextRound({ ...base, puzzle: { ...starterBoard, targets: [] } })).toThrow(/Invalid round setup board/);
  expect(() => prepareNextRound({ ...base, puzzle: { ...starterBoard, board: { ...starterBoard.board, blockedCells: [] } } })).toThrow(/Central cell/);
  expect(() => prepareNextRound({ ...base, robots: { ...base.robots, red: base.robots.blue } })).toThrow(/overlaps/);
  expect(() => prepareNextRound({ ...base, robots: { ...base.robots, red: { row: 7, column: 7 } } })).toThrow(/blocked cell/);
  expect(() => prepareNextRound({ ...base, budget: null as unknown as RoundSetupBudget, usedTargetIds: ids })).toThrow(RangeError);
});

function freeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

test('keeps frozen inputs unchanged on selected, deferred, and unavailable outcomes', () => {
  const inputs = [base, { ...base, budget: { ...base.budget, maxTotalExpandedStates: 0 } }, { ...base, usedTargetIds: ids }];
  for (const value of inputs) {
    const input = freeze(JSON.parse(JSON.stringify(value)) as RoundSetupInput);
    const before = JSON.stringify(input);
    const result = prepareNextRound(input);
    expect(prepareNextRound(input)).toEqual(result);
    expect(JSON.stringify(input)).toBe(before);
    expect(result).not.toHaveProperty('usedTargetIds');
    expect(result).not.toHaveProperty('roundIndex');
  }
});
