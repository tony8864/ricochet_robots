import { describe, expect, test } from 'vitest';
import {
  CENTER_BLOCKED_CELLS, DIRECTIONS, isTargetComplete, moveRobot, ROBOT_IDS,
  type GameState, type RobotPositions,
} from '@robot-puzzle/game-engine';
import { starterBoard } from '../boards/starterBoard';
import { puzzleCatalog } from '../catalog';
import { solvePuzzle, MAX_STORED_STATES, type SolverLimits } from './index';
import { createEngineTransition } from './engineTransitions';
import { helperFixture, impossibleFixture, replaySolution } from './fixtures';
import { searchPuzzle } from './search';
import { decodeRobots, encodeRobots } from './state';

const limits = { maxExpandedStates: 10_000, maxStoredStates: 30_000 };
const openBoard = { blockedCells: CENTER_BLOCKED_CELLS, walls: [] };
const robots = starterBoard.initialRobots;
const starter: GameState = {
  board: starterBoard.board, robots,
  target: starterBoard.targets.find((target) => target.kind === 'colored' && target.robotId === 'blue' && target.symbol === 'star')!,
};

function solved(input: GameState, budget: SolverLimits = limits) {
  const result = solvePuzzle(input, budget);
  expect(result.status).toBe('solved');
  if (result.status !== 'solved') throw new Error('Expected a solved fixture.');
  replaySolution(input, result.moves);
  return result;
}

test.each(ROBOT_IDS)('solves one slide for %s, preserving robot identity', (robotId) => {
  const direction = DIRECTIONS.find((value) => moveRobot(openBoard, robots, robotId, value).moved)!;
  const position = moveRobot(openBoard, robots, robotId, direction).to;
  const input: GameState = {
    board: openBoard, robots,
    target: { id: robotId, kind: 'colored', robotId, symbol: 'square', position },
  };
  expect(solved(input).moves).toEqual([{ robotId, direction }]);
});

test.each(ROBOT_IDS)('accepts %s already on a wildcard with zero work', (robotId) => {
  const input: GameState = {
    board: openBoard, robots,
    target: { id: 'vortex', kind: 'wildcard', symbol: 'vortex', position: robots[robotId] },
  };
  const result = solved(input, { maxExpandedStates: 0, maxStoredStates: 1 });
  expect(result.moves).toEqual([]);
  expect(result.stats.expandedStates).toBe(0);
  expect(result.stats.searchArrayBytes).toBe(0);
});

test('finds a non-empty wildcard solution', () => {
  const input: GameState = {
    board: openBoard, robots,
    target: { id: 'vortex', kind: 'wildcard', symbol: 'vortex', position: { row: 0, column: 14 } },
  };
  expect(solved(input).moves).toEqual([{ robotId: 'red', direction: 'right' }]);
});

test('recovers and replays the starter two-move solution', () => {
  expect(solved(starter).moves).toEqual([
    { robotId: 'blue', direction: 'down' }, { robotId: 'blue', direction: 'left' },
  ]);
});

test('moves a helper robot to provide the required stopping point', () => {
  expect(solved(helperFixture).moves).toEqual([
    { robotId: 'blue', direction: 'up' }, { robotId: 'red', direction: 'right' },
  ]);
});

test('starts from all current carry-forward positions, not catalog starts', () => {
  const first = solved(helperFixture);
  const carried = replaySolution(helperFixture, first.moves);
  expect(carried.red).not.toEqual(helperFixture.robots.red);
  expect(carried.blue).not.toEqual(helperFixture.robots.blue);
  expect(solved({ ...helperFixture, robots: carried }).moves).toEqual([]);
  const next: GameState = {
    ...helperFixture, robots: carried,
    target: { id: 'next', kind: 'colored', robotId: 'blue', symbol: 'triangle', position: { row: 0, column: 3 } },
  };
  expect(solved(next).moves).toEqual([{ robotId: 'blue', direction: 'right' }]);
  expect(solved({ ...next, robots: helperFixture.robots }).moves.length).toBeGreaterThan(1);
});

test('does not accept another color already on the target', () => {
  const input: GameState = { ...impossibleFixture, target: { ...impossibleFixture.target, position: impossibleFixture.robots.blue } };
  expect(solvePuzzle(input, limits).status).toBe('unsolvable');
});

test('exhausts a two-state cycle without retaining no-ops or repeated states', () => {
  const result = solvePuzzle(impossibleFixture, { maxExpandedStates: 2, maxStoredStates: 2 });
  expect(result.status).toBe('unsolvable');
  expect(result.stats).toEqual({
    expandedStates: 2, attemptedMoves: 32, generatedStates: 2,
    peakStoredStates: 2, searchArrayBytes: 18,
  });
});

