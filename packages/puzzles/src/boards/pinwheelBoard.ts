import { createBoard } from '../createBoard';

// Alternating corner directions spread routes around the blocked center.
// Fixed, hand-authored placements; coordinates are zero-based.
export const pinwheelBoard = createBoard({
  id: 'pinwheel',
  name: 'Pinwheel',
  initialRobots: {
    red: { row: 0, column: 0 },
    blue: { row: 0, column: 15 },
    green: { row: 15, column: 0 },
    yellow: { row: 15, column: 15 },
  },
  // One inward segment from each outer border: top, right, bottom, left.
  additionalWalls: [
    { first: { row: 0, column: 12 }, second: { row: 0, column: 13 } },
    { first: { row: 6, column: 15 }, second: { row: 7, column: 15 } },
    { first: { row: 15, column: 10 }, second: { row: 15, column: 11 } },
    { first: { row: 7, column: 0 }, second: { row: 8, column: 0 } },
  ],
  targets: [
    { robotId: 'red', symbol: 'star', row: 5, column: 12, corner: 'bottom-left' },
    { robotId: 'red', symbol: 'crescent', row: 12, column: 9, corner: 'bottom-right' },
    { robotId: 'red', symbol: 'triangle', row: 2, column: 3, corner: 'top-right' },
    { robotId: 'red', symbol: 'square', row: 9, column: 5, corner: 'top-left' },

    { robotId: 'blue', symbol: 'star', row: 13, column: 2, corner: 'top-left' },
    { robotId: 'blue', symbol: 'crescent', row: 4, column: 7, corner: 'bottom-right' },
    { robotId: 'blue', symbol: 'triangle', row: 11, column: 13, corner: 'top-right' },
    { robotId: 'blue', symbol: 'square', row: 1, column: 10, corner: 'bottom-left' },

    { robotId: 'green', symbol: 'star', row: 6, column: 4, corner: 'bottom-right' },
    { robotId: 'green', symbol: 'crescent', row: 8, column: 13, corner: 'top-left' },
    { robotId: 'green', symbol: 'triangle', row: 14, column: 6, corner: 'bottom-left' },
    { robotId: 'green', symbol: 'square', row: 4, column: 1, corner: 'top-right' },

    { robotId: 'yellow', symbol: 'star', row: 10, column: 8, corner: 'bottom-left' },
    { robotId: 'yellow', symbol: 'crescent', row: 7, column: 10, corner: 'top-right' },
    { robotId: 'yellow', symbol: 'triangle', row: 3, column: 14, corner: 'top-left' },
    { robotId: 'yellow', symbol: 'square', row: 1, column: 6, corner: 'bottom-right' },

    { symbol: 'vortex', row: 11, column: 1, corner: 'bottom-right' },
  ],
});
