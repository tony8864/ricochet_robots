import { puzzleCatalog } from '@robot-puzzle/puzzles';
import { consumeBootstrapBudget } from './bootstrapBudget';
import type { BootstrapRequest, BootstrapRejectionReason, PublicPuzzle, PublicRoomState } from '@robot-puzzle/shared';
import type { RoomTerminal } from './roomTerminal';

export type CreateRequest = Extract<BootstrapRequest, { command: { type: 'room.create' } }>;
export interface RoomInitialization {
  readonly sessionId: string;
  readonly commandId: string;
  readonly roomId: string;
  readonly roomCode: string;
  readonly lobbyId: string;
  readonly hostSeatId: string;
  readonly nickname: string;
  readonly puzzle: PublicPuzzle;
}
export interface CreationRecord {
  readonly initialization: RoomInitialization;
  readonly status: 'pending' | 'published';
}
export type CreationResult =
  | { readonly status: 'created'; readonly seatId: string; readonly state: PublicRoomState }
  | { readonly status: 'rejected'; readonly reason: BootstrapRejectionReason };
type ReservationResult = CreationRecord | Extract<CreationResult, { status: 'rejected' }>;

export const CREATION_CAPACITY = 1000;
export const CREATIONS_PER_SESSION = 20;
export const CODE_ATTEMPTS = 8;
export const RECOVERY_BATCH_SIZE = 10;
export const RECOVERY_DELAY_MS = 60_000;

interface CreationDependencies {
  readonly now: () => number;
  readonly uuid: () => string;
  readonly code: () => string;
  readonly puzzle: () => PublicPuzzle;
}

function randomIndex(length: number): number {
  const ceiling = Math.floor(0x1_0000_0000 / length) * length;
  let value: number;
  do { value = crypto.getRandomValues(new Uint32Array(1))[0]; } while (value >= ceiling);
  return value % length;
}
function roomCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 6 }, () => alphabet[randomIndex(alphabet.length)]).join('');
}

/** Deterministic comparison of JSON data, including persisted initialization. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) =>
    `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`).join(',')}}`;
}

export function initializeCreations(storage: DurableObjectStorage): void {
  storage.sql.exec(`CREATE TABLE IF NOT EXISTS closed_room_codes (
    room_id TEXT PRIMARY KEY, room_code TEXT NOT NULL UNIQUE, closure_id TEXT NOT NULL,
    closed_at INTEGER NOT NULL, revision INTEGER NOT NULL,
    reason TEXT NOT NULL DEFAULT 'host-ended' CHECK(reason IN ('host-ended', 'expired'))
  )`);
  if (!storage.sql.exec<{ name: string }>('PRAGMA table_info(closed_room_codes)').toArray().some((column) => column.name === 'reason')) {
    storage.sql.exec("ALTER TABLE closed_room_codes ADD COLUMN reason TEXT NOT NULL DEFAULT 'host-ended' CHECK(reason IN ('host-ended', 'expired'))");
  }
  storage.sql.exec(`CREATE TABLE IF NOT EXISTS room_creations (
    session_id TEXT NOT NULL,
    command_id TEXT NOT NULL,
    request_json TEXT NOT NULL,
    room_id TEXT NOT NULL UNIQUE,
    room_code TEXT NOT NULL UNIQUE,
    initialization_json TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('pending', 'published')),
    next_retry_at INTEGER NOT NULL,
    PRIMARY KEY (session_id, command_id)
  )`);
  storage.sql.exec('CREATE INDEX IF NOT EXISTS pending_creations ON room_creations (status, next_retry_at)');
  storage.sql.exec(`CREATE TABLE IF NOT EXISTS bootstrap_budgets (
    session_id TEXT PRIMARY KEY,
    window_start INTEGER NOT NULL,
    total_count INTEGER NOT NULL,
    create_count INTEGER NOT NULL
  )`);
}

type CreationRow = { initialization_json: string; status: 'pending' | 'published'; request_json: string };
const record = (row: CreationRow): CreationRecord => ({
  initialization: JSON.parse(row.initialization_json) as RoomInitialization, status: row.status,
});

/** All mutations here are object-local, synchronous SQLite transactions. */
export class CreationStore {
  constructor(
    private readonly storage: DurableObjectStorage,
    private readonly dependencies: CreationDependencies = {
      now: () => Date.now(), uuid: () => crypto.randomUUID(), code: roomCode,
      puzzle: () => puzzleCatalog[randomIndex(puzzleCatalog.length)],
    },
  ) {}

