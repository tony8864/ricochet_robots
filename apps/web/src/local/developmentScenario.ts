import { createMatch, prepareMatchRound, transitionMatch } from '@robot-puzzle/match';
import { getPuzzleBoard } from '@robot-puzzle/puzzles';
import { RECOMMENDED_ROUND_SETUP_BUDGET } from '@robot-puzzle/puzzles/round-setup';
import { createLocalMatchController } from './controller';
import { DEMO_BOARD_ID, LOCAL_HOST_SEAT_ID, LOCAL_PLAYERS } from './config';

/** Called once by main, outside React. Only dynamically loaded in Vite dev mode. */
export function createDevelopmentController() {
  const puzzle = getPuzzleBoard(DEMO_BOARD_ID);
  if (!puzzle) throw new Error(`Unknown local board: ${DEMO_BOARD_ID}`);
  const created = createMatch({ matchId: 'local-demonstration', players: LOCAL_PLAYERS, puzzle });
  let state = prepareMatchRound(created, {
    candidateOrder: ['blue-star', ...puzzle.targets.map((target) => target.id).filter((id) => id !== 'blue-star')],
    budget: RECOMMENDED_ROUND_SETUP_BUDGET,
  }).state;
  if (state.phase === 'thinking') {
    for (const [actorSeatId, value] of [['maria', 10], ['alex', 12]] as const) {
      state = transitionMatch(state, {
        source: 'player', command: { type: 'bid.submit', value },
        context: { actorSeatId, hostSeatId: LOCAL_HOST_SEAT_ID, nowMs: 1_000 },
      }).state;
    }
    state = transitionMatch(state, {
      source: 'controller', command: { type: 'time.advance' }, context: { nowMs: 61_000 },
    }).state;
  }
  // The starter uses a fixed simulated clock, not a real countdown or phase shortcut.
  return createLocalMatchController({
    match: state, hostSeatId: LOCAL_HOST_SEAT_ID, actingSeatId: LOCAL_HOST_SEAT_ID, now: () => 61_000,
  });
}
