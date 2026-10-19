import { describe, expect, test } from 'vitest';
import {
  CENTER_BLOCKED_CELLS,
  assertValidGameState,
  validateBoard,
  validateGameState,
  type Board,
  type GameState,
  type RobotPositions,
} from './index';

const validBoard: Board = {
  blockedCells: CENTER_BLOCKED_CELLS,
  walls: [
    {
      first: { row: 2, column: 3 },
      second: { row: 2, column: 4 },
    },
    {
      first: { row: 10, column: 5 },
      second: { row: 11, column: 5 },
    },
  ],
};

const validRobots: RobotPositions = {
  red: { row: 0, column: 0 },
  blue: { row: 0, column: 15 },
  green: { row: 15, column: 0 },
  yellow: { row: 15, column: 15 },
};

const validState: GameState = {
  board: validBoard,
  robots: validRobots,
  target: {
    id: 'red-moon',
    kind: 'colored',
    robotId: 'red',
    position: { row: 4, column: 4 },
  },
};

describe('board validation', () => {
  test.each([
    { row: -1, column: 0 },
    { row: 0, column: 16 },
    { row: 1.5, column: 2 },
  ])('rejects invalid coordinates: %o', (invalidCoordinate) => {
    const result = validateBoard({
      ...validBoard,
      blockedCells: [...CENTER_BLOCKED_CELLS, invalidCoordinate],
    });

    expect(result.valid).toBe(false);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'invalid_coordinate' }),
      ]),
    );
  });

  test('rejects a board missing a central blocked cell', () => {
    const result = validateBoard({
      ...validBoard,
      blockedCells: CENTER_BLOCKED_CELLS.slice(1),
    });

    expect(result.valid).toBe(false);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'missing_center_blocked_cell' }),
      ]),
    );
  });

  test('rejects duplicate blocked cells', () => {
    const result = validateBoard({
      ...validBoard,
      blockedCells: [...CENTER_BLOCKED_CELLS, CENTER_BLOCKED_CELLS[0]],
    });

    expect(result.valid).toBe(false);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'duplicate_blocked_cell' }),
      ]),
    );
  });

  test.each([
    {
      name: 'diagonal endpoints',
      wall: {
        first: { row: 1, column: 1 },
        second: { row: 2, column: 2 },
      },
    },
    {
      name: 'non-adjacent endpoints',
      wall: {
        first: { row: 1, column: 1 },
        second: { row: 1, column: 3 },
      },
    },
    {
      name: 'non-canonical endpoint order',
      wall: {
        first: { row: 1, column: 2 },
        second: { row: 1, column: 1 },
      },
    },
  ])('rejects malformed walls with $name', ({ wall }) => {
    const result = validateBoard({ ...validBoard, walls: [wall] });

    expect(result.valid).toBe(false);
    expect(result.issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'malformed_wall' })]),
    );
  });

  test('rejects duplicate walls', () => {
    const wall = validBoard.walls[0];
    const result = validateBoard({ ...validBoard, walls: [wall, wall] });

    expect(result.valid).toBe(false);
    expect(result.issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'duplicate_wall' })]),
    );
  });

  test('rejects walls whose blocked-cell boundary is already implicit', () => {
    const result = validateBoard({
      ...validBoard,
      walls: [
        {
          first: { row: 6, column: 7 },
          second: { row: 7, column: 7 },
        },
      ],
    });

    expect(result.valid).toBe(false);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'wall_touches_blocked_cell' }),
      ]),
    );
  });
});

describe('game-state validation', () => {
  test('accepts colored and wildcard targets', () => {
    expect(validateGameState(validState)).toEqual({ valid: true, issues: [] });
    expect(
      validateGameState({
        ...validState,
        target: {
          id: 'wildcard-vortex',
          kind: 'wildcard',
          position: { row: 5, column: 5 },
        },
      }),
    ).toEqual({ valid: true, issues: [] });
  });

  test('rejects overlapping robots', () => {
    const result = validateGameState({
      ...validState,
      robots: {
        ...validRobots,
        yellow: validRobots.red,
      },
    });

    expect(result.valid).toBe(false);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'overlapping_robots' }),
      ]),
    );
  });

  test.each(CENTER_BLOCKED_CELLS)(
    'rejects a robot occupying blocked center cell ($row, $column)',
    (centerCell) => {
      const result = validateGameState({
        ...validState,
        robots: { ...validRobots, red: centerCell },
      });

      expect(result.valid).toBe(false);
      expect(result.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: 'occupied_blocked_cell' }),
        ]),
      );
    },
  );

  test('rejects a missing robot position', () => {
    const { yellow: _yellow, ...missingYellow } = validRobots;
    const result = validateGameState({ ...validState, robots: missingYellow });

    expect(result.valid).toBe(false);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'invalid_robot_set' }),
      ]),
    );
  });

  test('rejects an extra robot key', () => {
    const result = validateGameState({
      ...validState,
      robots: {
        ...validRobots,
        purple: { row: 3, column: 3 },
      },
    });

    expect(result.valid).toBe(false);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'invalid_robot_set' }),
      ]),
    );
  });

  test('rejects a colored target with an invalid robot ID', () => {
    const result = validateGameState({
      ...validState,
      target: {
        ...validState.target,
        robotId: 'purple',
      },
    });

    expect(result.valid).toBe(false);
    expect(result.issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'invalid_target' })]),
    );
  });

  test('rejects a target on a blocked center cell', () => {
    const result = validateGameState({
      ...validState,
      target: {
        ...validState.target,
        position: CENTER_BLOCKED_CELLS[0],
      },
    });

    expect(result.valid).toBe(false);
    expect(result.issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'invalid_target' })]),
    );
  });

  test('assertion helper describes invalid state', () => {
    expect(() =>
      assertValidGameState({
        ...validState,
        robots: { ...validRobots, blue: { row: 20, column: 0 } },
      }),
    ).toThrow('Invalid game state: state.robots.blue');
  });
});
