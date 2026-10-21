import type { Direction, RobotId } from '@robot-puzzle/game-engine';

export interface SolverMove {
  readonly robotId: RobotId;
  readonly direction: Direction;
}

export interface SolverLimits {
  /** Maximum states whose outgoing moves may be examined; zero is allowed. */
  readonly maxExpandedStates: number;
  /** Includes the initial state. Must be in [1, MAX_STORED_STATES]. */
  readonly maxStoredStates: number;
}

/** Implementation safety ceiling, not a recommended live-round budget. */
export const MAX_STORED_STATES = 1_000_000;

export interface SolverStats {
  /** Includes a partially expanded final state on early return. */
  readonly expandedStates: number;
  readonly attemptedMoves: number;
  /** Non-no-op successors, including duplicates and a successful final state. */
  readonly generatedStates: number;
  /** Unique retained states, including the root; a goal is returned, not stored. */
  readonly peakStoredStates: number;
  /** Exact typed-array allocation; excludes the visited Set and JS overhead. */
  readonly searchArrayBytes: number;
}

export type SolverResult =
  | { readonly status: 'solved'; readonly moves: readonly SolverMove[]; readonly stats: SolverStats }
  | { readonly status: 'unsolvable'; readonly stats: SolverStats }
  | {
      readonly status: 'unknown';
      readonly reason: 'expansion-limit' | 'storage-limit';
      readonly stats: SolverStats;
    };