  reserve(sessionId: string, expiresAt: number, input: CreateRequest): ReservationResult {
    return this.storage.transactionSync(() => {
      const now = this.dependencies.now();
      if (now >= expiresAt) return { status: 'rejected', reason: 'not-authenticated' };
      if (!consumeBootstrapBudget(this.storage, sessionId, true, now)) return { status: 'rejected', reason: 'rate-limited' };

      const canonical = canonicalJson(input);
      const existing = this.storage.sql.exec<CreationRow>(
        'SELECT request_json, initialization_json, status FROM room_creations WHERE session_id = ? AND command_id = ?',
        sessionId, input.commandId,
      ).toArray()[0];
      if (existing) {
        if (existing.request_json !== canonical) return { status: 'rejected', reason: 'command-id-conflict' };
        const saved = record(existing);
        const destination = this.lookupRoom(saved.initialization.roomId);
        return destination?.status === 'closed' || destination?.status === 'expired'
          ? { status: 'rejected', reason: destination.status === 'expired' ? 'room-expired' : 'room-closed' } : saved;
      }
      const all = this.storage.sql.exec<{ count: number }>(`SELECT (SELECT COUNT(*) FROM room_creations) +
        (SELECT COUNT(*) FROM closed_room_codes c WHERE NOT EXISTS (SELECT 1 FROM room_creations r WHERE r.room_id = c.room_id)) AS count`).one().count;
      const owned = this.storage.sql.exec<{ count: number }>(
        'SELECT COUNT(*) AS count FROM room_creations WHERE session_id = ?', sessionId,
      ).one().count;
      if (all >= CREATION_CAPACITY || owned >= CREATIONS_PER_SESSION) {
        return { status: 'rejected', reason: 'temporarily-unavailable' };
      }

      for (let attempt = 0; attempt < CODE_ATTEMPTS; attempt++) {
        const code = this.dependencies.code();
        const id = this.dependencies.uuid();
        if (!/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/.test(code)) throw new Error('Invalid server code source');
        if (this.storage.sql.exec('SELECT 1 FROM room_creations WHERE room_code = ? OR room_id = ?', code, id).toArray().length) continue;
        if (this.storage.sql.exec('SELECT 1 FROM closed_room_codes WHERE room_code = ? OR room_id = ?', code, id).toArray().length) continue;
        const initialization: RoomInitialization = {
          sessionId, commandId: input.commandId, roomId: id, roomCode: code,
          lobbyId: this.dependencies.uuid(), hostSeatId: this.dependencies.uuid(),
          nickname: input.command.nickname, puzzle: this.dependencies.puzzle(),
        };
        this.storage.sql.exec(`INSERT INTO room_creations
          (session_id, command_id, request_json, room_id, room_code, initialization_json, status, next_retry_at)
          VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)`, sessionId, input.commandId, canonical,
        id, code, canonicalJson(initialization), now + RECOVERY_DELAY_MS);
        return { initialization, status: 'pending' };
      }
      return { status: 'rejected', reason: 'temporarily-unavailable' };
    });
  }

  publish(initialization: RoomInitialization): void {
    this.storage.transactionSync(() => {
      const destination = this.lookupRoom(initialization.roomId);
      if (destination?.status === 'closed' || destination?.status === 'expired') throw new Error('Room is closed');
      const row = this.storage.sql.exec<{ initialization_json: string }>(
        'SELECT initialization_json FROM room_creations WHERE session_id = ? AND command_id = ?',
        initialization.sessionId, initialization.commandId,
      ).toArray()[0];
      if (!row || row.initialization_json !== canonicalJson(initialization)) throw new Error('Creation record mismatch');
      this.storage.sql.exec("UPDATE room_creations SET status = 'published' WHERE session_id = ? AND command_id = ?",
        initialization.sessionId, initialization.commandId);
    });
  }

  lookup(code: string): { status: 'closed' } | { status: 'expired' } | { status: 'pending' } | { status: 'published'; roomId: string } | null {
    const terminal = this.storage.sql.exec<{ reason: string }>('SELECT reason FROM closed_room_codes WHERE room_code = ?', code).toArray()[0];
    if (terminal) {
      if (terminal.reason !== 'host-ended' && terminal.reason !== 'expired') throw new Error('Invalid directory tombstone');
      return terminal.reason === 'expired' ? { status: 'expired' } : { status: 'closed' };
    }
    const row = this.storage.sql.exec<{ status: 'pending' | 'published'; room_id: string }>(
      'SELECT status, room_id FROM room_creations WHERE room_code = ?', code,
    ).toArray()[0];
    return row ? row.status === 'pending' ? { status: 'pending' } : { status: 'published', roomId: row.room_id } : null;
  }

