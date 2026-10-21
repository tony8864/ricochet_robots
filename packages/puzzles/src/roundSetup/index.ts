import { solvePuzzle } from '../solver';
import { prepareRoundWithSolver } from './prepare';
import type { RoundSetupInput, RoundSetupResult } from './types';

export { RECOMMENDED_ROUND_SETUP_BUDGET } from './types';
export type {
  CandidateDiagnostic, PreparedRound, RoundSetupBudget, RoundSetupDiagnostics, RoundSetupInput, RoundSetupResult,
} from './types';

/** Prepare a verified round; the caller commits used-target tracking on reveal. */
export function prepareNextRound(input: RoundSetupInput): RoundSetupResult {
  return prepareRoundWithSolver(input, solvePuzzle);
}
