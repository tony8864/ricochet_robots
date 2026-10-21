import { expect, test } from 'vitest';
import { starterBoard } from './index';

// Original layout plus the owner's bottom-border wall. Independent of the builder.
test('starter board preserves its targets, walls, center, and robot starts', () => {
  expect(starterBoard.id).toBe('starter-board');
  expect(starterBoard.name).toBe('Starter Board');
  expect(starterBoard.targets.map((target) => [
    target.id, target.kind, target.kind === 'colored' ? target.robotId : null,
    target.symbol, target.position.row, target.position.column,
  ])).toEqual([
    ['red-star', 'colored', 'red', 'star', 3, 12],
    ['red-crescent', 'colored', 'red', 'crescent', 1, 4],
    ['red-triangle', 'colored', 'red', 'triangle', 11, 2],
    ['red-square', 'colored', 'red', 'square', 7, 13],
    ['blue-star', 'colored', 'blue', 'star', 14, 11],
    ['blue-crescent', 'colored', 'blue', 'crescent', 5, 6],
    ['blue-triangle', 'colored', 'blue', 'triangle', 9, 4],
    ['blue-square', 'colored', 'blue', 'square', 2, 9],
    ['green-star', 'colored', 'green', 'star', 12, 7],
    ['green-crescent', 'colored', 'green', 'crescent', 4, 2],
    ['green-triangle', 'colored', 'green', 'triangle', 10, 12],
    ['green-square', 'colored', 'green', 'square', 6, 10],
    ['yellow-star', 'colored', 'yellow', 'star', 2, 1],
    ['yellow-crescent', 'colored', 'yellow', 'crescent', 13, 4],
    ['yellow-triangle', 'colored', 'yellow', 'triangle', 8, 2],
    ['yellow-square', 'colored', 'yellow', 'square', 4, 14],
    ['wildcard-vortex', 'wildcard', null, 'vortex', 11, 14],
  ]);
  expect(starterBoard.board.walls.map(({ first, second }) => [
    first.row, first.column, second.row, second.column,
  ])).toEqual([
    [3, 12, 4, 12],
    [3, 12, 3, 13],
    [0, 4, 1, 4],
    [1, 4, 1, 5],
    [11, 2, 12, 2],
    [11, 1, 11, 2],
    [6, 13, 7, 13],
    [7, 12, 7, 13],
    [14, 11, 15, 11],
    [14, 10, 14, 11],
    [5, 6, 6, 6],
    [5, 6, 5, 7],
    [8, 4, 9, 4],
    [9, 3, 9, 4],
    [2, 9, 3, 9],
    [2, 8, 2, 9],
    [11, 7, 12, 7],
    [12, 7, 12, 8],
    [4, 2, 5, 2],
    [4, 2, 4, 3],
    [9, 12, 10, 12],
    [10, 11, 10, 12],
    [6, 10, 7, 10],
    [6, 9, 6, 10],
    [1, 1, 2, 1],
    [2, 0, 2, 1],
    [13, 4, 14, 4],
    [13, 4, 13, 5],
    [7, 2, 8, 2],
    [8, 2, 8, 3],
    [4, 14, 5, 14],
    [4, 13, 4, 14],
    [10, 14, 11, 14],
    [11, 14, 11, 15],
    [15, 6, 15, 7],
  ]);
  expect(starterBoard.board.blockedCells).toEqual([
    { row: 7, column: 7 }, { row: 7, column: 8 },
    { row: 8, column: 7 }, { row: 8, column: 8 },
  ]);
  expect(starterBoard.initialRobots).toEqual({
    red: { row: 0, column: 0 },
    blue: { row: 0, column: 15 },
    green: { row: 15, column: 0 },
    yellow: { row: 15, column: 15 },
  });
});
