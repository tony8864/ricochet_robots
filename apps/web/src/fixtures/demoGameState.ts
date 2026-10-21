import {
  assertValidGameState,
  type GameState,
} from '@robot-puzzle/game-engine';
import { getPuzzleBoard } from '@robot-puzzle/puzzles';

// Change only this ID to preview another registered board:
// starter-board, crossroads, switchback, pinwheel, constellation.
export const DEMO_BOARD_ID = 'crossroads';

const demoBoard = getPuzzleBoard(DEMO_BOARD_ID);
if (!demoBoard) {
  throw new Error(`Demonstration board "${DEMO_BOARD_ID}" was not found in the catalog.`);
}

/** Fixed local bid used only by the temporary demonstration. */
export const DEMO_BID_LIMIT = 10;

export const DEMO_TARGETS = demoBoard.targets;

const activeTarget = DEMO_TARGETS.find((target) => target.id === 'blue-star');
if (!activeTarget) {
  throw new Error(`Demonstration board "${DEMO_BOARD_ID}" must include the blue star target.`);
}

/** Local preview; only the starter board's blue-star solution is verified. */
export const DEMO_GAME_STATE = {
  board: demoBoard.board,
  robots: demoBoard.initialRobots,
  target: activeTarget,
} satisfies GameState;

assertValidGameState(DEMO_GAME_STATE);
for (const target of DEMO_TARGETS) {
  assertValidGameState({ ...DEMO_GAME_STATE, target });
}