test('exhausts an entirely immobile state at exactly its limits', () => {
  const input: GameState = {
    ...impossibleFixture,
    robots: { ...impossibleFixture.robots, red: { row: 0, column: 1 } },
    board: { ...impossibleFixture.board, blockedCells: [...impossibleFixture.board.blockedCells, { row: 0, column: 0 }, { row: 0, column: 2 }] },
    target: { ...impossibleFixture.target, position: impossibleFixture.robots.blue },
  };
  const result = solvePuzzle(input, { maxExpandedStates: 1, maxStoredStates: 1 });
  expect(result.status).toBe('unsolvable');
  expect(result.stats.generatedStates).toBe(0);
});

test.each([
  [{ maxExpandedStates: 0, maxStoredStates: 10 }, 'expansion-limit'],
  [{ maxExpandedStates: 1, maxStoredStates: 10 }, 'expansion-limit'],
  [{ maxExpandedStates: 10, maxStoredStates: 1 }, 'storage-limit'],
] as const)('returns unknown for a cutoff: %j', (budget, reason) => {
  const result = solvePuzzle(impossibleFixture, budget);
  expect(result).toMatchObject({ status: 'unknown', reason });
  expect(result.stats.expandedStates).toBeLessThanOrEqual(budget.maxExpandedStates);
  expect(result.stats.peakStoredStates).toBeLessThanOrEqual(budget.maxStoredStates);
  expect(result.stats.attemptedMoves).toBeLessThanOrEqual(16 * result.stats.expandedStates);
});

test('can return a witness without storing its final state', () => {
  const input: GameState = {
    board: openBoard, robots,
    target: { id: 'red', kind: 'colored', robotId: 'red', symbol: 'star', position: { row: 0, column: 14 } },
  };
  const result = solved(input, { maxExpandedStates: 1, maxStoredStates: 1 });
  expect(result.stats.peakStoredStates).toBe(1);
});

test.each([NaN, Infinity, -1, 0.5, Number.MAX_SAFE_INTEGER + 1])('rejects invalid work limit %s', (value) => {
  expect(() => solvePuzzle(starter, { ...limits, maxExpandedStates: value })).toThrow(RangeError);
});

test.each([NaN, Infinity, -1, 0, 1.5, MAX_STORED_STATES + 1])('rejects invalid storage limit %s', (value) => {
  expect(() => solvePuzzle(starter, { ...limits, maxStoredStates: value })).toThrow(RangeError);
});

test('rejects malformed limits and states even if the target is complete', () => {
  expect(() => solvePuzzle(starter, null as unknown as SolverLimits)).toThrow(RangeError);
  expect(() => solvePuzzle(null as unknown as GameState, limits)).toThrow(TypeError);
  expect(() => solvePuzzle({ ...starter, robots: { ...robots, red: robots.blue } }, limits)).toThrow(/overlaps/);
  expect(() => solvePuzzle({ ...starter, target: { ...starter.target, position: { row: 7, column: 7 } } }, limits)).toThrow(/blocked/);
  expect(() => solvePuzzle({ ...starter, board: { ...starter.board, blockedCells: [] } }, limits)).toThrow(/Central cell/);
  const complete = { ...starter, target: { ...starter.target, position: robots.blue } };
  expect(() => solvePuzzle(complete, { ...limits, maxStoredStates: 0 })).toThrow(RangeError);
});

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

test('is deterministic and does not mutate frozen inputs or limits', () => {
  const input = deepFreeze(JSON.parse(JSON.stringify(starter)) as GameState);
  const budget = Object.freeze({ ...limits });
  const before = JSON.stringify(input);
  const first = solved(input, budget);
  expect(solved(input, budget)).toEqual(first);
  expect(JSON.stringify(input)).toBe(before);
});

test('uses unsigned collision-free identity-preserving state keys', () => {
  const encoded = encodeRobots(robots);
  expect(encoded).toBeGreaterThan(2 ** 31);
  expect(decodeRobots(encoded)).toEqual(robots);
  const permuted: RobotPositions = { ...robots, red: robots.blue, blue: robots.red };
  expect(encodeRobots(permuted)).not.toBe(encoded);
  const keys = new Set<number>();
  for (const robotId of ROBOT_IDS) {
    for (let cell = 0; cell < 256; cell++) {
      const changed = { ...robots, [robotId]: { row: cell >>> 4, column: cell & 15 } };
      expect(decodeRobots(encodeRobots(changed))).toEqual(changed);
      keys.add(encodeRobots(changed));
    }
  }
  expect(keys.size).toBe(1 + 4 * 255);
});

describe('engine baseline parity', () => {
  test.each(puzzleCatalog.map((entry) => [entry.id, entry] as const))('%s search matches the engine reference', (_, entry) => {
    const budget = { maxExpandedStates: 300, maxStoredStates: 1_000 };
    for (const target of [entry.targets[0], entry.targets[16]]) {
      const input = { board: entry.board, robots: entry.initialRobots, target };
      const result = solvePuzzle(input, budget);
      expect(result).toEqual(searchPuzzle(input, budget, createEngineTransition));
      if (result.status === 'solved') expect(isTargetComplete(replaySolution(input, result.moves), target)).toBe(true);
    }
  });
});
