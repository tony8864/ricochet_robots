import {
  BOARD_SIZE,
  ROBOT_IDS,
  type Board,
  type Coordinate,
  type Direction,
  type RobotId,
  type RobotPositions,
} from './model';

export interface MoveResult {
  readonly moved: boolean;
  readonly from: Coordinate;
  readonly to: Coordinate;
  readonly robots: RobotPositions;
}

const DIRECTION_DELTAS: Readonly<
  Record<Direction, { readonly row: number; readonly column: number }>
> = {
  up: { row: -1, column: 0 },
  right: { row: 0, column: 1 },
  down: { row: 1, column: 0 },
  left: { row: 0, column: -1 },
};

function coordinateKey(coordinate: Coordinate): string {
  return `${coordinate.row},${coordinate.column}`;
}

function precedes(first: Coordinate, second: Coordinate): boolean {
  return (
    first.row < second.row ||
    (first.row === second.row && first.column < second.column)
  );
}

function edgeKey(first: Coordinate, second: Coordinate): string {
  const [start, end] = precedes(first, second)
    ? [first, second]
    : [second, first];
  return `${coordinateKey(start)}|${coordinateKey(end)}`;
}

function isInBounds(coordinate: Coordinate): boolean {
  return (
    coordinate.row >= 0 &&
    coordinate.row < BOARD_SIZE &&
    coordinate.column >= 0 &&
    coordinate.column < BOARD_SIZE
  );
}

/**
 * Slides one robot to the last legal cell in a cardinal direction.
 * The board and robot positions must already satisfy the model validators.
 */
export function moveRobot(
  board: Board,
  robots: RobotPositions,
  robotId: RobotId,
  direction: Direction,
): MoveResult {
  const start = robots[robotId];
  let current = start;
  const delta = DIRECTION_DELTAS[direction];
  const blockedCells = new Set(board.blockedCells.map(coordinateKey));
  const blockedEdges = new Set(
    board.walls.map((wall) => edgeKey(wall.first, wall.second)),
  );
  const occupiedCells = new Set(
    ROBOT_IDS.filter((id) => id !== robotId).map((id) =>
      coordinateKey(robots[id]),
    ),
  );

  while (true) {
    const next: Coordinate = {
      row: current.row + delta.row,
      column: current.column + delta.column,
    };

    if (
      !isInBounds(next) ||
      blockedCells.has(coordinateKey(next)) ||
      occupiedCells.has(coordinateKey(next)) ||
      blockedEdges.has(edgeKey(current, next))
    ) {
      break;
    }

    current = next;
  }

  if (current === start) {
    return {
      moved: false,
      from: start,
      to: start,
      robots,
    };
  }

  const nextRobots: RobotPositions = {
    ...robots,
    [robotId]: current,
  };

  return {
    moved: true,
    from: start,
    to: current,
    robots: nextRobots,
  };
}
