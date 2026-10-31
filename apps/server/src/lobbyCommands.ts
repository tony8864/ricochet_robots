import { puzzleCatalog } from '@robot-puzzle/puzzles';
import { createMatch, transitionMatch } from '@robot-puzzle/match';
import { projectLobbyState } from '@robot-puzzle/shared';
import type { PublicCommandOutcome, PublicPuzzle, RoomRequest } from '@robot-puzzle/shared';
import { canonicalJson } from './creations';
import { ROOM_REPLAY_CAPACITY, SESSION_ROOM_REPLAY_CAPACITY, validateStoredRoom } from './roomMembership';
import type { StoredRoom } from './roomMembership';
import { createPreparationJob } from './preparationJob';
import { advanceStoredBidding, withBiddingState, projectStoredMatch, type StoredMatch } from './storedMatch';

export function storedRoom(storage: DurableObjectStorage): StoredRoom | null {
  const row = storage.sql.exec<{ value: string }>('SELECT value FROM room_state WHERE singleton = 1').toArray()[0];
  if (!row) return null;
  return validateStoredRoom(JSON.parse(row.value) as StoredRoom);
}
export function saveRoom(storage: DurableObjectStorage, room: StoredRoom): void {
  storage.sql.exec('UPDATE room_state SET value = ? WHERE singleton = 1', JSON.stringify(validateStoredRoom(room)));
}
export function expireBidding(storage: DurableObjectStorage, nowMs: number): boolean {
  return storage.transactionSync(() => {
    const room = storedRoom(storage);
    if (!room) return false;
    const next = advanceStoredBidding(room, nowMs);
    if (next === room) return false;
    saveRoom(storage, next);
    return true;
  });
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
  input: RoomRequest, choosePuzzle = anotherPuzzle, matchId: () => string = () => crypto.randomUUID(),
  now: () => number = () => Date.now(),
): LobbyCommandResult | null {
  return storage.transactionSync(() => {
    const before = storedRoom(storage);
    if (!before || before.members[sessionId] !== seatId) throw new Error('Unknown bound member');
    const nowMs = now();
    const saved = advanceStoredBidding(before, nowMs);
    if (saved !== before) saveRoom(storage, saved);
    const state = saved.state;
    const canonical = canonicalJson(input);
    const replay = storage.sql.exec<{ request_json: string; outcome_json: string; processed_revision: number }>(
      'SELECT request_json, outcome_json, processed_revision FROM membership_replays WHERE session_id = ? AND command_id = ?',
      sessionId, input.commandId,
    ).toArray()[0];
    if (replay) {
      if (canonical !== replay.request_json) return { outcome: { status: 'rejected', reason: 'command-id-conflict' },
        processedRevision: state.revision, duplicate: false, changed: saved !== before };
      return { outcome: JSON.parse(replay.outcome_json) as PublicCommandOutcome,
        processedRevision: replay.processed_revision, duplicate: true, changed: saved !== before };
    }
    const total = storage.sql.exec<{ count: number }>('SELECT COUNT(*) AS count FROM membership_replays').one().count;
    const owned = storage.sql.exec<{ count: number }>(
      'SELECT COUNT(*) AS count FROM membership_replays WHERE session_id = ?', sessionId,
    ).one().count;
    if (total >= ROOM_REPLAY_CAPACITY || owned >= SESSION_ROOM_REPLAY_CAPACITY) return null;
    let outcome: PublicCommandOutcome;
    let nextState = state;
    let nextRoom = saved;
    if (input.command.type === 'state.request') outcome = { status: 'no-op', reason: 'snapshot-requested' };
    else if (input.command.type === 'bid.submit') {
      const match = saved.match;
      if (!match || state.status !== 'playing' || match.state.phase === 'preparing') outcome = { status: 'rejected', reason: 'wrong-phase' };
      else if (!('roundNumber' in input.context) || input.context.matchId !== match.state.matchId ||
        !('round' in match.state) || input.context.roundNumber !== match.state.round.number) outcome = { status: 'rejected', reason: 'stale-context' };
      else {
        const next = transitionMatch(match.state, { source: 'player',
          context: { actorSeatId: seatId, hostSeatId: state.hostSeatId, nowMs }, command: input.command });
        if (next.outcome.status === 'accepted') outcome = { status: 'accepted' };
        else if (next.outcome.status === 'no-op') outcome = { status: 'no-op', reason: 'same-bid' };
        else outcome = { status: 'rejected', reason: next.outcome.reason === 'bid-increase' ? 'bid-increase'
          : next.outcome.reason === 'bidding-closed' ? 'bidding-closed' : next.outcome.reason === 'wrong-phase' ? 'wrong-phase' : 'invalid-bid' };
        if (next.state !== match.state && (next.state.phase === 'bidding' || next.state.phase === 'demonstrating')) {
          nextRoom = withBiddingState(saved, next.state);
          nextState = nextRoom.state;
        }
      }
    }
    else if (input.command.type === 'preparation.retry') {
      const match = saved.match;
      if (state.status !== 'playing' || match?.version !== 2 || match.state.phase !== 'preparing' || !match.job) {
        outcome = { status: 'rejected', reason: 'wrong-phase' };
      } else if (!('preparationId' in input.context) || input.context.matchId !== match.state.matchId || input.context.preparationId !== match.job.id) {
        outcome = { status: 'rejected', reason: 'stale-context' };
      } else if (seatId !== state.hostSeatId) outcome = { status: 'rejected', reason: 'not-host' };
      else if (match.job.status !== 'deferred' && match.job.status !== 'error') outcome = { status: 'rejected', reason: 'wrong-phase' };
      else if (nowMs < match.job.retryAtMs) outcome = { status: 'rejected', reason: 'preparation-cooldown' };
      else {
        const preparing = { ...match.state, preparation: { status: 'not-attempted' as const } };
        const next: StoredMatch = { version: 2, state: preparing, job: createPreparationJob(preparing, nowMs) };
        nextState = projectStoredMatch({ ...state, revision: state.revision + 1 }, next);
        nextRoom = { ...saved, match: next };
        outcome = { status: 'accepted' };
      }
    }
    else if (input.command.type !== 'board.shuffle' && input.command.type !== 'room.start') throw new Error('Unimplemented room command');
    else if (state.status !== 'lobby') outcome = { status: 'rejected', reason: 'wrong-phase' };
    else if (!('lobbyId' in input.context) || input.context.lobbyId !== state.lobbyId) outcome = { status: 'rejected', reason: 'stale-context' };
    else if (seatId !== state.hostSeatId) outcome = { status: 'rejected', reason: 'not-host' };
    else if (input.command.type === 'room.start' && input.command.boardId !== state.puzzle.id) {
      outcome = { status: 'rejected', reason: 'preview-changed' };
    } else if (input.command.type === 'room.start' && state.players.length < 2) {
      outcome = { status: 'rejected', reason: 'not-enough-players' };
    } else if (input.command.type === 'room.start') {
      const match = createMatch({ matchId: matchId(), players: state.players, puzzle: state.puzzle });
      const stored: StoredMatch = { version: 2, state: match, job: createPreparationJob(match, nowMs) };
      nextState = projectStoredMatch({ ...state, revision: state.revision + 1 }, stored);
      nextRoom = { ...saved, match: stored };
      outcome = { status: 'accepted' };
    } else {
      const puzzle = choosePuzzle(state.puzzle.id);
      if (puzzle.id === state.puzzle.id) throw new Error('Shuffle must select a different board');
      const projected = projectLobbyState({ ...state, revision: state.revision + 1, puzzle });
      if (!projected.ok) throw new Error('Invalid shuffled lobby');
      nextState = projected.value;
      outcome = { status: 'accepted' };
    }
    if (nextState !== state) saveRoom(storage, { ...nextRoom, state: nextState });
    storage.sql.exec('INSERT INTO membership_replays VALUES (?, ?, ?, ?, ?)',
      sessionId, input.commandId, canonical, JSON.stringify(outcome), nextState.revision);
    return { outcome, processedRevision: nextState.revision, duplicate: false, changed: nextState !== before.state };
  });
}
