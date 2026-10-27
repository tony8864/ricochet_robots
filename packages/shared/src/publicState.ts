import type { Board, RobotPositions, Target } from '@robot-puzzle/game-engine';
import type {
  DemonstratingMatchState, MatchState, NonEmptyBids, PreparingMatchState,
  RoundNumber, RoundOutcome, UnfinishedRoundCount,
} from '@robot-puzzle/match';

export const MAX_SERVER_MESSAGE_BYTES = 65_536;
export interface PublicPlayer {
  readonly seatId: string;
  readonly nickname: string;
  readonly connected: boolean;
}
export interface PublicPuzzle {
  readonly id: string;
  readonly name: string;
  readonly board: Board;
  readonly targets: readonly Target[];
  readonly initialRobots: RobotPositions;
}
export interface PublicRound {
  readonly number: RoundNumber;
  readonly targetId: string;
  readonly startRobots: RobotPositions;
}
export interface PublicAttempt {
  readonly id: string;
  readonly version: number;
  readonly robots: RobotPositions;
  readonly moveCount: number;
}
export type PublicPreparationStatus = 'working' | 'deferred' | 'unavailable' | 'error';
interface PublicMatchBase {
  readonly matchId: string;
  readonly scores: Readonly<Record<string, number>>;
  readonly officialRobots: RobotPositions;
  readonly usedTargetIds: readonly string[];
}
export type PublicMatch = PublicMatchBase & (
  | { readonly phase: 'preparing'; readonly completedRounds: UnfinishedRoundCount; readonly preparation: { readonly status: PublicPreparationStatus } }
  | { readonly phase: 'thinking'; readonly completedRounds: UnfinishedRoundCount; readonly round: PublicRound }
  | { readonly phase: 'bidding'; readonly completedRounds: UnfinishedRoundCount; readonly round: PublicRound; readonly bids: NonEmptyBids; readonly deadlineAtMs: number }
  | { readonly phase: 'demonstrating'; readonly completedRounds: UnfinishedRoundCount; readonly round: PublicRound; readonly bidderQueue: NonEmptyBids; readonly activeBidderIndex: number; readonly attempt: PublicAttempt }
  | { readonly phase: 'round-result'; readonly completedRounds: RoundNumber; readonly round: PublicRound; readonly outcome: RoundOutcome }
  | { readonly phase: 'finished'; readonly completedRounds: 10 }
);
export interface PublicRoomMetadata {
  readonly roomId: string;
  readonly roomCode: string;
  readonly revision: number;
  readonly hostSeatId: string;
}
interface PublicRoomBase extends PublicRoomMetadata {
  readonly players: readonly PublicPlayer[];
  readonly puzzle: PublicPuzzle;
}
export type PublicRoomState = PublicRoomBase & (
  | { readonly status: 'lobby'; readonly lobbyId: string }
  | { readonly status: 'playing'; readonly match: Exclude<PublicMatch, { phase: 'finished' }> }
  | { readonly status: 'finished'; readonly match: Extract<PublicMatch, { phase: 'finished' }> }
);
export type PublicStateResult =
  | { readonly ok: true; readonly value: PublicRoomState }
  | { readonly ok: false; readonly error: 'invalid-snapshot' | 'invalid-projection' };

export interface LobbyProjectionInput extends PublicRoomMetadata {
  readonly lobbyId: string;
  readonly players: readonly PublicPlayer[];
  readonly puzzle: PublicPuzzle;
}
export interface AttemptProjectionMetadata {
  readonly matchId: string;
  readonly roundNumber: RoundNumber;
  readonly activeBidderIndex: number;
  readonly seatId: string;
  readonly id: string;
  readonly version: number;
}
export interface PreparationProjectionMetadata {
  readonly matchId: string;
  readonly completedRounds: UnfinishedRoundCount;
  readonly activity: 'idle' | 'pending' | 'failed';
}
export type MatchProjectionInput = PublicRoomMetadata & {
  /** Exactly the current match seats; identity/order come from match.players. */
  readonly connections: Readonly<Record<string, boolean>>;
} & (
  | { readonly match: DemonstratingMatchState; readonly attempt: AttemptProjectionMetadata }
  | { readonly match: PreparingMatchState; readonly preparation: PreparationProjectionMetadata }
  | { readonly match: Exclude<MatchState, { phase: 'preparing' | 'demonstrating' }> }
);
