import {
  PROTOCOL_VERSION, HEARTBEAT_INTERVAL_MS, CONNECTION_LEASE_MS, parseClientRequest, parseServerMessage, parseServerMessageJson,
  type CommandResultMessage, type PublicRoomState, type RoomEnteredMessage, type RoomRequest,
} from '@robot-puzzle/shared';
import type { Direction, RobotId } from '@robot-puzzle/game-engine';
import type { AttemptMatchCommand } from '@robot-puzzle/match';
import { resumeRoom, type ResumeResult } from '../entry/resumeRoom';
import { roomRecoveryStore, recoveryRecord, type RoomRecoveryStore } from './roomRecovery';
import { browserRecoveryEnvironment, reconnectDelay, type RecoveryEnvironment } from './recoveryEnvironment';

export interface LobbySocketHandlers {
  readonly message: (data: unknown) => void;
  readonly closed: (code: number) => void;
  readonly failed: () => void;
}
export interface LobbySocket { send(text: string): void; close(): void }
export interface LobbyState {
  readonly room: PublicRoomState;
  readonly connection: 'connecting' | 'connected' | 'disconnected' | 'error' | 'expired' | 'closed';
  readonly message: string;
  readonly shuffle: 'idle' | 'pending' | 'retry';
  readonly start: 'idle' | 'pending' | 'retry';
  readonly preparation: 'idle' | 'pending' | 'retry';
  readonly bid: 'idle' | 'pending' | 'retry';
  readonly attempt: 'idle' | 'pending' | 'retry';
  readonly round: 'idle' | 'pending' | 'retry';
  readonly rematch: 'idle' | 'pending' | 'retry';
  readonly end: 'idle' | 'pending' | 'retry';
  readonly attemptFeedback: string;
  /** Presentation only: remount robots on rebind/attempt change or missed steps. */
  readonly boardEpoch: number;
  readonly bidWindowOpen: boolean;
  readonly canRetryPreparation: boolean;
  readonly actionError: string;
}
export interface LiveLobbyClient {
  readonly getSnapshot: () => LobbyState;
  readonly subscribe: (listener: () => void) => () => void;
  readonly connect: () => void;
  readonly disconnect: () => void;
  readonly leave: () => boolean;
  readonly shuffle: () => void;
  readonly start: () => void;
  readonly retryPreparation: () => void;
  readonly placeBid: (value: number) => void;
  readonly move: (robotId: RobotId, direction: Direction) => void;
  readonly undo: () => void;
  readonly reset: () => void;
  readonly giveUp: () => void;
  readonly skipDisconnected: () => void;
  readonly skipRound: () => void;
  readonly continueRound: () => void;
  readonly returnToLobby: () => void;
  readonly endRoom: () => void;
  readonly getServerNow: () => number;
  readonly retry: () => void;
}
interface Dependencies {
  readonly socket: (url: string, handlers: LobbySocketHandlers) => LobbySocket;
  readonly origin: () => string;
  readonly commandId: () => string;
  readonly timeoutMs: number;
  readonly now: () => number;
  readonly confirm: (message: string) => boolean;
  readonly heartbeats: boolean;
  readonly automatic: boolean;
  readonly recovery: RoomRecoveryStore;
  readonly environment: RecoveryEnvironment;
  readonly random: () => number;
  readonly resume: (roomId: string, signal: AbortSignal) => Promise<ResumeResult>;
}

function browserSocket(url: string, handlers: LobbySocketHandlers): LobbySocket {
  const socket = new WebSocket(url);
  socket.onmessage = (event) => handlers.message(event.data);
  socket.onclose = (event) => handlers.closed(event.code);
  socket.onerror = () => handlers.failed();
  return { send: (text) => socket.send(text), close: () => socket.close() };
}

