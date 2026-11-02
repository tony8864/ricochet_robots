import { CONNECTION_LEASE_MS, parsePublicRoomState } from '@robot-puzzle/shared';
import { saveRoom, storedRoom } from './lobbyCommands';
import { normalizeAttemptPresence } from './attemptPresence';
import { expireEmptyRoom, terminalRoom } from './roomTerminal';
import { EMPTY_ROOM_TIMEOUT_MS } from './emptyRoomPolicy';

export type ConnectionLease = {
  connection_id: string; session_id: string; seat_id: string;
  issued_at: number; identity_expires_at: number; last_seen: number;
  deadline: number; sequence: number;
}

/** Private, versioned transport state. Match persistence and rules are untouched. */
export class PresenceStore {
  constructor(private readonly storage: DurableObjectStorage, private readonly emptyTimeoutMs = EMPTY_ROOM_TIMEOUT_MS) {}
  initialize(): void {
    this.storage.transactionSync(() => {
      this.storage.sql.exec(`CREATE TABLE IF NOT EXISTS presence_metadata (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1), version INTEGER NOT NULL
      )`);
      this.storage.sql.exec('INSERT OR IGNORE INTO presence_metadata VALUES (1, 1)');
      if (![1, 2].includes(this.storage.sql.exec<{ version: number }>('SELECT version FROM presence_metadata').one().version)) throw new Error('Unsupported presence schema');
      this.storage.sql.exec(`CREATE TABLE IF NOT EXISTS connection_leases (
        connection_id TEXT PRIMARY KEY, session_id TEXT NOT NULL, seat_id TEXT NOT NULL,
        issued_at INTEGER NOT NULL, identity_expires_at INTEGER NOT NULL,
        last_seen INTEGER NOT NULL, deadline INTEGER NOT NULL, sequence INTEGER NOT NULL
      )`);
      this.storage.sql.exec(`CREATE TABLE IF NOT EXISTS seat_presence (
        seat_id TEXT PRIMARY KEY, offline_since INTEGER
      )`);
      this.storage.sql.exec(`CREATE TABLE IF NOT EXISTS room_presence (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1), empty_since INTEGER
      )`);
      if (!this.storage.sql.exec<{ name: string }>('PRAGMA table_info(room_presence)').toArray().some((column) => column.name === 'empty_expires_at')) {
        this.storage.sql.exec('ALTER TABLE room_presence ADD COLUMN empty_expires_at INTEGER');
      }
      this.storage.sql.exec('UPDATE presence_metadata SET version = 2');
    });
  }
  read(id: string): ConnectionLease | undefined {
    const row = this.storage.sql.exec<ConnectionLease>('SELECT * FROM connection_leases WHERE connection_id = ?', id).toArray()[0];
    if (row && (![row.issued_at, row.identity_expires_at, row.last_seen, row.deadline, row.sequence].every((v) => Number.isSafeInteger(v) && v >= 0)
      || row.last_seen < row.issued_at || row.deadline !== row.last_seen + CONNECTION_LEASE_MS
      || row.identity_expires_at <= row.issued_at)) throw new Error('Invalid persisted connection lease');
    return row;
  }
  add(id: string, sessionId: string, seatId: string, issuedAt: number, expiresAt: number, now: number): boolean {
    if (now < issuedAt || now >= expiresAt) throw new Error('Expired binding');
    return this.storage.transactionSync(() => {
      if (terminalRoom(this.storage)) return false;
      const room = storedRoom(this.storage);
      if (room && expireEmptyRoom(this.storage, room, now)) return false;
      this.storage.sql.exec('INSERT INTO connection_leases VALUES (?, ?, ?, ?, ?, ?, ?, 0)',
        id, sessionId, seatId, issuedAt, expiresAt, now, now + CONNECTION_LEASE_MS);
      // An accepted authenticated binding, not HTTP lookup or outbound traffic.
      this.storage.sql.exec('UPDATE room_presence SET empty_since = NULL, empty_expires_at = NULL WHERE singleton = 1');
      return true;
    });
  }
  live(id: string, now: number): ConnectionLease | undefined {
    const row = this.read(id);
    return row && now >= row.last_seen && now < Math.min(row.deadline, row.identity_expires_at) ? row : undefined;
  }
  renew(id: string, now: number, sequence?: number): boolean {
    return this.storage.transactionSync(() => {
      if (terminalRoom(this.storage)) return false;
      const row = this.live(id, now);
      if (!row || (sequence !== undefined && sequence <= row.sequence)) return false;
      this.storage.sql.exec('UPDATE connection_leases SET last_seen = ?, deadline = ?, sequence = ? WHERE connection_id = ?',
        now, now + CONNECTION_LEASE_MS, sequence ?? row.sequence, id);
      return true;
    });
  }
  nextDeadline(): number | undefined {
    return this.storage.sql.exec<{ due: number | null }>('SELECT MIN(MIN(deadline, identity_expires_at)) AS due FROM connection_leases').one().due ?? undefined;
  }
  nextEmptyDeadline(): number | undefined {
    const row = this.storage.sql.exec<{ empty_since: number | null; empty_expires_at: number | null }>('SELECT empty_since, empty_expires_at FROM room_presence WHERE singleton = 1').toArray()[0];
    if (!row || row.empty_expires_at === null) return undefined;
    if (row.empty_since === null || !Number.isSafeInteger(row.empty_since) || row.empty_since < 0
      || !Number.isSafeInteger(row.empty_expires_at) || row.empty_expires_at <= row.empty_since) throw new Error('Invalid empty room deadline');
    return row.empty_expires_at;
  }
  /** Normalize against verified current attachments, preserving effective expiry times. */
  reconcile(connectionIds: ReadonlySet<string>, now: number): boolean {
    return this.storage.transactionSync(() => {
      if (terminalRoom(this.storage)) return false;
      const saved = storedRoom(this.storage);
      if (!saved) return false;
      const online = new Set<string>();
      const ended = new Map<string, number>();
      for (const item of this.storage.sql.exec<ConnectionLease>('SELECT * FROM connection_leases').toArray()) {
        const row = this.read(item.connection_id)!;
        if (connectionIds.has(row.connection_id) && this.live(row.connection_id, now)) online.add(row.seat_id);
        else {
          ended.set(row.seat_id, Math.max(ended.get(row.seat_id) ?? 0, Math.min(now, row.deadline, row.identity_expires_at)));
          this.storage.sql.exec('DELETE FROM connection_leases WHERE connection_id = ?', row.connection_id);
        }
      }
      const offlineTimes: number[] = [];
      for (const player of saved.state.players) {
        const previous = this.storage.sql.exec<{ offline_since: number | null }>('SELECT offline_since FROM seat_presence WHERE seat_id = ?', player.seatId).toArray()[0];
        const since = online.has(player.seatId) ? null : previous?.offline_since ?? ended.get(player.seatId) ?? now;
        if (since !== null) offlineTimes.push(since);
        if (!previous || previous.offline_since !== since) this.storage.sql.exec(`INSERT INTO seat_presence VALUES (?, ?) ON CONFLICT(seat_id)
          DO UPDATE SET offline_since = excluded.offline_since`, player.seatId, since);
      }
      const previous = this.storage.sql.exec<{ empty_since: number | null; empty_expires_at: number | null }>('SELECT empty_since, empty_expires_at FROM room_presence WHERE singleton = 1').toArray()[0];
      if (previous?.empty_since != null && (!Number.isSafeInteger(previous.empty_since) || previous.empty_since < 0)) throw new Error('Invalid empty room timestamp');
      if (previous?.empty_expires_at != null && (previous.empty_since == null || !Number.isSafeInteger(previous.empty_expires_at)
        || previous.empty_expires_at <= previous.empty_since)) throw new Error('Invalid empty room deadline');
      const emptySince = online.size ? null : previous?.empty_since ?? Math.max(...offlineTimes);
      const deadline = emptySince === null ? null : previous?.empty_since === emptySince && previous.empty_expires_at != null
        ? previous.empty_expires_at : emptySince + this.emptyTimeoutMs;
      if (!previous || previous.empty_since !== emptySince || previous.empty_expires_at !== deadline) this.storage.sql.exec(`INSERT INTO room_presence (singleton, empty_since, empty_expires_at) VALUES (1, ?, ?) ON CONFLICT(singleton)
          DO UPDATE SET empty_since = excluded.empty_since, empty_expires_at = excluded.empty_expires_at`, emptySince, deadline);
      const players = saved.state.players.map((p) => ({ ...p, connected: online.has(p.seatId) }));
      const candidate = { ...saved, state: { ...saved.state, players } };
      if (expireEmptyRoom(this.storage, candidate, now)) return true;
      const match = saved.state.status === 'playing' && saved.state.match.phase === 'demonstrating' ? saved.state.match : null;
      const activeSeat = match?.bidderQueue[match.activeBidderIndex].seatId;
      const offlineSince = activeSeat ? this.storage.sql.exec<{ offline_since: number | null }>('SELECT offline_since FROM seat_presence WHERE seat_id = ?', activeSeat).toArray()[0]?.offline_since : undefined;
      const normalized = normalizeAttemptPresence(candidate, now,
        { ...(offlineSince != null ? { offlineSinceMs: offlineSince } : {}) });
      if (normalized.state === candidate.state && !players.some((p, i) => p.connected !== saved.state.players[i].connected)) return false;
      const parsed = parsePublicRoomState({ ...normalized.state, revision: saved.state.revision + 1 });
      if (!parsed.ok) throw new Error('Invalid presence snapshot');
      saveRoom(this.storage, { ...normalized, state: parsed.value });
      return true;
    });
  }
}
