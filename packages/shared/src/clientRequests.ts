import type { PlayerMatchCommand, RoundNumber } from '@robot-puzzle/match';

export const PROTOCOL_VERSION = 1 as const;
export const MAX_CLIENT_MESSAGE_BYTES = 4_096;
export const MAX_NICKNAME_CODE_POINTS = 24;
export const MAX_NICKNAME_BYTES = 96;
export const MAX_RAW_NICKNAME_BYTES = 256;
export const MAX_RAW_ROOM_CODE_LENGTH = 16;
export const ROOM_CODE_LENGTH = 6;
export const MAX_BOARD_ID_LENGTH = 64;

export type ClientRequestError =
  | 'invalid-json' | 'invalid-message' | 'unsupported-version' | 'message-too-large';

export type ClientRequestParseResult =
  | { readonly ok: true; readonly value: ClientRequest }
  | { readonly ok: false; readonly error: ClientRequestError };

export interface LobbyContext { readonly lobbyId: string }
export interface MatchContext { readonly matchId: string }
export interface RoundContext extends MatchContext { readonly roundNumber: RoundNumber }
export interface AttemptContext extends RoundContext {
  readonly attemptId: string;
  readonly attemptVersion: number;
}
export type EmptyContext = Readonly<Record<string, never>>;

interface Envelope<Command> {
  readonly version: typeof PROTOCOL_VERSION;
  readonly commandId: string;
  readonly command: Command;
}
interface RoomEnvelope<Command, Context> extends Envelope<Command> {
  readonly roomId: string;
  readonly context: Context;
}
type RoomVariants<Command, Context> = Command extends unknown ? RoomEnvelope<Command, Context> : never;

export type BootstrapRequest =
  | Envelope<{ readonly type: 'session.open' }>
  | Envelope<{ readonly type: 'room.create'; readonly nickname: string }>
  | Envelope<{ readonly type: 'room.join'; readonly nickname: string; readonly roomCode: string }>
  | Envelope<{ readonly type: 'session.resume'; readonly roomId: string }>;

/** Context is a precondition, not authenticated identity or server authority. */
export type RoomRequest =
  | RoomEnvelope<{ readonly type: 'state.request' }, EmptyContext>
  | RoomEnvelope<{ readonly type: 'board.shuffle' }, LobbyContext>
  | RoomEnvelope<{ readonly type: 'room.start'; readonly boardId: string }, LobbyContext>
  | RoomEnvelope<Extract<PlayerMatchCommand, { type: 'bid.submit' }>, RoundContext>
  | RoomVariants<Extract<PlayerMatchCommand, { type: 'attempt.move' | 'attempt.undo' | 'attempt.reset' | 'attempt.giveUp' }>, AttemptContext>
  | RoomEnvelope<Extract<PlayerMatchCommand, { type: 'round.skip' }>, RoundContext>
  | RoomEnvelope<{ readonly type: 'round.continue' }, RoundContext>
  | RoomEnvelope<{ readonly type: 'match.returnToLobby' }, MatchContext>;

/** HTTP bootstrap and authenticated-room requests have different envelopes. */
export type ClientRequest = BootstrapRequest | RoomRequest;