/** Authoritative snapshots with bounded recovery; never optimistic gameplay/offline inputs. */
export function liveLobbyClient(input: RoomEnteredMessage, overrides: Partial<Dependencies> = {}): LiveLobbyClient {
  const initial = parseServerMessage(input);
  if (!initial.ok || initial.value.type !== 'room.entered') throw new Error('Validated room entry required');
  const entry = initial.value;
  const deps: Dependencies = { socket: browserSocket, origin: () => location.origin,
    commandId: () => crypto.randomUUID(), timeoutMs: 10_000, now: () => performance.now(), confirm: (message) => window.confirm(message),
    heartbeats: true, automatic: true, recovery: roomRecoveryStore(), environment: browserRecoveryEnvironment,
    random: Math.random, resume: resumeRoom, ...overrides };
  let clock = { serverTimeMs: entry.serverTimeMs, observedAtMs: deps.now() };
  const getServerNow = () => clock.serverTimeMs + Math.max(0, deps.now() - clock.observedAtMs);
  let state: LobbyState = { room: entry.state, connection: 'connecting',
    message: 'Connecting to the room…', shuffle: 'idle', start: 'idle', preparation: 'idle', bid: 'idle', attempt: 'idle', round: 'idle', rematch: 'idle', end: 'idle', attemptFeedback: '', boardEpoch: 0, bidWindowOpen: false, canRetryPreparation: false, actionError: '' };
  const listeners = new Set<() => void>();
  let socket: LobbySocket | undefined;
  let generation = 0;
  let bound = false;
  let resync = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let cooldownTimer: ReturnType<typeof setTimeout> | undefined;
  let biddingTimer: ReturnType<typeof setTimeout> | undefined;
  let heartbeatTimer: ReturnType<typeof setTimeout> | undefined;
  let connectionId: string | undefined;
  let pingSequence = 0;
  let lastPong = 0;
  let watchdog: ReturnType<typeof setTimeout> | undefined;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  let resumeAbort: AbortController | undefined;
  let unwatch: (() => void) | undefined;
  let wanted = false;
  let left = false;
  let firstConnection = true;
  let retryStep = 0;
  let lastResumeAt = -Infinity;
  let updateRequired = false;
  let pending: { request: RoomRequest; result?: CommandResultMessage } | undefined;
  const saved = deps.recovery.read();
  if (saved?.roomId === entry.roomId && saved.roomCode === entry.state.roomCode && saved.seatId === entry.seatId && saved.pending) pending = { request: saved.pending };
  const STORAGE_WARNING = 'Refresh recovery could not be saved in this browser. Keep this page open until the pending request is resolved.';
  const remember = () => deps.recovery.save(recoveryRecord(entry, pending?.request ?? null));
  const actionType = () => pending?.request.command.type === 'command.retry'
    ? pending.request.command.originalRequest.command.type : pending?.request.command.type;

  const publish = (change: Partial<LobbyState>) => {
    state = { ...state, ...change };
    listeners.forEach((listener) => listener());
  };
  const clearTimer = () => { clearTimeout(timer); timer = undefined; };
  const progress = (value: LobbyState['start']): Partial<LobbyState> => ({
    shuffle: actionType() === 'board.shuffle' ? value : 'idle',
    start: actionType() === 'room.start' ? value : 'idle',
    preparation: actionType() === 'preparation.retry' ? value : 'idle',
    bid: actionType() === 'bid.submit' ? value : 'idle',
    attempt: actionType()?.startsWith('attempt.') ? value : 'idle',
    round: actionType() === 'round.skip' || actionType() === 'round.continue' ? value : 'idle',
    rematch: actionType() === 'match.returnToLobby' ? value : 'idle',
    end: actionType() === 'room.end' ? value : 'idle',
  });
  if (pending) state = { ...state, ...progress('retry'), actionError: 'A previous room request is unresolved. Reconnect, then retry the pending request.' };
  function refreshBidding() {
    clearTimeout(biddingTimer);
    const match = state.room.status === 'playing' ? state.room.match : null;
    const remaining = match?.phase === 'bidding' ? Math.max(0, match.deadlineAtMs - getServerNow()) : 0;
    publish({ bidWindowOpen: match?.phase === 'thinking' || (match?.phase === 'bidding' && remaining > 0) });
    if (remaining > 0) {
      const current = generation;
      biddingTimer = setTimeout(() => { if (generation === current) refreshBidding(); }, Math.min(remaining, 2_147_483_647));
    }
  }
  function refreshPreparation(serverTimeMs: number) {
    clearTimeout(cooldownTimer);
    const room = state.room;
    const metadata = room.status === 'playing' && room.match.phase === 'preparing'
      && (room.match.preparation.status === 'deferred' || room.match.preparation.status === 'error')
      ? room.match.preparation.retry : undefined;
    const remaining = metadata ? Math.max(0, metadata.availableAtMs - serverTimeMs) : 0;
    publish({ canRetryPreparation: !!metadata && remaining === 0 });
    if (metadata && remaining > 0) {
      const current = generation;
      const delay = Math.min(remaining, 2_147_483_647);
      // Informational UI eligibility only. The server rechecks cooldown/authority.
      cooldownTimer = setTimeout(() => {
        if (generation !== current) return;
        if (delay < remaining) refreshPreparation(serverTimeMs + delay);
        else publish({ canRetryPreparation: true });
      }, delay);
    }
  }
  function closeTransport() {
    ++generation;
    bound = false;
    clearTimer();
    clearTimeout(cooldownTimer);
    clearTimeout(biddingTimer);
    clearTimeout(heartbeatTimer);
    clearTimeout(watchdog);
    resumeAbort?.abort(); resumeAbort = undefined;
    connectionId = undefined;
    pingSequence = 0;
    lastPong = 0;
    const previous = socket;
    socket = undefined;
    try { previous?.close(); } catch { /* Transport is already unavailable. */ }
  }
  function fail(connection: LobbyState['connection'], message: string) {
    closeTransport();
    if (connection !== 'disconnected') stopRecovery();
    if (connection === 'closed' || connection === 'expired') deps.recovery.clear(entry.roomId);
    if (message.startsWith('Update required')) updateRequired = true;
    publish({ connection, message, canRetryPreparation: false, bidWindowOpen: false, ...progress('retry') });
    if (connection === 'disconnected') scheduleReconnect();
  }
  function stopRecovery() {
    wanted = false;
    clearTimeout(reconnectTimer); reconnectTimer = undefined;
    unwatch?.(); unwatch = undefined;
  }
  function scheduleReconnect(immediate = false) {
    if (!wanted || !deps.automatic || !deps.environment.online() || reconnectTimer || resumeAbort || socket) return;
    const delay = immediate ? 0 : reconnectDelay(retryStep++, deps.random);
    reconnectTimer = setTimeout(() => { reconnectTimer = undefined; void recover(); }, delay);
  }
  async function recover() {
    if (!wanted || !deps.environment.online() || resumeAbort || socket) return;
    const remaining = 10000 - (deps.now() - lastResumeAt);
    if (remaining > 0) {
      reconnectTimer = setTimeout(() => { reconnectTimer = undefined; void recover(); }, remaining);
      return;
    }
    closeTransport();
    const current = generation;
    const controller = new AbortController(); resumeAbort = controller;
    lastResumeAt = deps.now();
    publish({ connection: 'connecting', message: 'Reconnecting to the room…', canRetryPreparation: false, bidWindowOpen: false });
    let result: ResumeResult;
    try { result = await deps.resume(entry.roomId, controller.signal); }
    catch { result = { status: 'transient', message: 'Connection lost. Reconnecting…' }; }
    if (current !== generation || !wanted) return;
    resumeAbort = undefined;
    if (result.status !== 'resumed') {
      fail(result.status === 'transient' ? 'disconnected' : result.status, result.message); return;
    }
    const checked = parseServerMessage(result.entry);
    if (!checked.ok || checked.value.type !== 'room.entered' || checked.value.membership !== 'resumed'
      || checked.value.roomId !== entry.roomId || checked.value.seatId !== entry.seatId
      || checked.value.state.roomCode !== entry.state.roomCode) {
      fail('error', 'The room recovery data did not match your seat.'); return;
    }
    openSocket();
  }
  function watchLifecycle() {
    if (!deps.automatic || unwatch) return;
    unwatch = deps.environment.watch((event) => {
      if (!wanted) return;
      if (event === 'offline') {
        clearTimeout(reconnectTimer); reconnectTimer = undefined;
        fail('disconnected', 'You are offline. Waiting for a connection…');
      } else {
        if (resumeAbort || (socket && !bound)) return; // Coalesce repeated resume/online signals.
        clearTimeout(reconnectTimer); reconnectTimer = undefined;
        closeTransport();
        publish({ connection: 'disconnected', message: 'Reconnecting to the room…', bidWindowOpen: false, canRetryPreparation: false, ...progress('retry') });
        scheduleReconnect(true);
      }
    });
  }
  function armWatchdog() {
    if (!deps.automatic) return;
    clearTimeout(watchdog);
    const current = generation;
    watchdog = setTimeout(() => {
      if (current === generation) fail('disconnected', 'The connection stopped responding. Reconnecting…');
    }, CONNECTION_LEASE_MS);
  }
  function settleAction() {
    const result = pending?.result;
    if (!result || (pending?.request.command.type !== 'room.end' && state.room.revision < result.currentRevision)) return;
    clearTimer();
    const starting = pending!.request.command.type === 'room.start';
    const preparing = pending!.request.command.type === 'preparation.retry';
    const progressing = pending!.request.command.type.startsWith('round.');
    const returning = pending!.request.command.type === 'match.returnToLobby';
    const skippingAttempt = pending!.request.command.type === 'attempt.skipDisconnected';
    const ending = pending!.request.command.type === 'room.end';
    pending = undefined;
    const remembered = remember();
    if (ending && result.outcome.status === 'accepted') {
      publish({ end: 'idle' }); fail('closed', 'The host ended this room.'); return;
    }
    publish({ shuffle: 'idle', start: 'idle', preparation: 'idle', bid: 'idle', attempt: 'idle', round: 'idle', rematch: 'idle', end: 'idle',
      attemptFeedback: result.outcome.status === 'no-op' ? result.outcome.reason === 'blocked-move' ? 'That robot cannot move in that direction.'
        : result.outcome.reason === 'empty-undo' ? 'There are no moves to undo.' : result.outcome.reason === 'already-reset' ? 'The attempt is already at its starting positions.' : '' : '',
      actionError: result.outcome.status === 'rejected'
      ? result.outcome.reason === 'not-host' ? ending ? 'Only the host can end the room.' : skippingAttempt ? 'Only the host can skip a disconnected attempt.' : returning ? 'Only the host can return everyone to the lobby.' : progressing ? 'Only the host can advance or skip the round.' : preparing ? 'Only the host can retry preparation.' : starting ? 'Only the host can start the match.' : 'Only the host can shuffle the board.'
        : result.outcome.reason === 'preparation-cooldown' ? 'Preparation retry is not ready yet. Wait briefly and try again.'
        : result.outcome.reason === 'bid-increase' ? 'You can only lower your own bid.'
        : result.outcome.reason === 'bidding-closed' ? 'Bidding has closed.'
        : result.outcome.reason === 'invalid-bid' ? 'Enter a positive whole-number bid.'
        : result.outcome.reason === 'not-active-bidder' ? 'Only the active bidder can control the robots.'
        : result.outcome.reason === 'bid-limit' ? 'Bid limit reached. Undo, Reset, or Give Up to continue.'
        : result.outcome.reason === 'confirmation-required' ? 'Skipping requires confirmation.'
        : result.outcome.reason === 'bidder-connected' ? 'The bidder has reconnected. Their attempt continues.'
        : result.outcome.reason === 'disconnect-grace-active' ? 'The bidder still has time to reconnect. Wait for server confirmation.'
        : result.outcome.reason === 'retry-not-found' ? 'The previous request could not be confirmed. Review the current server state before choosing a new action.'
        : result.outcome.reason === 'not-enough-players' ? 'At least two players must join before starting.'
        : result.outcome.reason === 'preview-changed' ? 'The preview board changed. Review it before starting.'
        : result.outcome.reason === 'stale-context' || result.outcome.reason === 'wrong-phase'
          ? 'The room changed. Review the current phase before trying again.'
          : 'The room request was rejected. Please try again.'
      : remembered ? '' : STORAGE_WARNING });
  }
  function applyRoom(room: PublicRoomState, serverTimeMs: number, freshBinding = false): boolean {
    if (room.roomId !== entry.roomId || room.roomCode !== entry.state.roomCode
      || !room.players.some((player) => player.seatId === entry.seatId)) {
      fail('error', 'The room data did not match your seat. Reconnect to synchronize.');
      return false;
    }
    if (room.revision < state.room.revision) return false;
    if (room.revision === state.room.revision && JSON.stringify(room) !== JSON.stringify(state.room)
      && !(freshBinding && resync)) {
      resync = true;
      fail('error', 'Conflicting room data. Reconnect to request a fresh snapshot.');
      return false;
    }
    const previous = state.room.status === 'playing' && state.room.match.phase === 'demonstrating' ? state.room.match : null;
    const next = room.status === 'playing' && room.match.phase === 'demonstrating' ? room.match : null;
    const restore = freshBinding || (next && (!previous || previous.attempt.id !== next.attempt.id ||
      previous.matchId !== next.matchId || next.attempt.version > previous.attempt.version + 1));
    publish({ room, boardEpoch: state.boardEpoch + (restore ? 1 : 0),
      ...(previous?.attempt.id !== next?.attempt.id ? { attemptFeedback: '' } : {}) });
    if (freshBinding || serverTimeMs > clock.serverTimeMs) clock = { serverTimeMs, observedAtMs: deps.now() };
    refreshBidding();
    refreshPreparation(serverTimeMs);
    if (freshBinding) resync = false;
    settleAction();
    return true;
  }
  function receive(data: unknown) {
    const parsed = parseServerMessageJson(data);
    if (!parsed.ok) { fail('error', parsed.error === 'unsupported-version' ? 'Update required. Reload the game.' : 'Invalid server response. Reconnect to synchronize.'); return; }
    const message = parsed.value;
    if (message.type === 'protocol.error' && message.reason === 'unsupported-version') { fail('error', 'Update required. Reload the game.'); return; }
    if (!bound) {
      if (message.type !== 'session.bound' || message.roomId !== entry.roomId || message.seatId !== entry.seatId) {
        fail('error', 'The room connection could not be verified. Reconnect to try again.'); return;
      }
      if (!applyRoom(message.state, message.serverTimeMs, true)) {
        if (state.connection === 'connecting') fail('error', 'The room snapshot is out of date. Reconnect to synchronize.');
        return;
      }
      bound = true;
      connectionId = message.connectionId;
      clearTimer();
      publish({ connection: 'connected', message: 'Connected' });
      retryStep = 0;
      armWatchdog();
      heartbeat();
      return;
    }
    if (message.type === 'connection.pong') {
      if (message.connectionId !== connectionId || message.sequence > pingSequence) fail('error', 'The heartbeat did not match this connection. Reconnect to synchronize.');
      else if (message.sequence > lastPong) { lastPong = message.sequence; armWatchdog(); }
      return;
    }
    if (message.type === 'room.snapshot') { if (applyRoom(message.state, message.serverTimeMs)) armWatchdog(); return; }
    if (message.type === 'room.closed' && message.roomId === entry.roomId) {
      fail('closed', message.reason === 'host-ended' ? 'The host ended this room.' : message.reason === 'expired' ? 'This room has expired.' : 'This room is no longer available.'); return;
    }
    if (message.type === 'command.result' && message.roomId === entry.roomId) {
      armWatchdog();
      if (pending && message.commandId === pending.request.commandId) {
        pending.result = message;
        settleAction();
      }
      return;
    }
    fail('error', 'Unexpected server response. Reconnect to synchronize.');
  }

  // Keepalive never occupies the single unresolved game-action slot.
  function heartbeat() {
    if (!deps.heartbeats || !bound || !socket || !connectionId) return;
    const current = generation;
    try {
      socket.send(JSON.stringify({ version: PROTOCOL_VERSION, type: 'connection.ping', roomId: entry.roomId,
        connectionId, sequence: ++pingSequence }));
    } catch { fail('disconnected', 'Connection lost. Reconnect to synchronize.'); return; }
    heartbeatTimer = setTimeout(() => { if (generation === current) heartbeat(); }, HEARTBEAT_INTERVAL_MS);
  }

  function ready() {
    if (!bound || state.connection !== 'connected') return false;
    if (deps.automatic && !deps.environment.online()) {
      fail('disconnected', 'You are offline. Waiting for a connection…'); return false;
    }
    return true;
  }
  function sendAction() {
    if (!socket || !pending || !ready()) return;
    pending.result = undefined;
    publish({ ...progress('pending'), actionError: remember() ? '' : STORAGE_WARNING, attemptFeedback: '' });
    clearTimer();
    timer = setTimeout(() => publish({ ...progress('retry'), actionError: pending?.request.command.type === 'room.end'
      ? 'The End Room reply is delayed. Retry the same request to check whether the room ended.'
      : pending?.request.command.type === 'room.start' ? 'The Start reply is delayed. Retry the same request; a second match will not be created.'
      : pending?.request.command.type === 'preparation.retry' ? 'The preparation reply is delayed. Retry the same request; another job will not be created.'
      : pending?.request.command.type === 'bid.submit' ? 'The bid reply is delayed. Retry the same request to check its outcome.'
      : pending?.request.command.type.startsWith('attempt.') ? 'The attempt reply is delayed. Retry the same request to check its outcome; do not repeat the action.'
      : pending?.request.command.type.startsWith('round.') ? 'The round reply is delayed. Retry the same request; the round will not advance twice.'
      : pending?.request.command.type === 'match.returnToLobby' ? 'The New Match reply is delayed. Retry the same request; the lobby will not be recreated twice.'
      : 'The shuffle reply is delayed. Retry the same request; the board will not shuffle twice.' }), deps.timeoutMs);
    try { socket.send(JSON.stringify(pending.request)); }
    catch { fail('disconnected', 'Connection lost. Reconnect before retrying the room request.'); }
  }

  function submit(type: 'board.shuffle' | 'room.start' | 'preparation.retry' | 'bid.submit', value?: number) {
    if (!ready() || (type !== 'bid.submit' && state.room.hostSeatId !== entry.seatId)) return;
    if (pending) {
      if (type !== 'bid.submit' && pending.request.command.type === type && state.shuffle !== 'pending' && state.start !== 'pending' && state.preparation !== 'pending' && state.bid !== 'pending' && state.attempt !== 'pending' && state.round !== 'pending' && state.rematch !== 'pending') sendAction();
      return;
    }
    const room = state.room;
    const preparation = room.status === 'playing' && room.match.phase === 'preparing' ? room.match.preparation : null;
    if (type === 'bid.submit') {
      const match = room.status === 'playing' ? room.match : null;
      if (!match || (match.phase !== 'thinking' && match.phase !== 'bidding') || !state.bidWindowOpen ||
        (match.phase === 'bidding' && getServerNow() >= match.deadlineAtMs) || !Number.isSafeInteger(value) || value! <= 0) return;
      const previous = match.phase === 'bidding' ? match.bids.find((b) => b.seatId === entry.seatId) : undefined;
      if (previous && value! >= previous.value) return;
    } else if (type === 'preparation.retry') {
      if (!preparation?.retry || !state.canRetryPreparation || (preparation.status !== 'deferred' && preparation.status !== 'error')) return;
    } else if (room.status !== 'lobby' || (type === 'room.start' && room.players.length < 2)) return;
    try {
      const parsed = parseClientRequest({ version: PROTOCOL_VERSION, commandId: deps.commandId(), roomId: entry.roomId,
        context: type === 'bid.submit' && room.status === 'playing' && 'round' in room.match
          ? { matchId: room.match.matchId, roundNumber: room.match.round.number }
          : type === 'preparation.retry' && room.status === 'playing' && preparation?.retry
          ? { matchId: room.match.matchId, preparationId: preparation.retry.preparationId }
          : room.status === 'lobby' ? { lobbyId: room.lobbyId } : {},
        command: type === 'bid.submit' ? { type, value } : type === 'room.start' ? { type, boardId: room.puzzle.id } : { type } });
      if (!parsed.ok || !('roomId' in parsed.value)) throw new Error('Invalid room request');
      pending = { request: parsed.value };
    } catch { publish({ actionError: 'A room request could not be prepared. Please try again.' }); return; }
    sendAction();
  }

  function submitAttempt(command: AttemptMatchCommand) {
    const room = state.room;
    if (!ready() || pending || room.status !== 'playing' || room.match.phase !== 'demonstrating') return;
    const match = room.match;
    if (match.bidderQueue[match.activeBidderIndex].seatId !== entry.seatId) return;
    try {
      const parsed = parseClientRequest({ version: PROTOCOL_VERSION, roomId: entry.roomId, commandId: deps.commandId(),
        context: { matchId: match.matchId, roundNumber: match.round.number, attemptId: match.attempt.id, attemptVersion: match.attempt.version }, command });
      if (!parsed.ok || !('roomId' in parsed.value)) throw new Error('Invalid attempt request');
      pending = { request: parsed.value };
    } catch { publish({ actionError: 'The attempt request could not be prepared. Please try again.' }); return; }
    sendAction();
  }

  function submitRound(type: 'round.skip' | 'round.continue') {
    const room = state.room;
    if (!ready() || pending || room.hostSeatId !== entry.seatId || room.status !== 'playing' ||
      (type === 'round.skip' ? room.match.phase !== 'thinking' : room.match.phase !== 'round-result') || !('round' in room.match)) return;
    try {
      if (type === 'round.skip') {
        if (!deps.confirm('Skip this round? No points will be awarded. Robots stay in place, this target remains used, and the round counts toward the match total.')) return;
        // A stale confirmation must never apply to another phase/round/host.
        if (state.room !== room || state.connection !== 'connected' || !bound || pending) return;
      }
      const parsed = parseClientRequest({ version: PROTOCOL_VERSION, commandId: deps.commandId(), roomId: entry.roomId,
        context: { matchId: room.match.matchId, roundNumber: room.match.round.number },
        command: type === 'round.skip' ? { type, confirmed: true } : { type } });
      if (!parsed.ok || !('roomId' in parsed.value)) throw new Error('Invalid round request');
      pending = { request: parsed.value };
    } catch { publish({ actionError: 'The round request could not be prepared. Please try again.' }); return; }
    sendAction();
  }

  function skipDisconnected() {
    const room = state.room;
    if (!ready() || pending || room.hostSeatId !== entry.seatId || room.status !== 'playing' || room.match.phase !== 'demonstrating') return;
    const match = room.match;
    const bidder = room.players.find((p) => p.seatId === match.bidderQueue[match.activeBidderIndex].seatId);
    const d = match.disconnect;
    if (!d || d.status !== 'skippable' || bidder?.connected) return;
    try {
      if (!deps.confirm(`Skip ${bidder?.nickname}'s disconnected attempt? Their moves will be reset and the next bidder will try, or the round will end without points if nobody remains.`)) return;
      // Never apply a confirmation to a new absence, attempt, phase or binding.
      if (state.room !== room || !ready() || pending) return;
      const parsed = parseClientRequest({ version: PROTOCOL_VERSION, commandId: deps.commandId(), roomId: entry.roomId,
        context: { matchId: match.matchId, roundNumber: match.round.number, attemptId: match.attempt.id,
          attemptVersion: match.attempt.version, disconnectId: d.disconnectId },
        command: { type: 'attempt.skipDisconnected', confirmed: true } });
      if (!parsed.ok || !('roomId' in parsed.value)) throw new Error('Invalid skip request');
      pending = { request: parsed.value };
    } catch { publish({ actionError: 'The Skip Attempt request could not be prepared. Please try again.' }); return; }
    sendAction();
  }

  function endRoom() {
    const room = state.room;
    if (!ready() || pending || room.hostSeatId !== entry.seatId) return;
    try {
      const parsed = parseClientRequest({ version: PROTOCOL_VERSION, roomId: entry.roomId, commandId: deps.commandId(),
        context: room.status === 'lobby' ? { lobbyId: room.lobbyId } : { matchId: room.match.matchId },
        command: { type: 'room.end', confirmed: true } });
      if (!parsed.ok || !('roomId' in parsed.value)) throw new Error('Invalid End Room request');
      pending = { request: parsed.value };
    } catch { publish({ actionError: 'The End Room request could not be prepared. Please try again.' }); return; }
    sendAction();
  }

  function returnToLobby() {
    const room = state.room;
    if (!ready() || pending || room.status !== 'finished' || room.hostSeatId !== entry.seatId) return;
    try {
      const parsed = parseClientRequest({ version: PROTOCOL_VERSION, roomId: entry.roomId, commandId: deps.commandId(),
        context: { matchId: room.match.matchId }, command: { type: 'match.returnToLobby' } });
      if (!parsed.ok || !('roomId' in parsed.value)) throw new Error('Invalid lobby return request');
      pending = { request: parsed.value };
    } catch { publish({ actionError: 'The New Match request could not be prepared. Please try again.' }); return; }
    sendAction();
  }

  function openSocket() {
      if (socket || state.connection === 'closed' || state.connection === 'expired') return;
      closeTransport();
      publish({ connection: 'connecting', message: 'Connecting to the room…' });
      const current = generation;
      try {
        const origin = new URL(deps.origin());
        if (origin.protocol !== 'https:') throw new Error('HTTPS required');
        origin.protocol = 'wss:';
        origin.pathname = `/api/rooms/${entry.roomId}/socket`;
        origin.search = '';
        origin.hash = '';
        timer = setTimeout(() => fail('disconnected', 'The room connection timed out. Reconnect to try again.'), deps.timeoutMs);
        socket = deps.socket(origin.href, {
          message: (data) => { if (generation === current) receive(data); },
          closed: (code) => {
            if (generation !== current) return;
            fail(code === 1002 ? 'error' : code === 1008 ? 'expired' : 'disconnected', code === 1002 ? 'Update required. Reload the game.' : code === 1008
              ? 'Your session is unavailable or expired. This connection cannot restore an expired seat.'
              : 'Disconnected. The board and roster below may be out of date.');
          },
          failed: () => { if (generation === current) fail('disconnected', 'Could not connect. Check your connection and configured HTTPS address.'); },
        });
      } catch { fail('disconnected', 'Could not connect. Use the configured HTTPS address and try reconnecting.'); }
  }
  return {
    getSnapshot: () => state,
    subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    connect: () => {
      if (left || updateRequired || state.connection === 'closed' || state.connection === 'expired') return;
      wanted = true; watchLifecycle(); remember();
      if (deps.automatic && !deps.environment.online()) { fail('disconnected', 'You are offline. Waiting for a connection…'); return; }
      if (socket || resumeAbort) return;
      clearTimeout(reconnectTimer); reconnectTimer = undefined;
      if (!deps.automatic || firstConnection) { firstConnection = false; openSocket(); }
      else void recover();
    },
    disconnect: () => {
      stopRecovery();
      closeTransport();
      publish({ connection: 'disconnected', message: 'Disconnected.', canRetryPreparation: false, bidWindowOpen: false, ...progress('retry') });
    },
    leave: () => {
      if (left || state.room.hostSeatId === entry.seatId || state.connection === 'closed' || state.connection === 'expired') return false;
      // No membership command: close this transport only, retaining its seat and
      // exact uncertain request. A refresh must not silently undo explicit Leave.
      if (!deps.recovery.save({ ...recoveryRecord(entry, pending?.request ?? null), autoResume: false })) {
        publish({ actionError: 'Could not save your departure in this browser. Allow browser storage and try Leave Room again. You are still in the room.' });
        return false;
      }
      left = true;
      stopRecovery(); closeTransport();
      publish({ connection: 'disconnected', message: 'You left the room.', canRetryPreparation: false, bidWindowOpen: false, ...progress('retry') });
      return true;
    },
    shuffle: () => submit('board.shuffle'),
    start: () => submit('room.start'),
    retryPreparation: () => submit('preparation.retry'),
    placeBid: (value) => submit('bid.submit', value),
    move: (robotId, direction) => submitAttempt({ type: 'attempt.move', robotId, direction }),
    undo: () => submitAttempt({ type: 'attempt.undo' }),
    reset: () => submitAttempt({ type: 'attempt.reset' }),
    giveUp: () => submitAttempt({ type: 'attempt.giveUp' }),
    skipDisconnected,
    skipRound: () => submitRound('round.skip'),
    continueRound: () => submitRound('round.continue'),
    returnToLobby,
    endRoom,
    getServerNow,
    retry: () => {
      if (pending && state.shuffle !== 'pending' && state.start !== 'pending' && state.preparation !== 'pending' && state.bid !== 'pending' && state.attempt !== 'pending' && state.round !== 'pending' && state.rematch !== 'pending' && state.end !== 'pending') sendAction();
    },
  };
}
