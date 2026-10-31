import {
  PROTOCOL_VERSION, parseClientRequest, parseServerMessage, parseServerMessageJson,
  type CommandResultMessage, type PublicRoomState, type RoomEnteredMessage, type RoomRequest,
} from '@robot-puzzle/shared';

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
  readonly bidWindowOpen: boolean;
  readonly canRetryPreparation: boolean;
  readonly actionError: string;
}
export interface LiveLobbyClient {
  readonly getSnapshot: () => LobbyState;
  readonly subscribe: (listener: () => void) => () => void;
  readonly connect: () => void;
  readonly disconnect: () => void;
  readonly shuffle: () => void;
  readonly start: () => void;
  readonly retryPreparation: () => void;
  readonly placeBid: (value: number) => void;
  readonly getServerNow: () => number;
  readonly retry: () => void;
}
interface Dependencies {
  readonly socket: (url: string, handlers: LobbySocketHandlers) => LobbySocket;
  readonly origin: () => string;
  readonly commandId: () => string;
  readonly timeoutMs: number;
  readonly now: () => number;
}

function browserSocket(url: string, handlers: LobbySocketHandlers): LobbySocket {
  const socket = new WebSocket(url);
  socket.onmessage = (event) => handlers.message(event.data);
  socket.onclose = (event) => handlers.closed(event.code);
  socket.onerror = () => handlers.failed();
  return { send: (text) => socket.send(text), close: () => socket.close() };
}

