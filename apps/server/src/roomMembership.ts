import { parseClientRequest, parsePublicRoomState, projectLobbyState } from '@robot-puzzle/shared';
import type { BootstrapRequest, BootstrapRejectionReason, PublicRoomState } from '@robot-puzzle/shared';
import { canonicalJson } from './creations';
import type { VerifiedSession } from './sessions';
import { validateStoredMatch, type StoredMatch } from './storedMatch';

export type MembershipRequest = Extract<BootstrapRequest, { command: { type: 'room.join' | 'session.resume' } }>;
export type MembershipOutcome =
  | { readonly status: 'entered'; readonly seatId: string; readonly membership: 'joined' | 'resumed' }
  | { readonly status: 'rejected'; readonly reason: BootstrapRejectionReason };
export type MembershipResult = Extract<MembershipOutcome, { status: 'rejected' }>
  | (Extract<MembershipOutcome, { status: 'entered' }> & { readonly state: PublicRoomState });
export interface StoredRoom {
  readonly initialization: string;
  readonly members: Readonly<Record<string, string>>;
  readonly state: PublicRoomState;
  readonly match?: StoredMatch;
}

export function validateStoredRoom(value: StoredRoom): StoredRoom {
  const state = snapshot(value.state);
  validateStoredMatch(state, value.match);
  return { ...value, state };
}

export const ROOM_REPLAY_CAPACITY = 100_000;
export const SESSION_ROOM_REPLAY_CAPACITY = 10_000;

export function initializeMemberships(storage: DurableObjectStorage): void {
  storage.sql.exec(`CREATE TABLE IF NOT EXISTS membership_replays (
    session_id TEXT NOT NULL, command_id TEXT NOT NULL, request_json TEXT NOT NULL,
    outcome_json TEXT NOT NULL, processed_revision INTEGER NOT NULL,
    PRIMARY KEY (session_id, command_id)
  )`);
}

function snapshot(state: PublicRoomState): PublicRoomState {
  const parsed = state.status === 'lobby' ? projectLobbyState(state) : parsePublicRoomState(state);
  if (!parsed.ok) throw new Error('Invalid persisted room snapshot');
  return parsed.value;
}

/** Trusted session context comes from Registry, never a public command field. */
export class MembershipStore {
  constructor(
    private readonly storage: DurableObjectStorage,
    private readonly dependencies = { now: () => Date.now(), uuid: () => crypto.randomUUID() },
  ) {}

  enter(session: VerifiedSession, input: MembershipRequest): MembershipResult {
    const parsed = parseClientRequest(input);
    if (!parsed.ok || (parsed.value.command.type !== 'room.join' && parsed.value.command.type !== 'session.resume')) {
      throw new Error('Invalid internal membership request');
    }
    const request = parsed.value as MembershipRequest;
    return this.storage.transactionSync(() => {
      const now = this.dependencies.now();
      if (now < session.issuedAt || now >= session.expiresAt) return { status: 'rejected', reason: 'not-authenticated' };
      const row = this.storage.sql.exec<{ value: string }>('SELECT value FROM room_state WHERE singleton = 1').toArray()[0];
      if (!row) return { status: 'rejected', reason: 'room-not-found' };
      const saved = validateStoredRoom(JSON.parse(row.value) as StoredRoom);
      const state = saved.state;
      if (request.command.type === 'room.join' ? request.command.roomCode !== state.roomCode : request.command.roomId !== state.roomId) {
        return { status: 'rejected', reason: 'room-not-found' };
      }
      const canonical = canonicalJson(request);
      const replay = this.storage.sql.exec<{ request_json: string; outcome_json: string }>(
        'SELECT request_json, outcome_json FROM membership_replays WHERE session_id = ? AND command_id = ?',
        session.sessionId, request.commandId,
      ).toArray()[0];
      if (replay) {
        if (replay.request_json !== canonical) return { status: 'rejected', reason: 'command-id-conflict' };
        const outcome = JSON.parse(replay.outcome_json) as MembershipOutcome;
        if (outcome.status === 'rejected') return outcome;
        if (saved.members[session.sessionId] !== outcome.seatId || !state.players.some((p) => p.seatId === outcome.seatId)) {
          throw new Error('Persisted membership mismatch');
        }
        return { ...outcome, state };
      }

      const total = this.storage.sql.exec<{ count: number }>('SELECT COUNT(*) AS count FROM membership_replays').one().count;
      const owned = this.storage.sql.exec<{ count: number }>(
        'SELECT COUNT(*) AS count FROM membership_replays WHERE session_id = ?', session.sessionId,
      ).one().count;
      if (total >= ROOM_REPLAY_CAPACITY || owned >= SESSION_ROOM_REPLAY_CAPACITY) {
        return { status: 'rejected', reason: 'temporarily-unavailable' };
      }

      let nextState = state;
      let nextRoom = saved;
      let outcome: MembershipOutcome;
      const existingSeat = saved.members[session.sessionId];
      // Existing membership is checked before lock/capacity, and never renamed.
      if (existingSeat) {
        if (!state.players.some((p) => p.seatId === existingSeat)) throw new Error('Invalid persisted member');
        outcome = { status: 'entered', seatId: existingSeat, membership: 'resumed' };
      } else if (request.command.type === 'session.resume') {
        outcome = { status: 'rejected', reason: 'seat-not-found' };
      } else if (state.status !== 'lobby') {
        outcome = { status: 'rejected', reason: 'match-started' };
      } else if (state.players.length >= 6) {
        outcome = { status: 'rejected', reason: 'room-full' };
      } else {
        const seatId = this.dependencies.uuid();
        if (state.players.some((p) => p.seatId === seatId)) return { status: 'rejected', reason: 'temporarily-unavailable' };
        const projected = projectLobbyState({ ...state, revision: state.revision + 1,
          players: [...state.players, { seatId, nickname: request.command.nickname, connected: false }],
        });
        if (!projected.ok) throw new Error('Invalid joined lobby');
        nextState = projected.value;
        nextRoom = { ...saved, state: nextState, members: { ...saved.members, [session.sessionId]: seatId } };
        outcome = { status: 'entered', seatId, membership: 'joined' };
      }
      if (nextRoom !== saved) {
        this.storage.sql.exec('UPDATE room_state SET value = ? WHERE singleton = 1', JSON.stringify(nextRoom));
      }
      this.storage.sql.exec('INSERT INTO membership_replays VALUES (?, ?, ?, ?, ?)',
        session.sessionId, request.commandId, canonical, JSON.stringify(outcome), nextState.revision);
      return outcome.status === 'rejected' ? outcome : { ...outcome, state: nextState };
    });
  }
}
