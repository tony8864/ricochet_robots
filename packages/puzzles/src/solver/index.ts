import type { GameState } from '@robot-puzzle/game-engine';
import { createIndexedTransition } from './indexedTransitions';
import { searchPuzzle } from './search';
import type { SolverLimits, SolverResult } from './types';

export { MAX_STORED_STATES } from './types';
export type { SolverLimits, SolverMove, SolverResult, SolverStats } from './types';

/** Hidden validation only; not a hint API or live-round selection policy. */
export function solvePuzzle(input: GameState, limits: SolverLimits): SolverResult {
  return searchPuzzle(input, limits, createIndexedTransition);
}
