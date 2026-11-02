import { parseServerMessage } from '@robot-puzzle/shared';
import type { StoredRoom } from './roomMembership';

export const TERMINAL_RETRY_MS = 5000;
export const TERMINAL_RETENTION_MS = 24 * 60 * 60 * 1000;
export interface RoomTerminal {
  readonly version: 1;
  readonly closureId: string;
  readonly roomId: string;
  readonly roomCode: string;
  readonly reason: 'host-ended' | 'expired';
  readonly closedAtMs: number;
  readonly lastRevision: number;
  readonly cleanupAtMs: number;
  readonly directorySynced: boolean;
  readonly purged: boolean;
  readonly nextRetryAtMs: number | null;
}

export function initializeRoomTerminal(storage: DurableObjectStorage): void {
  storage.sql.exec('CREATE TABLE IF NOT EXISTS room_terminal (singleton INTEGER PRIMARY KEY CHECK(singleton = 1), value TEXT NOT NULL)');
}
export function terminalRoom(storage: DurableObjectStorage): RoomTerminal | null {
  const row = storage.sql.exec<{ value: string }>('SELECT value FROM room_terminal WHERE singleton = 1').toArray()[0];
  if (!row) return null;
  const p = JSON.parse(row.value) as RoomTerminal;
  const check = parseServerMessage({ version: 2, type: 'room.closed', roomId: p.roomId,
    lastRevision: p.lastRevision, reason: p.reason, serverTimeMs: p.closedAtMs });
  if (!check.ok || Object.keys(p).sort().join(',') !== 'cleanupAtMs,closedAtMs,closureId,directorySynced,lastRevision,nextRetryAtMs,purged,reason,roomCode,roomId,version'
    || p.version !== 1 || (p.reason !== 'host-ended' && p.reason !== 'expired')
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(p.closureId)
    || !/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/.test(p.roomCode)
    || p.cleanupAtMs !== p.closedAtMs + TERMINAL_RETENTION_MS || !Number.isSafeInteger(p.cleanupAtMs)
    || typeof p.directorySynced !== 'boolean' || typeof p.purged !== 'boolean' || (p.purged && !p.directorySynced)
    || (p.nextRetryAtMs !== null && (!Number.isSafeInteger(p.nextRetryAtMs) || p.nextRetryAtMs < p.closedAtMs))) throw new Error('Invalid terminal room');
  return p;
}
export function saveTerminal(storage: DurableObjectStorage, value: RoomTerminal): void {
  storage.sql.exec('INSERT INTO room_terminal VALUES (1, ?) ON CONFLICT(singleton) DO UPDATE SET value = excluded.value', JSON.stringify(value));
}
/** Must run inside the same transaction as the closing revision and receipt. */
export function closeRoom(storage: DurableObjectStorage, room: StoredRoom, now: number, reason: RoomTerminal['reason'] = 'host-ended'): void {
  if (terminalRoom(storage)) throw new Error('Room already closed');
  saveTerminal(storage, { version: 1, closureId: crypto.randomUUID(), roomId: room.state.roomId, roomCode: room.state.roomCode,
    reason, closedAtMs: now, lastRevision: room.state.revision,
    cleanupAtMs: now + TERMINAL_RETENTION_MS, directorySynced: false, purged: false, nextRetryAtMs: now });
}

/** Deadline-first gate used inside serialized admission/mutation transactions. */
export function expireEmptyRoom(storage: DurableObjectStorage, room: StoredRoom, now: number): boolean {
  return storage.transactionSync(() => {
    if (terminalRoom(storage)) return false;
    const row = storage.sql.exec<{ empty_since: number | null; empty_expires_at: number | null }>(
      'SELECT empty_since, empty_expires_at FROM room_presence WHERE singleton = 1').toArray()[0];
    if (!row || row.empty_expires_at === null) return false;
    if (row.empty_since === null || !Number.isSafeInteger(row.empty_since) || row.empty_since < 0
      || !Number.isSafeInteger(row.empty_expires_at) || row.empty_expires_at <= row.empty_since) throw new Error('Invalid empty room deadline');
    if (now < row.empty_expires_at) return false;
    if (!Number.isSafeInteger(room.state.revision + 1)) throw new Error('Room revision exhausted');
    const ended = { ...room, state: { ...room.state, revision: room.state.revision + 1 } };
    storage.sql.exec('UPDATE room_state SET value = ? WHERE singleton = 1', JSON.stringify(ended));
    closeRoom(storage, ended, row.empty_expires_at, 'expired');
    return true;
  });
}

/** Outbox is local-first and retryable. No SQLite transaction spans a Registry RPC. */
export async function flushRoomTerminal(storage: DurableObjectStorage, env: Env, now: number): Promise<void> {
  const p = terminalRoom(storage);
  if (!p || p.purged || (p.nextRetryAtMs !== null && p.nextRetryAtMs > now)) return;
  if (p.directorySynced && now < p.cleanupAtMs) return;
  try {
    const registry = env.REGISTRY.get(env.REGISTRY.idFromName('registry-v1'));
    await registry.closeRoomDirectory(p, p.directorySynced && now >= p.cleanupAtMs);
    storage.transactionSync(() => {
      if (p.directorySynced && now >= p.cleanupAtMs) {
        // Explicitly scoped private room tables, not schema/version or other rooms.
        for (const table of ['room_state', 'membership_replays', 'socket_budgets', 'connection_leases', 'seat_presence', 'room_presence']) storage.sql.exec(`DELETE FROM ${table}`);
        saveTerminal(storage, { ...p, purged: true, nextRetryAtMs: null });
      } else saveTerminal(storage, { ...p, directorySynced: true, nextRetryAtMs: now >= p.cleanupAtMs ? now + TERMINAL_RETRY_MS : null });
    });
  } catch {
    storage.transactionSync(() => saveTerminal(storage, { ...p, nextRetryAtMs: now + TERMINAL_RETRY_MS }));
  }
}
export function terminalDue(p: RoomTerminal): number | null {
  return p.purged ? null : p.nextRetryAtMs ?? p.cleanupAtMs;
}
