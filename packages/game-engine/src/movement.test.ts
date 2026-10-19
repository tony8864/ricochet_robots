import { describe, expect, test } from 'vitest';
import {
  CENTER_BLOCKED_CELLS,
  moveRobot,
  type BlockedEdge,
  type Board,
  type Coordinate,
  type Direction,
  type RobotPositions,
} from './index';

const EMPTY_BOARD: Board = {
  blockedCells: CENTER_BLOCKED_CELLS,
  walls: [],
};

const BASE_ROBOTS: RobotPositions = {
  red: { row: 5, column: 5 },
  blue: { row: 1, column: 13 },
  green: { row: 13, column: 1 },
  yellow: { row: 13, column: 13 },
};

function robotsWith(
  positions: Partial<Record<keyof RobotPositions, Coordinate>>,
): RobotPositions {
  return { ...BASE_ROBOTS, ...positions };
}

describe('moveRobot', () => {
  test.each<{
    direction: Direction;
    start: Coordinate;
    expected: Coordinate;
  }>([
    {
      direction: 'up',
      start: { row: 5, column: 5 },
      expected: { row: 0, column: 5 },
    },
    {
      direction: 'right',
      start: { row: 5, column: 5 },
      expected: { row: 5, column: 15 },
    },
    {
      direction: 'down',
      start: { row: 10, column: 5 },
      expected: { row: 15, column: 5 },
    },
    {
      direction: 'left',
      start: { row: 5, column: 5 },
      expected: { row: 5, column: 0 },
    },
  ])('stops at the $direction board boundary', ({ direction, start, expected }) => {
    const result = moveRobot(
      EMPTY_BOARD,
      robotsWith({ red: start }),
      'red',
      direction,
    );

    expect(result.moved).toBe(true);
    expect(result.to).toEqual(expected);
  });

  test.each<{
    name: string;
    direction: Direction;
    start: Coordinate;
    wall: BlockedEdge;
    expected: Coordinate;
  }>([
    {
      name: 'right across a horizontal edge',
      direction: 'right',
      start: { row: 5, column: 5 },
      wall: {
        first: { row: 5, column: 8 },
        second: { row: 5, column: 9 },
      },
      expected: { row: 5, column: 8 },
    },
    {
      name: 'left across the same horizontal edge orientation',
      direction: 'left',
      start: { row: 5, column: 12 },
      wall: {
        first: { row: 5, column: 8 },
        second: { row: 5, column: 9 },
      },
      expected: { row: 5, column: 9 },
    },
    {
      name: 'down across a vertical edge',
      direction: 'down',
      start: { row: 5, column: 5 },
      wall: {
        first: { row: 8, column: 5 },
        second: { row: 9, column: 5 },
      },
      expected: { row: 8, column: 5 },
    },
    {
      name: 'up across the same vertical edge orientation',
      direction: 'up',
      start: { row: 12, column: 5 },
      wall: {
        first: { row: 8, column: 5 },
        second: { row: 9, column: 5 },
      },
      expected: { row: 9, column: 5 },
    },
  ])('stops before a wall when moving $name', ({ direction, start, wall, expected }) => {
    const board: Board = { ...EMPTY_BOARD, walls: [wall] };
    const result = moveRobot(
      board,
      robotsWith({ red: start }),
      'red',
      direction,
    );

    expect(result.to).toEqual(expected);
  });

  test.each<{
    direction: Direction;
    start: Coordinate;
    expected: Coordinate;
  }>([
    {
      direction: 'down',
      start: { row: 4, column: 7 },
      expected: { row: 6, column: 7 },
    },
    {
      direction: 'right',
      start: { row: 7, column: 4 },
      expected: { row: 7, column: 6 },
    },
    {
      direction: 'up',
      start: { row: 11, column: 8 },
      expected: { row: 9, column: 8 },
    },
    {
      direction: 'left',
      start: { row: 8, column: 11 },
      expected: { row: 8, column: 9 },
    },
  ])(
    'stops before the blocked center when moving $direction',
    ({ direction, start, expected }) => {
      const result = moveRobot(
        EMPTY_BOARD,
        robotsWith({ red: start }),
        'red',
        direction,
      );

      expect(result.to).toEqual(expected);
      expect(CENTER_BLOCKED_CELLS).not.toContainEqual(result.to);
    },
  );

  test('stops immediately before another robot', () => {
    const robots = robotsWith({
      red: { row: 5, column: 2 },
      blue: { row: 5, column: 8 },
    });

    const result = moveRobot(EMPTY_BOARD, robots, 'red', 'right');

    expect(result.to).toEqual({ row: 5, column: 7 });
    expect(result.robots.blue).toBe(robots.blue);
  });

  test('uses the nearest robot when multiple robots are on the movement line', () => {
    const robots = robotsWith({
      red: { row: 5, column: 2 },
      blue: { row: 5, column: 6 },
      green: { row: 5, column: 10 },
    });

    const result = moveRobot(EMPTY_BOARD, robots, 'red', 'right');

    expect(result.to).toEqual({ row: 5, column: 5 });
    expect(result.robots.blue).toBe(robots.blue);
    expect(result.robots.green).toBe(robots.green);
  });

  test.each([
    {
      name: 'a robot before a farther wall',
      board: {
        ...EMPTY_BOARD,
        walls: [
          {
            first: { row: 5, column: 8 },
            second: { row: 5, column: 9 },
          },
        ],
      } satisfies Board,
      robots: robotsWith({
        red: { row: 5, column: 2 },
        blue: { row: 5, column: 6 },
      }),
      expected: { row: 5, column: 5 },
    },
    {
      name: 'a wall before a farther robot',
      board: {
        ...EMPTY_BOARD,
        walls: [
          {
            first: { row: 5, column: 5 },
            second: { row: 5, column: 6 },
          },
        ],
      } satisfies Board,
      robots: robotsWith({
        red: { row: 5, column: 2 },
        blue: { row: 5, column: 9 },
      }),
      expected: { row: 5, column: 5 },
    },
  ])('stops at the nearest obstacle: $name', ({ board, robots, expected }) => {
    expect(moveRobot(board, robots, 'red', 'right').to).toEqual(expected);
  });

  test('ignores walls and robots outside the movement line', () => {
    const board: Board = {
      ...EMPTY_BOARD,
      walls: [
        {
          first: { row: 4, column: 8 },
          second: { row: 4, column: 9 },
        },
      ],
    };
    const robots = robotsWith({
      red: { row: 5, column: 5 },
      blue: { row: 6, column: 10 },
    });

    expect(moveRobot(board, robots, 'red', 'right').to).toEqual({
      row: 5,
      column: 15,
    });
  });

  test.each<{
    name: string;
    board: Board;
    robots: RobotPositions;
    direction: Direction;
  }>([
    {
      name: 'boundary',
      board: EMPTY_BOARD,
      robots: robotsWith({ red: { row: 0, column: 5 } }),
      direction: 'up',
    },
    {
      name: 'wall',
      board: {
        ...EMPTY_BOARD,
        walls: [
          {
            first: { row: 5, column: 5 },
            second: { row: 5, column: 6 },
          },
        ],
      },
      robots: BASE_ROBOTS,
      direction: 'right',
    },
    {
      name: 'blocked cell',
      board: EMPTY_BOARD,
      robots: robotsWith({ red: { row: 6, column: 7 } }),
      direction: 'down',
    },
    {
      name: 'robot',
      board: EMPTY_BOARD,
      robots: robotsWith({
        red: { row: 5, column: 5 },
        blue: { row: 5, column: 6 },
      }),
      direction: 'right',
    },
  ])('returns an explicit no-op for an adjacent $name', ({ board, robots, direction }) => {
    const result = moveRobot(board, robots, 'red', direction);

    expect(result).toMatchObject({
      moved: false,
      from: robots.red,
      to: robots.red,
    });
    expect(result.from).toBe(robots.red);
    expect(result.to).toBe(robots.red);
    expect(result.robots).toBe(robots);
  });

  test('returns a new positions record with only the selected robot changed', () => {
    const result = moveRobot(EMPTY_BOARD, BASE_ROBOTS, 'red', 'left');

    expect(result).toMatchObject({
      moved: true,
      from: { row: 5, column: 5 },
      to: { row: 5, column: 0 },
    });
    expect(result.robots).not.toBe(BASE_ROBOTS);
    expect(result.robots.red).toBe(result.to);
    expect(result.robots.blue).toBe(BASE_ROBOTS.blue);
    expect(result.robots.green).toBe(BASE_ROBOTS.green);
    expect(result.robots.yellow).toBe(BASE_ROBOTS.yellow);
  });

  test('does not mutate frozen board or robot inputs', () => {
    const blockedCells = Object.freeze(
      CENTER_BLOCKED_CELLS.map((cell) => Object.freeze({ ...cell })),
    );
    const walls = Object.freeze([
      Object.freeze({
        first: Object.freeze({ row: 5, column: 8 }),
        second: Object.freeze({ row: 5, column: 9 }),
      }),
    ]);
    const board = Object.freeze({ blockedCells, walls });
    const robots = Object.freeze({
      red: Object.freeze({ row: 5, column: 5 }),
      blue: Object.freeze({ row: 1, column: 13 }),
      green: Object.freeze({ row: 13, column: 1 }),
      yellow: Object.freeze({ row: 13, column: 13 }),
    });
    const beforeBoard = JSON.stringify(board);
    const beforeRobots = JSON.stringify(robots);

    const result = moveRobot(board, robots, 'red', 'right');

    expect(result.to).toEqual({ row: 5, column: 8 });
    expect(JSON.stringify(board)).toBe(beforeBoard);
    expect(JSON.stringify(robots)).toBe(beforeRobots);
  });

  test('is deterministic for structurally identical inputs', () => {
    const first = moveRobot(
      {
        blockedCells: CENTER_BLOCKED_CELLS.map((cell) => ({ ...cell })),
        walls: [],
      },
      {
        red: { row: 5, column: 5 },
        blue: { row: 5, column: 10 },
        green: { row: 13, column: 1 },
        yellow: { row: 13, column: 13 },
      },
      'red',
      'right',
    );
    const second = moveRobot(
      {
        blockedCells: CENTER_BLOCKED_CELLS.map((cell) => ({ ...cell })),
        walls: [],
      },
      {
        red: { row: 5, column: 5 },
        blue: { row: 5, column: 10 },
        green: { row: 13, column: 1 },
        yellow: { row: 13, column: 13 },
      },
      'red',
      'right',
    );

    expect(first).toEqual(second);
  });
});
