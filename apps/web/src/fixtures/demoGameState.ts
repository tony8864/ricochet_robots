import {
  CENTER_BLOCKED_CELLS,
  assertValidGameState,
  type GameState,
} from '@robot-puzzle/game-engine';

/** Temporary rendering fixture. It is not a solver-verified puzzle. */
export const DEMO_GAME_STATE = {
  board: {
    blockedCells: CENTER_BLOCKED_CELLS,
    walls: [
      {
        first: { row: 2, column: 2 },
        second: { row: 2, column: 3 },
      },
      {
        first: { row: 3, column: 6 },
        second: { row: 4, column: 6 },
      },
      {
        first: { row: 5, column: 11 },
        second: { row: 5, column: 12 },
      },
      {
        first: { row: 5, column: 14 },
        second: { row: 6, column: 14 },
      },
      {
        first: { row: 10, column: 3 },
        second: { row: 10, column: 4 },
      },
      {
        first: { row: 11, column: 2 },
        second: { row: 12, column: 2 },
      },
      {
        first: { row: 12, column: 9 },
        second: { row: 13, column: 9 },
      },
      {
        first: { row: 13, column: 12 },
        second: { row: 13, column: 13 },
      },
    ],
  },
  robots: {
    red: { row: 1, column: 1 },
    blue: { row: 4, column: 12 },
    green: { row: 12, column: 3 },
    yellow: { row: 14, column: 14 },
  },
  target: {
    id: 'demo-blue-target',
    kind: 'colored',
    robotId: 'blue',
    position: { row: 3, column: 9 },
  },
} satisfies GameState;

assertValidGameState(DEMO_GAME_STATE);
