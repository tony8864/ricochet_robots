import {
  isTargetComplete, moveRobot, type Board, type GameState, type RobotPositions,
} from '@robot-puzzle/game-engine';
import type { SolverMove } from './types';

/** Tiny legal engine boards, not catalog designs. All omitted cells are blocked. */
function openCells(cells: readonly (readonly [number, number])[]): Board {
  const open = new Set(cells.map(([row, column]) => row * 16 + column));
  return {
    walls: [],
    blockedCells: Array.from({ length: 256 }, (_, cell) => cell)
      .filter((cell) => !open.has(cell))
      .map((cell) => ({ row: cell >>> 4, column: cell & 15 })),
  };
}

// Red can only alternate between (0,0) and (0,2). The other robots are isolated.
export const impossibleFixture: GameState = {
  board: openCells([[0, 0], [0, 1], [0, 2], [2, 0], [2, 2], [4, 0]]),
  robots: {
    red: { row: 0, column: 0 }, blue: { row: 2, column: 0 },
    green: { row: 2, column: 2 }, yellow: { row: 4, column: 0 },
  },
  target: { id: 'impossible', kind: 'colored', robotId: 'red', symbol: 'star', position: { row: 0, column: 1 } },
};

// Blue must go up to (0,2) so red can stop on (0,1). Red alone cannot solve it.
export const helperFixture: GameState = {
  board: openCells([[0, 0], [0, 1], [0, 2], [0, 3], [1, 2], [2, 2], [4, 0], [4, 2]]),
  robots: {
    red: { row: 0, column: 0 }, blue: { row: 2, column: 2 },
    green: { row: 4, column: 0 }, yellow: { row: 4, column: 2 },
  },
  target: { id: 'helper', kind: 'colored', robotId: 'red', symbol: 'star', position: { row: 0, column: 1 } },
};

/** Independent witness verification, using only authoritative engine rules. */
export function replaySolution(input: GameState, moves: readonly SolverMove[]): RobotPositions {
  let robots = input.robots;
  for (const move of moves) {
    const result = moveRobot(input.board, robots, move.robotId, move.direction);
    if (!result.moved) throw new Error('Solver witness contains a no-op move.');
    robots = result.robots;
  }
  if (!isTargetComplete(robots, input.target)) throw new Error('Solver witness does not complete the target.');
  return robots;
}