/** Connected room adapter: no local match controller, optimistic state or automatic reconnect. */
export function liveLobbyClient(input: RoomEnteredMessage, overrides: Partial<Dependencies> = {}): LiveLobbyClient {
  const initial = parseServerMessage(input);
  if (!initial.ok || initial.value.type !== 'room.entered') throw new Error('Validated room entry required');
  const entry = initial.value;
  const deps: Dependencies = { socket: browserSocket, origin: () => location.origin,
    commandId: () => crypto.randomUUID(), timeoutMs: 10_000, now: () => performance.now(), ...overrides };
  let clock = { serverTimeMs: entry.serverTimeMs, observedAtMs: deps.now() };
  const getServerNow = () => clock.serverTimeMs + Math.max(0, deps.now() - clock.observedAtMs);
  let state: LobbyState = { room: entry.state, connection: 'connecting',
    message: 'Connecting to the room…', shuffle: 'idle', start: 'idle', preparation: 'idle', bid: 'idle', bidWindowOpen: false, canRetryPreparation: false, actionError: '' };
  const listeners = new Set<() => void>();
  let socket: LobbySocket | undefined;
  let generation = 0;
  let bound = false;
  let resync = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let cooldownTimer: ReturnType<typeof setTimeout> | undefined;
  let biddingTimer: ReturnType<typeof setTimeout> | undefined;
  let pending: { request: RoomRequest; result?: CommandResultMessage } | undefined;

  const publish = (change: Partial<LobbyState>) => {
    state = { ...state, ...change };
    listeners.forEach((listener) => listener());
  };
  const clearTimer = () => { clearTimeout(timer); timer = undefined; };
  const progress = (value: LobbyState['start']): Partial<LobbyState> => ({
    shuffle: pending?.request.command.type === 'board.shuffle' ? value : 'idle',
    start: pending?.request.command.type === 'room.start' ? value : 'idle',
    preparation: pending?.request.command.type === 'preparation.retry' ? value : 'idle',
    bid: pending?.request.command.type === 'bid.submit' ? value : 'idle',
  });
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
    const previous = socket;
    socket = undefined;
    try { previous?.close(); } catch { /* Transport is already unavailable. */ }
  }
  function fail(connection: LobbyState['connection'], message: string) {
    closeTransport();
    publish({ connection, message, canRetryPreparation: false, bidWindowOpen: false, ...progress('retry') });
  }
  function settleAction() {
    const result = pending?.result;
    if (!result || state.room.revision < result.currentRevision) return;
    clearTimer();
    const starting = pending!.request.command.type === 'room.start';
    const preparing = pending!.request.command.type === 'preparation.retry';
    pending = undefined;
    publish({ shuffle: 'idle', start: 'idle', preparation: 'idle', bid: 'idle', actionError: result.outcome.status === 'rejected'
      ? result.outcome.reason === 'not-host' ? preparing ? 'Only the host can retry preparation.' : starting ? 'Only the host can start the match.' : 'Only the host can shuffle the board.'
        : result.outcome.reason === 'preparation-cooldown' ? 'Preparation retry is not ready yet. Wait briefly and try again.'
        : result.outcome.reason === 'bid-increase' ? 'You can only lower your own bid.'
        : result.outcome.reason === 'bidding-closed' ? 'Bidding has closed.'
        : result.outcome.reason === 'invalid-bid' ? 'Enter a positive whole-number bid.'
        : result.outcome.reason === 'not-enough-players' ? 'At least two players must join before starting.'
        : result.outcome.reason === 'preview-changed' ? 'The preview board changed. Review it before starting.'
        : result.outcome.reason === 'stale-context' || result.outcome.reason === 'wrong-phase'
          ? 'The room changed. Review the current phase before trying again.'
          : 'The room request was rejected. Please try again.'
      : '' });
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
    publish({ room });
    if (freshBinding || serverTimeMs > clock.serverTimeMs) clock = { serverTimeMs, observedAtMs: deps.now() };
    refreshBidding();
    refreshPreparation(serverTimeMs);
    if (freshBinding) resync = false;
    settleAction();
    return true;
  }
  function receive(data: unknown) {
    const parsed = parseServerMessageJson(data);
    if (!parsed.ok) { fail('error', 'Invalid server response. Reconnect to synchronize.'); return; }
    const message = parsed.value;
    if (!bound) {
      if (message.type !== 'session.bound' || message.roomId !== entry.roomId || message.seatId !== entry.seatId) {
        fail('error', 'The room connection could not be verified. Reconnect to try again.'); return;
      }
      if (!applyRoom(message.state, message.serverTimeMs, true)) {
        if (state.connection === 'connecting') fail('error', 'The room snapshot is out of date. Reconnect to synchronize.');
        return;
      }
      bound = true;
      clearTimer();
      publish({ connection: 'connected', message: 'Connected' });
      return;
    }
    if (message.type === 'room.snapshot') { applyRoom(message.state, message.serverTimeMs); return; }
    if (message.type === 'room.closed' && message.roomId === entry.roomId) {
      fail('closed', 'This room is no longer available.'); return;
    }
    if (message.type === 'command.result' && message.roomId === entry.roomId) {
      if (pending && message.commandId === pending.request.commandId) {
        pending.result = message;
        settleAction();
      }
      return;
    }
    fail('error', 'Unexpected server response. Reconnect to synchronize.');
  }

  function sendAction() {
    if (!socket || !pending || state.connection !== 'connected') return;
    pending.result = undefined;
    publish({ ...progress('pending'), actionError: '' });
    clearTimer();
    timer = setTimeout(() => publish({ ...progress('retry'), actionError: pending?.request.command.type === 'room.start'
      ? 'The Start reply is delayed. Retry the same request; a second match will not be created.'
      : pending?.request.command.type === 'preparation.retry' ? 'The preparation reply is delayed. Retry the same request; another job will not be created.'
      : pending?.request.command.type === 'bid.submit' ? 'The bid reply is delayed. Retry the same request to check its outcome.'
      : 'The shuffle reply is delayed. Retry the same request; the board will not shuffle twice.' }), deps.timeoutMs);
    try { socket.send(JSON.stringify(pending.request)); }
    catch { fail('disconnected', 'Connection lost. Reconnect before retrying the room request.'); }
  }

  function submit(type: 'board.shuffle' | 'room.start' | 'preparation.retry' | 'bid.submit', value?: number) {
    if (state.connection !== 'connected' || (type !== 'bid.submit' && state.room.hostSeatId !== entry.seatId)) return;
    if (pending) {
      if (type !== 'bid.submit' && pending.request.command.type === type && state.shuffle !== 'pending' && state.start !== 'pending' && state.preparation !== 'pending' && state.bid !== 'pending') sendAction();
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

  return {
    getSnapshot: () => state,
    subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    connect: () => {
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
            fail(code === 1008 ? 'expired' : 'disconnected', code === 1008
              ? 'Your session is unavailable or expired. This connection cannot restore an expired seat.'
              : 'Disconnected. The board and roster below may be out of date.');
          },
          failed: () => { if (generation === current) fail('disconnected', 'Could not connect. Check your connection and configured HTTPS address.'); },
        });
      } catch { fail('disconnected', 'Could not connect. Use the configured HTTPS address and try reconnecting.'); }
    },
    disconnect: () => {
      closeTransport();
      publish({ connection: 'disconnected', message: 'Disconnected.', canRetryPreparation: false, bidWindowOpen: false, ...progress('retry') });
    },
    shuffle: () => submit('board.shuffle'),
    start: () => submit('room.start'),
    retryPreparation: () => submit('preparation.retry'),
    placeBid: (value) => submit('bid.submit', value),
    getServerNow,
    retry: () => {
      if (pending && state.shuffle !== 'pending' && state.start !== 'pending' && state.preparation !== 'pending' && state.bid !== 'pending') sendAction();
    },
  };
}
