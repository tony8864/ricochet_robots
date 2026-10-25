import type { AttemptState, RobotPositions, Target } from '@robot-puzzle/game-engine';
import type { PuzzleBoard } from '@robot-puzzle/puzzles';
import type { RoundSetupResult } from '@robot-puzzle/puzzles/round-setup';

export const MATCH_PHASES = [
  'preparing', 'thinking', 'bidding', 'demonstrating', 'round-result', 'finished',
] as const;
export const MATCH_ROUND_COUNT = 10 as const;
export const BIDDING_WINDOW_MS = 60_000 as const;

export type MatchPhase = (typeof MATCH_PHASES)[number];
export type SeatId = string;
export type RoundNumber = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;
export type CompletedRoundCount = 0 | RoundNumber;
/** Preparation and active play cannot occur after the tenth completed round. */
export type UnfinishedRoundCount = Exclude<CompletedRoundCount, 10>;

export interface MatchPlayer {
  readonly seatId: SeatId;
  readonly nickname: string;
}

export interface MatchRound {
  readonly number: RoundNumber;
  readonly target: Target;
  /** Immutable snapshot; do not replace with official positions after success. */
  readonly startRobots: RobotPositions;
}

export interface MatchBid {
  readonly seatId: SeatId;
  readonly value: number;
  /** Assigned once; lowering a bid never changes this ordering. */
  readonly firstAcceptedOrder: number;
}

/** Runtime validation must ensure distinct roster IDs, legal values, and ordering. */
export type NonEmptyBids = readonly [MatchBid, ...MatchBid[]];

/** Shared immutable data; phase interfaces narrow completedRounds where possible. */
interface MatchBase {
  readonly matchId: string;
  readonly players: readonly MatchPlayer[];
  readonly scores: Readonly<Record<SeatId, number>>;
  readonly puzzle: PuzzleBoard;
  /** Changes only when a successful demonstration commits all four positions. */
  readonly officialRobots: RobotPositions;
  readonly usedTargetIds: readonly string[];
  readonly completedRounds: CompletedRoundCount;
}

export type PreparationStatus =
  | { readonly status: 'not-attempted' }
  | Extract<RoundSetupResult, { status: 'deferred' | 'unavailable' }>;

export interface PreparingMatchState extends MatchBase {
  readonly phase: 'preparing';
  readonly completedRounds: UnfinishedRoundCount;
  readonly preparation: PreparationStatus;
}

export interface ThinkingMatchState extends MatchBase {
  readonly phase: 'thinking';
  readonly completedRounds: UnfinishedRoundCount;
  readonly round: MatchRound;
}

export interface BiddingMatchState extends MatchBase {
  readonly phase: 'bidding';
  readonly completedRounds: UnfinishedRoundCount;
  readonly round: MatchRound;
  /** At least the first accepted bid, which created this phase. */
  readonly bids: NonEmptyBids;
  readonly deadlineAtMs: number;
}

export interface DemonstratingMatchState extends MatchBase {
  readonly phase: 'demonstrating';
  readonly completedRounds: UnfinishedRoundCount;
  readonly round: MatchRound;
  /** Frozen final bids, sorted by value then firstAcceptedOrder. */
  readonly bidderQueue: NonEmptyBids;
  /** Active seat and bid limit are read from bidderQueue at this index. */
  readonly activeBidderIndex: number;
  readonly attempt: AttemptState;
}

export type RoundOutcome =
  | {
      readonly kind: 'success';
      readonly winnerSeatId: SeatId;
      readonly winningBid: number;
      readonly moveCount: number;
    }
  | { readonly kind: 'all-bidders-gave-up' }
  | { readonly kind: 'no-bid-skip' };

export interface RoundResultMatchState extends MatchBase {
  readonly phase: 'round-result';
  readonly completedRounds: RoundNumber;
  readonly round: MatchRound;
  readonly outcome: RoundOutcome;
}

export interface FinishedMatchState extends MatchBase {
  readonly phase: 'finished';
  readonly completedRounds: typeof MATCH_ROUND_COUNT;
  // Standings and all shared winners will be derived from players and scores.
}

export type MatchState =
  | PreparingMatchState
  | ThinkingMatchState
  | BiddingMatchState
  | DemonstratingMatchState
  | RoundResultMatchState
  | FinishedMatchState;
