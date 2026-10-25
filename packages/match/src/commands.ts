import type { Direction, RobotId } from '@robot-puzzle/game-engine';
import type { PuzzleBoard } from '@robot-puzzle/puzzles';
import type { RoundSetupInput, RoundSetupResult } from '@robot-puzzle/puzzles/round-setup';
import type { MatchPlayer, MatchState, SeatId, UnfinishedRoundCount } from './model';

/** Creation will validate a fixed roster and use the puzzle's initial positions. */
export interface CreateMatchInput {
  readonly matchId: string;
  readonly players: readonly MatchPlayer[];
  readonly puzzle: PuzzleBoard;
}

export type PlayerMatchCommand =
  | { readonly type: 'bid.submit'; readonly value: number }
  | { readonly type: 'attempt.move'; readonly robotId: RobotId; readonly direction: Direction }
  | { readonly type: 'attempt.undo' }
  | { readonly type: 'attempt.reset' }
  | { readonly type: 'attempt.giveUp' }
  | { readonly type: 'round.skip'; readonly confirmed: boolean };

/** Trusted caller context, never authority supplied inside a network payload. */
export interface PlayerMatchContext {
  readonly actorSeatId: SeatId;
  readonly hostSeatId: SeatId;
  readonly nowMs: number;
}

/** Binds a T10 result to the exact match/round/board/positions/used-ID context. */
export interface RoundPreparationRequest {
  readonly matchId: string;
  readonly completedRounds: UnfinishedRoundCount;
  readonly setup: RoundSetupInput;
}

/** Caller-owned ordering and limits; match identity/positions come from state. */
export type RoundPreparationOptions = Pick<RoundSetupInput, 'candidateOrder' | 'budget'>;

/** Internal operations are distinct from commands a player may request. */
export type ControllerMatchCommand =
  | { readonly type: 'time.advance' }
  | { readonly type: 'round.advance' }
  | {
      readonly type: 'round.prepared';
      readonly request: RoundPreparationRequest;
      readonly result: RoundSetupResult;
    };

export interface ControllerMatchContext {
  readonly nowMs: number;
}

/** A single transition input keeps internal preparation out of player actions. */
export type MatchAction =
  | { readonly source: 'player'; readonly command: PlayerMatchCommand; readonly context: PlayerMatchContext }
  | { readonly source: 'controller'; readonly command: ControllerMatchCommand; readonly context: ControllerMatchContext };

/** Historical T11.3 subset; transitionMatch accepts the complete MatchAction. */
export type BiddingStageAction =
  | {
      readonly source: 'player';
      readonly command: Extract<PlayerMatchCommand, { type: 'bid.submit' }>;
      readonly context: PlayerMatchContext;
    }
  | {
      readonly source: 'controller';
      readonly command: Extract<ControllerMatchCommand, { type: 'time.advance' | 'round.prepared' }>;
      readonly context: ControllerMatchContext;
    };

export type AttemptMatchCommand = Extract<PlayerMatchCommand, {
  type: 'attempt.move' | 'attempt.undo' | 'attempt.reset' | 'attempt.giveUp';
}>;

/** Historical T11.4 subset, retained for callers that only need attempt commands. */
export type DemonstrationStageAction = BiddingStageAction | {
  readonly source: 'player';
  readonly command: AttemptMatchCommand;
  readonly context: PlayerMatchContext;
};

export type MatchNoOpReason =
  | 'same-bid'
  | 'blocked-move'
  | 'empty-undo'
  | 'already-reset'
  | 'deadline-not-due'
  | 'no-active-deadline';

export type MatchRejectionReason =
  | 'invalid-command'
  | 'invalid-context'
  | 'wrong-phase'
  | 'unknown-player'
  | 'not-host'
  | 'confirmation-required'
  | 'not-active-bidder'
  | 'invalid-bid'
  | 'bid-increase'
  | 'bidding-closed'
  | 'bid-limit'
  | 'stale-preparation'
  | 'invalid-preparation'
  | 'match-finished';

export type MatchCommandOutcome =
  | { readonly status: 'accepted' }
  | { readonly status: 'no-op'; readonly reason: MatchNoOpReason }
  | { readonly status: 'rejected'; readonly reason: MatchRejectionReason };

export interface MatchTransitionResult {
  /** Always consume this state: due deadline expiry can accompany a rejection. */
  readonly state: MatchState;
  readonly outcome: MatchCommandOutcome;
}

/** Full lifecycle contract implemented by transitionMatch. */
export type MatchTransition = (state: MatchState, action: MatchAction) => MatchTransitionResult;
