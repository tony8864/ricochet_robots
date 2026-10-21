import { createBoard } from '../createBoard';

// Offset clusters leave long routes across the middle and short turns near the edges.
// Fixed, hand-authored placements; coordinates are zero-based.
export const crossroadsBoard = createBoard({
  id: 'crossroads',
  name: 'Crossroads',
  initialRobots: {
    red: { row: 0, column: 0 },
    blue: { row: 0, column: 15 },
    green: { row: 15, column: 0 },
    yellow: { row: 15, column: 15 },
  },
  // One inward segment from each outer border: top, right, bottom, left.
  additionalWalls: [
    { first: { row: 0, column: 3 }, second: { row: 0, column: 4 } },
    { first: { row: 5, column: 15 }, second: { row: 6, column: 15 } },
    { first: { row: 15, column: 9 }, second: { row: 15, column: 10 } },
    { first: { row: 10, column: 0 }, second: { row: 11, column: 0 } },
  ],
  targets: [
    { robotId: 'red', symbol: 'star', row: 2, column: 11, corner: 'bottom-right' },
    { robotId: 'red', symbol: 'crescent', row: 10, column: 3, corner: 'top-left' },
    { robotId: 'red', symbol: 'triangle', row: 13, column: 12, corner: 'bottom-left' },
    { robotId: 'red', symbol: 'square', row: 5, column: 5, corner: 'top-right' },

    { robotId: 'blue', symbol: 'star', row: 11, column: 9, corner: 'top-right' },
    { robotId: 'blue', symbol: 'crescent', row: 3, column: 2, corner: 'bottom-left' },
    { robotId: 'blue', symbol: 'triangle', row: 4, column: 13, corner: 'top-left' },
    { robotId: 'blue', symbol: 'square', row: 14, column: 5, corner: 'bottom-right' },

    { robotId: 'green', symbol: 'star', row: 6, column: 10, corner: 'bottom-left' },
    { robotId: 'green', symbol: 'crescent', row: 1, column: 6, corner: 'top-left' },
    { robotId: 'green', symbol: 'triangle', row: 9, column: 13, corner: 'bottom-right' },
    { robotId: 'green', symbol: 'square', row: 12, column: 1, corner: 'top-right' },

    { robotId: 'yellow', symbol: 'star', row: 4, column: 8, corner: 'top-right' },
    { robotId: 'yellow', symbol: 'crescent', row: 8, column: 2, corner: 'bottom-right' },
    { robotId: 'yellow', symbol: 'triangle', row: 13, column: 8, corner: 'top-left' },
    { robotId: 'yellow', symbol: 'square', row: 7, column: 14, corner: 'bottom-left' },

    { symbol: 'vortex', row: 6, column: 4, corner: 'bottom-right' },
  ],
});
