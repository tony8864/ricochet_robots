import { describe, expect, test } from 'vitest';
import {
  CENTER_BLOCKED_CELLS,
  ROBOT_IDS,
  createAttempt,
  getAttemptMoveCount,
  isTargetComplete,
  moveAttemptRobot,
  resetAttempt,
  undoAttempt,
  type AttemptState,
  type Board,
  type Coordinate,
  type Direction,
  type RobotId,
  type RobotPositions,
  type Target,
} from './index';

const EMPTY_BOARD: Board = {
  blockedCells: CENTER_BLOCKED_CELLS,
  walls: [],
};

const BASE_ROBOTS: RobotPositions = {
  red: { row: 5, column: 5 },
  blue: { row: 5, column: 10 },
  green: { row: 10, column: 1 },
  yellow: { row: 10, column: 13 },
};

function robotsWith(
  positions: Partial<Record<RobotId, Coordinate>>,
): RobotPositions {
  return { ...BASE_ROBOTS, ...positions };
}

function move(
  attempt: AttemptState,
  robotId: RobotId,
  direction: Direction,
): AttemptState {
  const result = moveAttemptRobot(EMPTY_BOARD, attempt, robotId, direction);
  expect(result.moved).toBe(true);
  return result.attempt;
}

describe('isTargetComplete', () => {
  test.each(ROBOT_IDS)('recognizes the matching %s robot by coordinate value', (robotId) => {
    const target: Target = {
      id: `${robotId}-target`,
      kind: 'colored',
      robotId,
      position: { ...BASE_ROBOTS[robotId] },
    };

    expect(isTargetComplete(BASE_ROBOTS, target)).toBe(true);
  });

  test('rejects a colored target occupied by a different robot', () => {
    const target: Target = {
      id: 'red-target',
      kind: 'colored',
      robotId: 'red',
      position: { ...BASE_ROBOTS.blue },
    };

    expect(isTargetComplete(BASE_ROBOTS, target)).toBe(false);
  });

  test('rejects an unoccupied colored target', () => {
    const target: Target = {
      id: 'red-target',
      kind: 'colored',
      robotId: 'red',
      position: { row: 3, column: 3 },
    };

    expect(isTargetComplete(BASE_ROBOTS, target)).toBe(false);
  });

  test.each(ROBOT_IDS)('allows the %s robot to complete a wildcard target', (robotId) => {
    const target: Target = {
      id: 'wildcard',
      kind: 'wildcard',
      position: { ...BASE_ROBOTS[robotId] },
    };

    expect(isTargetComplete(BASE_ROBOTS, target)).toBe(true);
  });

  test('rejects an unoccupied wildcard target', () => {
    const target: Target = {
      id: 'wildcard',
      kind: 'wildcard',
      position: { row: 3, column: 3 },
    };

    expect(isTargetComplete(BASE_ROBOTS, target)).toBe(false);
  });
});

