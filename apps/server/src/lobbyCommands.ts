import { puzzleCatalog } from '@robot-puzzle/puzzles';
import { parsePublicRoomState, projectLobbyState } from '@robot-puzzle/shared';
import type { PublicCommandOutcome, PublicPuzzle, RoomRequest } from '@robot-puzzle/shared';
import { canonicalJson } from './creations';
import { ROOM_REPLAY_CAPACITY, SESSION_ROOM_REPLAY_CAPACITY } from './roomMembership';
import type { StoredRoom } from './roomMembership';

export function storedRoom(storage: DurableObjectStorage): StoredRoom | null {
  const row = storage.sql.exec<{ value: string }>('SELECT value FROM room_state WHERE singleton = 1').toArray()[0];
  if (!row) return null;
  const saved = JSON.parse(row.value) as StoredRoom;
  const parsed = parsePublicRoomState(saved.state);
  if (!parsed.ok) throw new Error('Invalid persisted room');
  return { ...saved, state: parsed.value };
}
export function saveRoom(storage: DurableObjectStorage, room: StoredRoom): void {
  storage.sql.exec('UPDATE room_state SET value = ? WHERE singleton = 1', JSON.stringify(room));
}
export function initializeSocketStorage(storage: DurableObjectStorage): void {
  storage.sql.exec(`CREATE TABLE IF NOT EXISTS socket_budgets (
    session_id TEXT PRIMARY KEY, window_start INTEGER NOT NULL, count INTEGER NOT NULL
  )`);
}
export function consumeSocketBudget(storage: DurableObjectStorage, sessionId: string, now: number): boolean {
  return storage.transactionSync(() => {
    const windowStart = Math.floor(now / 60_000) * 60_000;
    const row = storage.sql.exec<{ window_start: number; count: number }>(
      'SELECT window_start, count FROM socket_budgets WHERE session_id = ?', sessionId,
    ).toArray()[0];
    const count = row?.window_start === windowStart ? row.count : 0;
    if (count >= 120) return false;
    storage.sql.exec(`INSERT INTO socket_budgets VALUES (?, ?, ?) ON CONFLICT(session_id)
      DO UPDATE SET window_start = excluded.window_start, count = excluded.count`, sessionId, windowStart, count + 1);
    return true;
  });
}

function anotherPuzzle(current: string): PublicPuzzle {
  const available = puzzleCatalog.filter((p) => p.id !== current);
  if (!available.length) throw new Error('No alternate catalog board');
  const ceiling = Math.floor(0x1_0000_0000 / available.length) * available.length;
  let random: number;
  do { random = crypto.getRandomValues(new Uint32Array(1))[0]; } while (random >= ceiling);
  return available[random % available.length];
}

export interface LobbyCommandResult {
  readonly outcome: PublicCommandOutcome;
  readonly processedRevision: number;
  readonly duplicate: boolean;
  readonly changed: boolean;
}
/** Uses the membership ledger's SAME session/room command namespace and caps. */
export function executeLobbyCommand(
  storage: DurableObjectStorage, sessionId: string, seatId: string,
  input: RoomRequest, choosePuzzle = anotherPuzzle,
): LobbyCommandResult | null {
  return storage.transactionSync(() => {
    const saved = storedRoom(storage);
    if (!saved || saved.members[sessionId] !== seatId) throw new Error('Unknown bound member');
    const state = saved.state;
    const canonical = canonicalJson(input);
    const replay = storage.sql.exec<{ request_json: string; outcome_json: string; processed_revision: number }>(
      'SELECT request_json, outcome_json, processed_revision FROM membership_replays WHERE session_id = ? AND command_id = ?',
      sessionId, input.commandId,
    ).toArray()[0];
    if (replay) {
      if (canonical !== replay.request_json) return { outcome: { status: 'rejected', reason: 'command-id-conflict' },
        processedRevision: state.revision, duplicate: false, changed: false };
      return { outcome: JSON.parse(replay.outcome_json) as PublicCommandOutcome,
        processedRevision: replay.processed_revision, duplicate: true, changed: false };
    }
    const total = storage.sql.exec<{ count: number }>('SELECT COUNT(*) AS count FROM membership_replays').one().count;
    const owned = storage.sql.exec<{ count: number }>(
      'SELECT COUNT(*) AS count FROM membership_replays WHERE session_id = ?', sessionId,
    ).one().count;
    if (total >= ROOM_REPLAY_CAPACITY || owned >= SESSION_ROOM_REPLAY_CAPACITY) return null;
    let outcome: PublicCommandOutcome;
    let nextState = state;
    if (input.command.type === 'state.request') outcome = { status: 'no-op', reason: 'snapshot-requested' };
    else if (input.command.type !== 'board.shuffle') throw new Error('Unimplemented lobby command');
    else if (state.status !== 'lobby') outcome = { status: 'rejected', reason: 'wrong-phase' };
    else if (!('lobbyId' in input.context) || input.context.lobbyId !== state.lobbyId) outcome = { status: 'rejected', reason: 'stale-context' };
    else if (seatId !== state.hostSeatId) outcome = { status: 'rejected', reason: 'not-host' };
    else {
      const puzzle = choosePuzzle(state.puzzle.id);
      if (puzzle.id === state.puzzle.id) throw new Error('Shuffle must select a different board');
      const projected = projectLobbyState({ ...state, revision: state.revision + 1, puzzle });
      if (!projected.ok) throw new Error('Invalid shuffled lobby');
      nextState = projected.value;
      outcome = { status: 'accepted' };
    }
    if (nextState !== state) saveRoom(storage, { ...saved, state: nextState });
    storage.sql.exec('INSERT INTO membership_replays VALUES (?, ?, ?, ?, ?)',
      sessionId, input.commandId, canonical, JSON.stringify(outcome), nextState.revision);
    return { outcome, processedRevision: nextState.revision, duplicate: false, changed: nextState !== state };
  });
}
