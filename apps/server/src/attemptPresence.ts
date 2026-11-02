import { BIDDER_DISCONNECT_GRACE_MS, type PublicAttemptDisconnect } from '@robot-puzzle/shared';
import type { StoredRoom } from './roomMembership';

/** Room lifecycle data, deliberately outside the pure match/history model. */
export interface AttemptPresence {
  readonly version: 1;
  readonly attemptId: string;
  readonly startedAtMs: number;
  readonly disconnect: PublicAttemptDisconnect | null;
}
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export function validateAttemptPresence(room: StoredRoom): void {
  const p = room.attemptPresence;
  const m = room.state.status === 'playing' && room.state.match.phase === 'demonstrating' ? room.state.match : null;
  if (!p) {
    if (m?.disconnect !== undefined) throw new Error('Missing private attempt presence');
    return; // Retained pre-T17.4 room; normalized once on wake.
  }
  if (!m || Object.keys(p).sort().join(',') !== 'attemptId,disconnect,startedAtMs,version'
    || p.version !== 1 || p.attemptId !== m.attempt.id || !Number.isSafeInteger(p.startedAtMs) || p.startedAtMs < 0
    || !same(p.disconnect, m.disconnect) || (p.disconnect && p.disconnect.disconnectedAtMs < p.startedAtMs)) {
    throw new Error('Invalid private attempt presence');
  }
}

/** Caller persists this with the public state in its existing SQLite transaction. */
export function normalizeAttemptPresence(room: StoredRoom, nowMs: number, options: {
  readonly startedAtMs?: number; readonly offlineSinceMs?: number;
} = {}): StoredRoom {
  if (room.state.status !== 'playing' || room.state.match.phase !== 'demonstrating') {
    if (!room.attemptPresence) return room;
    const { attemptPresence: _old, ...rest } = room; return rest;
  }
  const match = room.state.match;
  const previous = room.attemptPresence?.attemptId === match.attempt.id ? room.attemptPresence : undefined;
  const startedAtMs = previous?.startedAtMs ?? options.startedAtMs ?? nowMs;
  const online = room.state.players.find((p) => p.seatId === match.bidderQueue[match.activeBidderIndex].seatId)?.connected;
  let disconnect: PublicAttemptDisconnect | null = null;
  if (!online) {
    const disconnectedAtMs = previous?.disconnect?.disconnectedAtMs
      ?? Math.max(startedAtMs, options.offlineSinceMs ?? (previous ? nowMs : startedAtMs));
    const skipAllowedAtMs = disconnectedAtMs + BIDDER_DISCONNECT_GRACE_MS;
    disconnect = { disconnectId: previous?.disconnect?.disconnectId ?? crypto.randomUUID(), disconnectedAtMs,
      skipAllowedAtMs, status: nowMs >= skipAllowedAtMs ? 'skippable' : 'grace' };
  }
  const attemptPresence: AttemptPresence = { version: 1, attemptId: match.attempt.id, startedAtMs, disconnect };
  if (same(previous, attemptPresence) && same(match.disconnect, disconnect)) return room;
  return { ...room, attemptPresence, state: { ...room.state, match: { ...match, disconnect } } };
}
