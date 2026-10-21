import { starterBoard } from '../boards/starterBoard';
import type { PuzzleBoard } from '../types';

/** Catalog-valid test design: each corner robot is enclosed by a wall angle. */
export const isolatedRobotsBoard: PuzzleBoard = {
  ...starterBoard,
  id: 'isolated-corners',
  name: 'Isolated corner fixture',
  board: {
    ...starterBoard.board,
    walls: [
      ...starterBoard.board.walls,
      { first: { row: 0, column: 0 }, second: { row: 0, column: 1 } },
      { first: { row: 0, column: 0 }, second: { row: 1, column: 0 } },
      { first: { row: 0, column: 14 }, second: { row: 0, column: 15 } },
      { first: { row: 0, column: 15 }, second: { row: 1, column: 15 } },
      { first: { row: 14, column: 0 }, second: { row: 15, column: 0 } },
      { first: { row: 15, column: 0 }, second: { row: 15, column: 1 } },
      { first: { row: 14, column: 15 }, second: { row: 15, column: 15 } },
      { first: { row: 15, column: 14 }, second: { row: 15, column: 15 } },
    ],
  },
};
