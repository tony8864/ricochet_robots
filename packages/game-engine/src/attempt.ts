import { ROBOT_IDS } from './model';
import { moveRobot } from './movement';
import type {
  Board,
  Coordinate,
  Direction,
  RobotId,
  RobotPositions,
  Target,
} from './model';

export interface AttemptMove {
  readonly robotId: RobotId;
  readonly direction: Direction;
  readonly from: Coordinate;
  readonly to: Coordinate;
}

export interface AttemptState {
  readonly roundStartRobots: RobotPositions;
  readonly robots: RobotPositions;
  readonly moves: readonly AttemptMove[];
}

export interface AttemptMoveResult {
  readonly moved: boolean;
  readonly attempt: AttemptState;
}

function coordinatesEqual(first: Coordinate, second: Coordinate): boolean {
  return first.row === second.row && first.column === second.column;
}

/** Returns whether the current robot positions satisfy the target. */
export function isTargetComplete(
  robots: RobotPositions,
  target: Target,
): boolean {
  if (target.kind === 'colored') {
    return coordinatesEqual(robots[target.robotId], target.position);
  }

  return ROBOT_IDS.some((robotId) =>
    coordinatesEqual(robots[robotId], target.position),
  );
}

/** Creates an untouched attempt anchored to the round-start positions. */
export function createAttempt(
  roundStartRobots: RobotPositions,
): AttemptState {
  return {
    roundStartRobots,
    robots: roundStartRobots,
    moves: [],
  };
}

/** Applies a sliding move and records it only when a robot changes position. */
export function moveAttemptRobot(
  board: Board,
  attempt: AttemptState,
  robotId: RobotId,
  direction: Direction,
): AttemptMoveResult {
  const movement = moveRobot(board, attempt.robots, robotId, direction);

  if (!movement.moved) {
    return { moved: false, attempt };
  }

  const move: AttemptMove = {
    robotId,
    direction,
    from: movement.from,
    to: movement.to,
  };

  return {
    moved: true,
    attempt: {
      roundStartRobots: attempt.roundStartRobots,
      robots: movement.robots,
      moves: [...attempt.moves, move],
    },
  };
}

/** Removes the latest retained move and restores that robot's prior position. */
export function undoAttempt(attempt: AttemptState): AttemptState {
  const lastMove = attempt.moves.at(-1);
  if (lastMove === undefined) {
    return attempt;
  }

  return {
    roundStartRobots: attempt.roundStartRobots,
    robots: {
      ...attempt.robots,
      [lastMove.robotId]: lastMove.from,
    },
    moves: attempt.moves.slice(0, -1),
  };
}

/** Restores every robot to its round-start position and clears move history. */
export function resetAttempt(attempt: AttemptState): AttemptState {
  if (attempt.moves.length === 0) {
    return attempt;
  }

  return {
    roundStartRobots: attempt.roundStartRobots,
    robots: attempt.roundStartRobots,
    moves: [],
  };
}

/** Returns the number of moves retained in the current attempt sequence. */
export function getAttemptMoveCount(attempt: AttemptState): number {
  return attempt.moves.length;
}
