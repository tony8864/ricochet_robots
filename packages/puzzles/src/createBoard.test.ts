import { COLORED_TARGET_SYMBOLS, ROBOT_IDS } from '@robot-puzzle/game-engine';
import { expect, test } from 'vitest';
import { createBoard, validateCatalog, type BoardDefinition, type TargetPlacement } from './index';

// A simple independent test board, not a second catalog entry.
const definition: BoardDefinition = {
  id: 'test-board',
  name: 'Test Board',
  initialRobots: {
    red: { row: 0, column: 0 },
    blue: { row: 0, column: 15 },
    green: { row: 15, column: 0 },
    yellow: { row: 15, column: 15 },
  },
  targets: [
    ...ROBOT_IDS.flatMap((robotId, colorIndex) =>
      COLORED_TARGET_SYMBOLS.map((symbol, symbolIndex): TargetPlacement => ({
        robotId,
        symbol,
        row: [2, 5, 10, 13][colorIndex]!,
        column: [2, 5, 10, 13][symbolIndex]!,
        corner: 'top-left',
      }))),
    { symbol: 'vortex', row: 1, column: 8, corner: 'bottom-right' },
  ],
};

test('construction is deterministic, does not modify author data, and generates stable IDs', () => {
  const before = JSON.stringify(definition);
  const board = createBoard(definition);
  expect(createBoard(definition)).toEqual(board);
  expect(JSON.stringify(definition)).toBe(before);
  expect(board.targets).toHaveLength(17);
  expect(board.board.walls).toHaveLength(34);
  expect(board.targets[0]).toEqual({
    id: 'red-star', kind: 'colored', robotId: 'red', symbol: 'star',
    position: { row: 2, column: 2 },
  });
  expect(board.targets[16]).toEqual({
    id: 'wildcard-vortex', kind: 'wildcard', symbol: 'vortex',
    position: { row: 1, column: 8 },
  });
});

test('placement order does not determine target identity or corner walls', () => {
  const original = createBoard(definition);
  const reordered = createBoard({ ...definition, targets: [...definition.targets].reverse() });
  expect(reordered.targets).toEqual([...original.targets].reverse());
  expect(reordered.board.walls).toEqual(expect.arrayContaining([...original.board.walls]));
  expect(reordered.board.walls).toHaveLength(original.board.walls.length);
});

test.each([
  { corner: 'top-left', neighbors: [[1, 2], [2, 1]] },
  { corner: 'top-right', neighbors: [[1, 2], [2, 3]] },
  { corner: 'bottom-right', neighbors: [[3, 2], [2, 3]] },
  { corner: 'bottom-left', neighbors: [[3, 2], [2, 1]] },
] as const)('generates correctly ordered $corner walls', ({ corner, neighbors }) => {
  const board = createBoard({
    ...definition,
    targets: [{ ...definition.targets[0]!, corner }, ...definition.targets.slice(1)],
  });
  expect(board.board.walls.slice(0, 2)).toEqual(neighbors.map(([row, column]) => {
    const cell = { row: 2, column: 2 };
    const neighbor = { row, column };
    return row < 2 || column < 2
      ? { first: neighbor, second: cell }
      : { first: cell, second: neighbor };
  }));
});

test('supports optional border-attached walls and validates multiple boards together', () => {
  const additionalWalls = [{ first: { row: 0, column: 0 }, second: { row: 1, column: 0 } }];
  const second = createBoard({ ...definition, id: 'second-board', additionalWalls });
  expect(second.board.walls.slice(-1)).toEqual(additionalWalls);
  expect(validateCatalog([createBoard(definition), second])).toEqual({ valid: true, issues: [] });
});

test('missing targets report a useful authoring error rather than an indexing failure', () => {
  expect(() => createBoard({ ...definition, targets: definition.targets.slice(1) }))
    .toThrow(/Invalid board "test-board":[\s\S]*exactly 17 targets/);
});

test('duplicate color/symbol identities are rejected', () => {
  expect(() => createBoard({
    ...definition,
    targets: [
      { ...definition.targets[0]!, robotId: 'red', symbol: 'crescent' },
      ...definition.targets.slice(1),
    ],
  })).toThrow('Duplicate target ID "red-crescent"');
});

test('duplicate positions are rejected', () => {
  expect(() => createBoard({
    ...definition,
    targets: [{ ...definition.targets[0]!, row: 1, column: 8 }, ...definition.targets.slice(1)],
  })).toThrow('Duplicate target position');
});

test.each([
  { row: -1, column: 2 },
  { row: 7, column: 7 },
  { row: 0, column: 2 }, // top-left would create an out-of-bounds wall
])('rejects invalid target/corner geometry at $row,$column', (position) => {
  expect(() => createBoard({
    ...definition,
    targets: [{ ...definition.targets[0]!, ...position }, ...definition.targets.slice(1)],
  })).toThrow('Invalid board "test-board"');
});

test('rejects overlapping robot starts', () => {
  expect(() => createBoard({
    ...definition,
    initialRobots: { ...definition.initialRobots, blue: definition.initialRobots.red },
  })).toThrow('Invalid board "test-board"');
});

test('rejects isolated additional interior walls', () => {
  expect(() => createBoard({
    ...definition,
    additionalWalls: [{ first: { row: 4, column: 7 }, second: { row: 4, column: 8 } }],
  })).toThrow('A wall must form a perpendicular angle');
});