  lookupRoom(roomId: string): { status: 'closed' } | { status: 'expired' } | { status: 'pending' } | { status: 'published'; roomId: string } | null {
    const terminal = this.storage.sql.exec<{ reason: string }>('SELECT reason FROM closed_room_codes WHERE room_id = ?', roomId).toArray()[0];
    if (terminal) {
      if (terminal.reason !== 'host-ended' && terminal.reason !== 'expired') throw new Error('Invalid directory tombstone');
      return terminal.reason === 'expired' ? { status: 'expired' } : { status: 'closed' };
    }
    const row = this.storage.sql.exec<{ status: 'pending' | 'published'; room_id: string }>(
      'SELECT status, room_id FROM room_creations WHERE room_id = ?', roomId,
    ).toArray()[0];
    return row ? row.status === 'pending' ? { status: 'pending' } : { status: 'published', roomId: row.room_id } : null;
  }

  pending(): readonly CreationRecord[] {
    return this.storage.sql.exec<CreationRow>(`SELECT request_json, initialization_json, status
      FROM room_creations WHERE status = 'pending' AND next_retry_at <= ? AND NOT EXISTS (SELECT 1 FROM closed_room_codes c WHERE c.room_id = room_creations.room_id)
      ORDER BY next_retry_at, room_id LIMIT ?`, this.dependencies.now(), RECOVERY_BATCH_SIZE).toArray().map(record);
  }

  defer(initialization: RoomInitialization): void {
    this.storage.sql.exec(`UPDATE room_creations SET next_retry_at = ?
      WHERE session_id = ? AND command_id = ? AND status = 'pending'`,
    this.dependencies.now() + RECOVERY_DELAY_MS, initialization.sessionId, initialization.commandId);
  }

  nextRecoveryAt(): number | null {
    return this.storage.sql.exec<{ due: number | null }>(
      "SELECT MIN(next_retry_at) AS due FROM room_creations WHERE status = 'pending' AND NOT EXISTS (SELECT 1 FROM closed_room_codes c WHERE c.room_id = room_creations.room_id)",
    ).one().due;
  }

  closeDirectory(p: RoomTerminal, redact: boolean): void {
    this.storage.transactionSync(() => {
      const previous = this.storage.sql.exec<{ room_code: string; closure_id: string; closed_at: number; revision: number; reason: string }>('SELECT * FROM closed_room_codes WHERE room_id = ?', p.roomId).toArray()[0];
      const creation = this.storage.sql.exec<{ room_code: string }>('SELECT room_code FROM room_creations WHERE room_id = ?', p.roomId).toArray()[0];
      if ((!previous && creation?.room_code !== p.roomCode) || (previous && (previous.room_code !== p.roomCode || previous.closure_id !== p.closureId || previous.closed_at !== p.closedAtMs || previous.revision !== p.lastRevision || previous.reason !== p.reason))) throw new Error('Closure directory mismatch');
      this.storage.sql.exec('INSERT OR IGNORE INTO closed_room_codes (room_id, room_code, closure_id, closed_at, revision, reason) VALUES (?, ?, ?, ?, ?, ?)', p.roomId, p.roomCode, p.closureId, p.closedAtMs, p.lastRevision, p.reason);
      if (redact) {
        if (this.dependencies.now() < p.closedAtMs + 86400000) throw new Error('Retention is active');
        this.storage.sql.exec('DELETE FROM room_creations WHERE room_id = ?', p.roomId);
      }
    });
  }
}

/** Does not hold a database transaction across a Room RPC. */
export class CreationCoordinator {
  constructor(
    private readonly store: CreationStore,
    private readonly initialize: (input: RoomInitialization) => Promise<PublicRoomState>,
  ) {}

  async complete(reservation: CreationRecord): Promise<Extract<CreationResult, { status: 'created' }>> {
    const input = reservation.initialization;
    const state = await this.initialize(input);
    if (state.roomId !== input.roomId || state.roomCode !== input.roomCode
      || !state.players.some((player) => player.seatId === input.hostSeatId)) throw new Error('Invalid initialized room');
    this.store.publish(input);
    return { status: 'created', seatId: input.hostSeatId, state };
  }
}
