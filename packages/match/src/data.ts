import { ROBOT_IDS, type Coordinate, type RobotPositions, type Target } from '@robot-puzzle/game-engine';
import type { PuzzleBoard } from '@robot-puzzle/puzzles';

function copyCoordinate(position: Coordinate): Coordinate {
  return { row: position.row, column: position.column };
}

export function copyRobots(robots: RobotPositions): RobotPositions {
  return { red: copyCoordinate(robots.red), blue: copyCoordinate(robots.blue), green: copyCoordinate(robots.green), yellow: copyCoordinate(robots.yellow) };
}

export function sameRobots(first: RobotPositions, second: RobotPositions): boolean {
  return ROBOT_IDS.every((id) => first[id].row === second[id].row && first[id].column === second[id].column);
}

/** Pick known fields so caller metadata/proofs cannot enter ordinary match data. */
export function copyTarget(target: Target): Target {
  const common = { id: target.id, position: copyCoordinate(target.position) };
  if (target.kind === 'colored') return { ...common, kind: 'colored', robotId: target.robotId, symbol: target.symbol };
  if (target.kind === 'wildcard') return { ...common, kind: 'wildcard', symbol: target.symbol };
  throw new TypeError('Invalid target kind.');
}

export function sameTarget(first: Target, second: Target): boolean {
  return first.id === second.id && first.kind === second.kind && first.symbol === second.symbol &&
    first.position.row === second.position.row && first.position.column === second.position.column &&
    (first.kind !== 'colored' || (second.kind === 'colored' && first.robotId === second.robotId));
}

export function copyPuzzle(puzzle: PuzzleBoard): PuzzleBoard {
  return {
    id: puzzle.id, name: puzzle.name,
    board: {
      blockedCells: puzzle.board.blockedCells.map((cell) => ({ row: cell.row, column: cell.column })),
      walls: puzzle.board.walls.map((wall) => ({ first: copyCoordinate(wall.first), second: copyCoordinate(wall.second) })),
    },
    initialRobots: copyRobots(puzzle.initialRobots),
    targets: puzzle.targets.map(copyTarget),
  };
}

/** Canonical field order; conservative equality of the exact locked definition. */
export function samePuzzle(first: PuzzleBoard, second: PuzzleBoard): boolean {
  return JSON.stringify(copyPuzzle(first)) === JSON.stringify(copyPuzzle(second));
}