describe('attempt history', () => {
  test('creates an untouched attempt anchored to the round-start positions', () => {
    const attempt = createAttempt(BASE_ROBOTS);

    expect(attempt.roundStartRobots).toBe(BASE_ROBOTS);
    expect(attempt.robots).toBe(BASE_ROBOTS);
    expect(attempt.moves).toEqual([]);
    expect(getAttemptMoveCount(attempt)).toBe(0);
  });

  test('records successful moves from multiple robots in order', () => {
    const initial = createAttempt(BASE_ROBOTS);
    const afterRed = moveAttemptRobot(EMPTY_BOARD, initial, 'red', 'left');
    const afterBlue = moveAttemptRobot(
      EMPTY_BOARD,
      afterRed.attempt,
      'blue',
      'left',
    );

    expect(afterRed.moved).toBe(true);
    expect(afterBlue.moved).toBe(true);
    expect(afterBlue.attempt.moves).toEqual([
      {
        robotId: 'red',
        direction: 'left',
        from: { row: 5, column: 5 },
        to: { row: 5, column: 0 },
      },
      {
        robotId: 'blue',
        direction: 'left',
        from: { row: 5, column: 10 },
        to: { row: 5, column: 1 },
      },
    ]);
    expect(getAttemptMoveCount(afterBlue.attempt)).toBe(2);
    expect(initial.robots).toBe(BASE_ROBOTS);
    expect(initial.moves).toEqual([]);
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
      robots: robotsWith({ blue: { row: 5, column: 6 } }),
      direction: 'right',
    },
  ])('does not record a no-op caused by an adjacent $name', ({ board, robots, direction }) => {
    const attempt = createAttempt(robots);
    const result = moveAttemptRobot(board, attempt, 'red', direction);

    expect(result.moved).toBe(false);
    expect(result.attempt).toBe(attempt);
    expect(result.attempt.robots).toBe(robots);
    expect(getAttemptMoveCount(result.attempt)).toBe(0);
  });

  test('undoes retained moves in LIFO order and recovers the round start', () => {
    const initial = createAttempt(BASE_ROBOTS);
    const afterRed = move(initial, 'red', 'left');
    const afterBlue = move(afterRed, 'blue', 'left');
    const undoBlue = undoAttempt(afterBlue);
    const undoRed = undoAttempt(undoBlue);

    expect(undoBlue.robots.blue).toEqual(BASE_ROBOTS.blue);
    expect(undoBlue.robots.red).toEqual({ row: 5, column: 0 });
    expect(undoBlue.moves).toEqual(afterRed.moves);
    expect(undoRed.robots).toEqual(BASE_ROBOTS);
    expect(undoRed.moves).toEqual([]);
    expect(getAttemptMoveCount(undoRed)).toBe(0);
  });

  test('returns the original attempt when undo has no retained move', () => {
    const attempt = createAttempt(BASE_ROBOTS);

    expect(undoAttempt(attempt)).toBe(attempt);
  });

  test('discards an undone branch when a different move follows', () => {
    const initial = createAttempt(BASE_ROBOTS);
    const afterRed = move(initial, 'red', 'left');
    const afterBlue = move(afterRed, 'blue', 'left');
    const replacement = move(undoAttempt(afterBlue), 'blue', 'up');

    expect(replacement.moves).toHaveLength(2);
    expect(replacement.moves[1]).toMatchObject({
      robotId: 'blue',
      direction: 'up',
      from: BASE_ROBOTS.blue,
      to: { row: 0, column: 10 },
    });
    expect(replacement.moves).not.toContainEqual(afterBlue.moves[1]);
  });

  test('reset restores every robot and clears retained history for free', () => {
    const initial = createAttempt(BASE_ROBOTS);
    const moved = move(move(initial, 'red', 'left'), 'blue', 'left');
    const reset = resetAttempt(moved);

    expect(reset.roundStartRobots).toBe(BASE_ROBOTS);
    expect(reset.robots).toBe(BASE_ROBOTS);
    expect(reset.moves).toEqual([]);
    expect(getAttemptMoveCount(reset)).toBe(0);
    expect(undoAttempt(reset)).toBe(reset);
    expect(resetAttempt(reset)).toBe(reset);
    expect(resetAttempt(initial)).toBe(initial);
  });

  test('target completion follows current positions through move, undo, and reset', () => {
    const target: Target = {
      id: 'red-stop',
      kind: 'colored',
      robotId: 'red',
      position: { row: 5, column: 9 },
    };
    const initial = createAttempt(BASE_ROBOTS);
    const solved = move(initial, 'red', 'right');

    expect(isTargetComplete(initial.robots, target)).toBe(false);
    expect(isTargetComplete(solved.robots, target)).toBe(true);
    expect(isTargetComplete(undoAttempt(solved).robots, target)).toBe(false);
    expect(isTargetComplete(resetAttempt(solved).robots, target)).toBe(false);
  });

  test('counts only moves retained after undo, replacement, and reset', () => {
    let attempt = createAttempt(BASE_ROBOTS);
    attempt = move(attempt, 'red', 'left');
    attempt = move(attempt, 'blue', 'left');
    expect(getAttemptMoveCount(attempt)).toBe(2);

    attempt = undoAttempt(attempt);
    expect(getAttemptMoveCount(attempt)).toBe(1);

    attempt = move(attempt, 'blue', 'up');
    expect(getAttemptMoveCount(attempt)).toBe(2);

    expect(getAttemptMoveCount(resetAttempt(attempt))).toBe(0);
  });

  test('does not mutate frozen inputs or earlier attempt values', () => {
    const board = Object.freeze({
      blockedCells: Object.freeze(
        CENTER_BLOCKED_CELLS.map((cell) => Object.freeze({ ...cell })),
      ),
      walls: Object.freeze([]),
    });
    const robots = Object.freeze({
      red: Object.freeze({ row: 5, column: 5 }),
      blue: Object.freeze({ row: 5, column: 10 }),
      green: Object.freeze({ row: 10, column: 1 }),
      yellow: Object.freeze({ row: 10, column: 13 }),
    });
    const initial = createAttempt(robots);
    Object.freeze(initial.moves);
    Object.freeze(initial);
    const beforeBoard = JSON.stringify(board);
    const beforeInitial = JSON.stringify(initial);

    const moved = moveAttemptRobot(board, initial, 'red', 'left').attempt;
    const beforeMoved = JSON.stringify(moved);
    const undone = undoAttempt(moved);
    const reset = resetAttempt(moved);

    expect(undone.robots).toEqual(robots);
    expect(reset.robots).toBe(robots);
    expect(JSON.stringify(board)).toBe(beforeBoard);
    expect(JSON.stringify(initial)).toBe(beforeInitial);
    expect(JSON.stringify(moved)).toBe(beforeMoved);
  });

  test('is deterministic for structurally identical operation sequences', () => {
    function run(robots: RobotPositions): AttemptState {
      let attempt = createAttempt(robots);
      attempt = move(attempt, 'red', 'left');
      attempt = move(attempt, 'blue', 'left');
      attempt = undoAttempt(attempt);
      return move(attempt, 'blue', 'up');
    }

    const first = run({
      red: { ...BASE_ROBOTS.red },
      blue: { ...BASE_ROBOTS.blue },
      green: { ...BASE_ROBOTS.green },
      yellow: { ...BASE_ROBOTS.yellow },
    });
    const second = run({
      red: { ...BASE_ROBOTS.red },
      blue: { ...BASE_ROBOTS.blue },
      green: { ...BASE_ROBOTS.green },
      yellow: { ...BASE_ROBOTS.yellow },
    });

    expect(first).toEqual(second);
  });
});
