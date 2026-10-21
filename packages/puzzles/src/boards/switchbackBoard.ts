import { createBoard } from '../createBoard';

// Staggered inner and outer corners offer several changes of direction.
// Fixed, hand-authored placements; coordinates are zero-based.
export const switchbackBoard = createBoard({
  id: 'switchback',
  name: 'Switchback',
  initialRobots: {
    red: { row: 0, column: 0 },
    blue: { row: 0, column: 15 },
    green: { row: 15, column: 0 },
    yellow: { row: 15, column: 15 },
  },
  // One inward segment from each outer border: top, right, bottom, left.
  additionalWalls: [
    { first: { row: 0, column: 8 }, second: { row: 0, column: 9 } },
    { first: { row: 11, column: 15 }, second: { row: 12, column: 15 } },
    { first: { row: 15, column: 5 }, second: { row: 15, column: 6 } },
    { first: { row: 4, column: 0 }, second: { row: 5, column: 0 } },
  ],
  targets: [
    { robotId: 'red', symbol: 'star', row: 12, column: 4, corner: 'top-right' },
    { robotId: 'red', symbol: 'crescent', row: 3, column: 10, corner: 'bottom-left' },
    { robotId: 'red', symbol: 'triangle', row: 6, column: 2, corner: 'bottom-right' },
    { robotId: 'red', symbol: 'square', row: 10, column: 13, corner: 'top-left' },

    { robotId: 'blue', symbol: 'star', row: 2, column: 5, corner: 'top-left' },
    { robotId: 'blue', symbol: 'crescent', row: 13, column: 11, corner: 'bottom-right' },
    { robotId: 'blue', symbol: 'triangle', row: 8, column: 11, corner: 'top-right' },
    { robotId: 'blue', symbol: 'square', row: 5, column: 7, corner: 'bottom-left' },

    { robotId: 'green', symbol: 'star', row: 4, column: 13, corner: 'bottom-right' },
    { robotId: 'green', symbol: 'crescent', row: 11, column: 7, corner: 'bottom-left' },
    { robotId: 'green', symbol: 'triangle', row: 1, column: 2, corner: 'top-right' },
    { robotId: 'green', symbol: 'square', row: 9, column: 1, corner: 'top-left' },

    { robotId: 'yellow', symbol: 'star', row: 7, column: 5, corner: 'top-left' },
    { robotId: 'yellow', symbol: 'crescent', row: 14, column: 2, corner: 'bottom-left' },
    { robotId: 'yellow', symbol: 'triangle', row: 1, column: 13, corner: 'bottom-left' },
    { robotId: 'yellow', symbol: 'square', row: 14, column: 8, corner: 'top-right' },

    { symbol: 'vortex', row: 4, column: 4, corner: 'top-right' },
  ],
});
