import { expect, test } from 'vitest';
import { getPuzzleBoard, puzzleCatalog, starterBoard, validateCatalog } from './index';

test('all registered boards have valid catalog geometry and target placements', () => {
  const before = JSON.stringify(puzzleCatalog);
  expect(puzzleCatalog).toContain(starterBoard);
  expect(validateCatalog(puzzleCatalog)).toEqual({ valid: true, issues: [] });
  expect(JSON.stringify(puzzleCatalog)).toBe(before);
});

test('catalog registers the five designed boards', () => {
  expect(puzzleCatalog.map(({ id }) => id)).toEqual(expect.arrayContaining([
    'starter-board', 'crossroads', 'switchback', 'pinwheel', 'constellation',
  ]));
});

test('catalog boards have different wall layouts and target-cell sets', () => {
  const wallLayouts = puzzleCatalog.map(({ board }) => JSON.stringify(board.walls.map(({ first, second }) =>
    `${first.row},${first.column}|${second.row},${second.column}`).sort()));
  const targetLayouts = puzzleCatalog.map(({ targets }) => JSON.stringify(targets.map(({ position }) =>
    `${position.row},${position.column}`).sort()));
  expect(new Set(wallLayouts).size).toBe(puzzleCatalog.length);
  expect(new Set(targetLayouts).size).toBe(puzzleCatalog.length);
});

test('catalog lookup returns the requested board and an explicit missing result', () => {
  for (const board of puzzleCatalog) {
    expect(getPuzzleBoard(board.id)).toBe(board);
  }
  expect(getPuzzleBoard('missing-board')).toBeUndefined();
});

test('catalog rejects a target that is not enclosed by a wall angle', () => {
  const malformed = [{
    ...starterBoard,
    board: { ...starterBoard.board, walls: starterBoard.board.walls.slice(2) },
  }];
  const result = validateCatalog(malformed);
  expect(result.valid).toBe(false);
  expect(result.issues.some((issue) => issue.message.includes('Target must have two perpendicular walls'))).toBe(true);
});

// Independent wall fixtures around the red star at (3,12).
const top = { first: { row: 2, column: 12 }, second: { row: 3, column: 12 } };
const right = { first: { row: 3, column: 12 }, second: { row: 3, column: 13 } };
const bottom = { first: { row: 3, column: 12 }, second: { row: 4, column: 12 } };
const left = { first: { row: 3, column: 11 }, second: { row: 3, column: 12 } };

test.each([
  { corner: 'top-left', walls: [top, left] },
  { corner: 'top-right', walls: [top, right] },
  { corner: 'bottom-right', walls: [bottom, right] },
  { corner: 'bottom-left', walls: [bottom, left] },
])('catalog accepts a target in a $corner wall angle', ({ walls }) => {
  const rotatedCorner = [{
    ...starterBoard,
    board: { ...starterBoard.board, walls: [...walls, ...starterBoard.board.walls.slice(2)] },
  }];
  expect(validateCatalog(rotatedCorner)).toEqual({ valid: true, issues: [] });
});

test('opposite parallel walls do not count as a target corner', () => {
  const parallelWalls = [{
    ...starterBoard,
    board: { ...starterBoard.board, walls: [top, bottom, ...starterBoard.board.walls.slice(2)] },
  }];
  expect(validateCatalog(parallelWalls).issues.some((issue) =>
    issue.message.includes('Target must have two perpendicular walls'))).toBe(true);
});

test('catalog rejects a wall segment isolated in the board interior', () => {
  const malformed = [{
    ...starterBoard,
    board: {
      ...starterBoard.board,
      walls: [...starterBoard.board.walls, {
        first: { row: 2, column: 6 },
        second: { row: 2, column: 7 },
      }],
    },
  }];
  const result = validateCatalog(malformed);
  expect(result.valid).toBe(false);
  expect(result.issues.some((issue) => issue.message.includes('A wall must form a perpendicular angle'))).toBe(true);
});

test('catalog permits an otherwise-unpaired segment that meets the outer border', () => {
  const withBorderSegment = [{
    ...starterBoard,
    board: {
      ...starterBoard.board,
      walls: [...starterBoard.board.walls, {
        first: { row: 0, column: 0 },
        second: { row: 1, column: 0 },
      }],
    },
  }];
  expect(validateCatalog(withBorderSegment)).toEqual({ valid: true, issues: [] });
});

test('catalog rejects duplicate board and target IDs', () => {
  const duplicateTarget = {
    ...starterBoard.targets[1]!,
    id: starterBoard.targets[0]!.id,
  };
  const malformed = [
    { ...starterBoard, targets: [...starterBoard.targets.slice(0, 1), duplicateTarget, ...starterBoard.targets.slice(2)] },
    { ...starterBoard, id: starterBoard.id },
  ];
  const result = validateCatalog(malformed);
  expect(result.valid).toBe(false);
  expect(result.issues.some((issue) => issue.message.includes('Duplicate board ID'))).toBe(true);
  expect(result.issues.some((issue) => issue.message.includes('Duplicate target ID'))).toBe(true);
});
