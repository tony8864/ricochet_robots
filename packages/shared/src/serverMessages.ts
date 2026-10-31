import type { ClientRequestError } from './clientRequests';
import { PROTOCOL_VERSION } from './clientRequests';
import type { PublicRoomState } from './publicState';

export const PUBLIC_NO_OP_REASONS = ['same-bid', 'blocked-move', 'empty-undo', 'already-reset', 'snapshot-requested'] as const;
export const PUBLIC_REJECTION_REASONS = [
  'wrong-phase', 'not-host', 'not-active-bidder', 'confirmation-required', 'invalid-bid',
  'bid-increase', 'bidding-closed', 'bid-limit', 'match-finished', 'stale-context',
  'not-enough-players', 'preview-changed', 'command-id-conflict', 'preparation-cooldown',
] as const;
export const BOOTSTRAP_REJECTION_REASONS = [
  'not-authenticated', 'room-not-found', 'room-full', 'match-started', 'seat-not-found',
  'command-id-conflict', 'rate-limited', 'temporarily-unavailable',
] as const;
export const PROTOCOL_ERROR_REASONS = ['invalid-json', 'invalid-message', 'unsupported-version', 'message-too-large'] as const;
export type PublicNoOpReason = (typeof PUBLIC_NO_OP_REASONS)[number];
export type PublicRejectionReason = (typeof PUBLIC_REJECTION_REASONS)[number];
export type BootstrapRejectionReason = (typeof BOOTSTRAP_REJECTION_REASONS)[number];
export type ProtocolErrorReason = (typeof PROTOCOL_ERROR_REASONS)[number];
export type PublicCommandOutcome =
  | { readonly status: 'accepted' }
  | { readonly status: 'no-op'; readonly reason: PublicNoOpReason }
  | { readonly status: 'rejected'; readonly reason: PublicRejectionReason };

interface Envelope {
  readonly version: typeof PROTOCOL_VERSION;
  /** Send-time metadata, never a client authorization clock. */
  readonly serverTimeMs: number;
}
export interface SessionReadyMessage extends Envelope {
  readonly type: 'session.ready';
  readonly commandId: string;
}
export interface RoomEnteredMessage extends Envelope {
  readonly type: 'room.entered';
  readonly commandId: string;
  readonly roomId: string;
  readonly seatId: string;
  readonly membership: 'created' | 'joined' | 'resumed';
  readonly state: PublicRoomState;
}
export interface SessionBoundMessage extends Envelope {
  readonly type: 'session.bound';
  readonly roomId: string;
  readonly seatId: string;
  readonly state: PublicRoomState;
}
export interface RoomSnapshotMessage extends Envelope {
  readonly type: 'room.snapshot';
  readonly state: PublicRoomState;
}
export interface CommandResultMessage extends Envelope {
  readonly type: 'command.result';
  readonly roomId: string;
  readonly commandId: string;
  readonly outcome: PublicCommandOutcome;
  /** Revision after original processing, retained on an exact retry. */
  readonly processedRevision: number;
  /** Latest revision at response time, including independent transitions. */
  readonly currentRevision: number;
  readonly duplicate: boolean;
}
export interface RequestRejectedMessage extends Envelope {
  readonly type: 'request.rejected';
  readonly commandId: string;
  readonly reason: BootstrapRejectionReason;
}
export interface ProtocolErrorMessage extends Envelope {
  readonly type: 'protocol.error';
  readonly commandId: string | null;
  readonly reason: ProtocolErrorReason;
}
export interface RoomClosedMessage extends Envelope {
  readonly type: 'room.closed';
  readonly roomId: string;
  readonly lastRevision: number;
  readonly reason: 'expired' | 'unavailable';
}

/** Only these variants may be broadcast to the room. No recipient identity. */
export type PublicServerMessage = RoomSnapshotMessage | RoomClosedMessage;
/** Authentication/membership bindings and request-specific results are unicast. */
export type PrivateServerMessage = SessionReadyMessage | RoomEnteredMessage | SessionBoundMessage
  | CommandResultMessage | RequestRejectedMessage | ProtocolErrorMessage;
export type ServerMessage = PublicServerMessage | PrivateServerMessage;
export type ServerMessageParseResult<Message extends ServerMessage = ServerMessage> =
  | { readonly ok: true; readonly value: Message }
  | { readonly ok: false; readonly error: ClientRequestError };
