import { createBoard } from '../createBoard';

// Scattered corner pairs break up the open lanes without lining targets up in rows.
// Fixed, hand-authored placements; coordinates are zero-based.
export const constellationBoard = createBoard({
  id: 'constellation',
  name: 'Constellation',
  initialRobots: {
    red: { row: 0, column: 0 },
    blue: { row: 0, column: 15 },
    green: { row: 15, column: 0 },
    yellow: { row: 15, column: 15 },
  },
  // One inward segment from each outer border: top, right, bottom, left.
  additionalWalls: [
    { first: { row: 0, column: 5 }, second: { row: 0, column: 6 } },
    { first: { row: 3, column: 15 }, second: { row: 4, column: 15 } },
    { first: { row: 15, column: 12 }, second: { row: 15, column: 13 } },
    { first: { row: 2, column: 0 }, second: { row: 3, column: 0 } },
  ],
  targets: [
    { robotId: 'red', symbol: 'star', row: 8, column: 3, corner: 'top-right' },
    { robotId: 'red', symbol: 'crescent', row: 2, column: 12, corner: 'bottom-left' },
    { robotId: 'red', symbol: 'triangle', row: 11, column: 11, corner: 'bottom-right' },
    { robotId: 'red', symbol: 'square', row: 5, column: 8, corner: 'top-left' },

    { robotId: 'blue', symbol: 'star', row: 3, column: 6, corner: 'bottom-right' },
    { robotId: 'blue', symbol: 'crescent', row: 13, column: 4, corner: 'bottom-left' },
    { robotId: 'blue', symbol: 'triangle', row: 6, column: 14, corner: 'top-right' },
    { robotId: 'blue', symbol: 'square', row: 10, column: 7, corner: 'top-left' },

    { robotId: 'green', symbol: 'star', row: 1, column: 3, corner: 'top-left' },
    { robotId: 'green', symbol: 'crescent', row: 9, column: 14, corner: 'bottom-left' },
    { robotId: 'green', symbol: 'triangle', row: 14, column: 10, corner: 'top-right' },
    { robotId: 'green', symbol: 'square', row: 6, column: 1, corner: 'bottom-right' },

    { robotId: 'yellow', symbol: 'star', row: 4, column: 11, corner: 'top-right' },
    { robotId: 'yellow', symbol: 'crescent', row: 12, column: 1, corner: 'bottom-right' },
    { robotId: 'yellow', symbol: 'triangle', row: 14, column: 7, corner: 'top-left' },
    { robotId: 'yellow', symbol: 'square', row: 1, column: 9, corner: 'bottom-left' },

    { symbol: 'vortex', row: 7, column: 5, corner: 'bottom-right' },
  ],
});
