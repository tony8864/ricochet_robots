import type { RobotPositions, Target } from '@robot-puzzle/game-engine';
import type { SolverLimits, SolverMove, SolverResult, SolverStats } from '../solver';
import type { PuzzleBoard } from '../types';

export interface RoundSetupBudget {
  readonly perCandidate: SolverLimits;
  readonly maxTotalExpandedStates: number;
}

/** Provisional local policy; callers supply it explicitly. Server profiling remains necessary. */
export const RECOMMENDED_ROUND_SETUP_BUDGET: RoundSetupBudget = Object.freeze({
  perCandidate: Object.freeze({ maxExpandedStates: 50_000, maxStoredStates: 150_000 }),
  maxTotalExpandedStates: 200_000,
});

export interface RoundSetupInput {
  readonly puzzle: PuzzleBoard;
  /** All four current official positions, never provisional attempt positions. */
  readonly robots: RobotPositions;
  readonly usedTargetIds: readonly string[];
  /** Every board target exactly once; the caller owns shuffling. */
  readonly candidateOrder: readonly string[];
  readonly budget: RoundSetupBudget;
}

export type CandidateDiagnostic = {
  readonly targetId: string;
  readonly limits: SolverLimits;
  readonly stats: SolverStats;
} & (
  | { readonly status: 'solved' | 'unsolvable' }
  | { readonly status: 'unknown'; readonly reason: Extract<SolverResult, { status: 'unknown' }>['reason'] }
);

export interface RoundSetupDiagnostics {
  readonly totalTargets: number;
  readonly usedTargetCount: number;
  /** Counts unused targets only. */
  readonly alreadyCompleteTargetCount: number;
  readonly eligibleTargetCount: number;
  readonly untestedTargetCount: number;
  readonly totalExpandedStates: number;
  readonly candidates: readonly CandidateDiagnostic[];
}

export interface PreparedRound {
  readonly boardId: string;
  readonly target: Target;
  readonly roundStartRobots: RobotPositions;
}

export type RoundSetupResult = { readonly diagnostics: RoundSetupDiagnostics } & (
  | {
      readonly status: 'selected';
      readonly round: PreparedRound;
      /** Internal verification data, deliberately separate from public round data. */
      readonly internalProof: readonly SolverMove[];
    }
  | {
      readonly status: 'unavailable';
      readonly reason: 'all-targets-used' | 'all-unused-targets-complete' | 'all-eligible-targets-unsolvable';
    }
  | {
      readonly status: 'deferred';
      /** Total limit leaves untested candidates; unverified means all were examined. */
      readonly reason: 'total-expansion-limit' | 'candidate-expansion-limit' | 'unverified-candidates';
    }
);
