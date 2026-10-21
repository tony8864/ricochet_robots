import { createBoard } from '../createBoard';

// Copy this file to start a new board, then register it in ../catalog.ts.
// Coordinates are zero-based: row increases downward, column rightward.
// Each corner generates two walls on the named sides of the target cell.
export const starterBoard = createBoard({
  id: 'starter-board',
  name: 'Starter Board',
  initialRobots: {
    red: { row: 0, column: 0 },
    blue: { row: 0, column: 15 },
    green: { row: 15, column: 0 },
    yellow: { row: 15, column: 15 },
  },
  additionalWalls: [
    {
      first:  { row: 15, column: 6 },
      second: { row: 15, column: 7 },
    }
  ],
  targets: [
    { robotId: 'red', symbol: 'star', row: 3, column: 12, corner: 'bottom-right' },
    { robotId: 'red', symbol: 'crescent', row: 1, column: 4, corner: 'top-right' },
    { robotId: 'red', symbol: 'triangle', row: 11, column: 2, corner: 'bottom-left' },
    { robotId: 'red', symbol: 'square', row: 7, column: 13, corner: 'top-left' },

    { robotId: 'blue', symbol: 'star', row: 14, column: 11, corner: 'bottom-left' },
    { robotId: 'blue', symbol: 'crescent', row: 5, column: 6, corner: 'bottom-right' },
    { robotId: 'blue', symbol: 'triangle', row: 9, column: 4, corner: 'top-left' },
    { robotId: 'blue', symbol: 'square', row: 2, column: 9, corner: 'bottom-left' },

    { robotId: 'green', symbol: 'star', row: 12, column: 7, corner: 'top-right' },
    { robotId: 'green', symbol: 'crescent', row: 4, column: 2, corner: 'bottom-right' },
    { robotId: 'green', symbol: 'triangle', row: 10, column: 12, corner: 'top-left' },
    { robotId: 'green', symbol: 'square', row: 6, column: 10, corner: 'bottom-left' },

    { robotId: 'yellow', symbol: 'star', row: 2, column: 1, corner: 'top-left' },
    { robotId: 'yellow', symbol: 'crescent', row: 13, column: 4, corner: 'bottom-right' },
    { robotId: 'yellow', symbol: 'triangle', row: 8, column: 2, corner: 'top-right' },
    { robotId: 'yellow', symbol: 'square', row: 4, column: 14, corner: 'bottom-left' },

    { symbol: 'vortex', row: 11, column: 14, corner: 'top-right' },
  ],
});
