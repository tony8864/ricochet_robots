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
  readonly actionError: string;
}
export interface LiveLobbyClient {
  readonly getSnapshot: () => LobbyState;
  readonly subscribe: (listener: () => void) => () => void;
  readonly connect: () => void;
  readonly disconnect: () => void;
  readonly shuffle: () => void;
}
interface Dependencies {
  readonly socket: (url: string, handlers: LobbySocketHandlers) => LobbySocket;
  readonly origin: () => string;
  readonly commandId: () => string;
  readonly timeoutMs: number;
}

function browserSocket(url: string, handlers: LobbySocketHandlers): LobbySocket {
  const socket = new WebSocket(url);
  socket.onmessage = (event) => handlers.message(event.data);
  socket.onclose = (event) => handlers.closed(event.code);
  socket.onerror = () => handlers.failed();
  return { send: (text) => socket.send(text), close: () => socket.close() };
}

/** Lobby-only network adapter: no local match controller, optimistic board edits or automatic reconnect. */
export function liveLobbyClient(input: RoomEnteredMessage, overrides: Partial<Dependencies> = {}): LiveLobbyClient {
  const initial = parseServerMessage(input);
  if (!initial.ok || initial.value.type !== 'room.entered') throw new Error('Validated room entry required');
  const entry = initial.value;
  const deps: Dependencies = { socket: browserSocket, origin: () => location.origin,
    commandId: () => crypto.randomUUID(), timeoutMs: 10_000, ...overrides };
  let state: LobbyState = { room: entry.state, connection: 'connecting',
    message: 'Connecting to the room…', shuffle: 'idle', actionError: '' };
  const listeners = new Set<() => void>();
  let socket: LobbySocket | undefined;
  let generation = 0;
  let bound = false;
  let resync = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending: { request: RoomRequest; result?: CommandResultMessage } | undefined;

  const publish = (change: Partial<LobbyState>) => {
    state = { ...state, ...change };
    listeners.forEach((listener) => listener());
  };
  const clearTimer = () => { clearTimeout(timer); timer = undefined; };
  function closeTransport() {
    ++generation;
    bound = false;
    clearTimer();
    const previous = socket;
    socket = undefined;
    try { previous?.close(); } catch { /* Transport is already unavailable. */ }
  }
  function fail(connection: LobbyState['connection'], message: string) {
    closeTransport();
    publish({ connection, message, shuffle: pending ? 'retry' : 'idle' });
  }
  function settleShuffle() {
    const result = pending?.result;
    if (!result || state.room.revision < result.currentRevision) return;
    clearTimer();
    pending = undefined;
    publish({ shuffle: 'idle', actionError: result.outcome.status === 'rejected'
      ? result.outcome.reason === 'not-host' ? 'Only the host can shuffle the board.'
        : result.outcome.reason === 'stale-context' || result.outcome.reason === 'wrong-phase'
          ? 'The lobby changed. Review the current room before trying again.'
          : 'The shuffle request was rejected. Please try again.'
      : '' });
  }
  function applyRoom(room: PublicRoomState, freshBinding = false): boolean {
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
    if (freshBinding) resync = false;
    settleShuffle();
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
      if (!applyRoom(message.state, true)) {
        if (state.connection === 'connecting') fail('error', 'The room snapshot is out of date. Reconnect to synchronize.');
        return;
      }
      bound = true;
      clearTimer();
      publish({ connection: 'connected', message: 'Connected' });
      return;
    }
    if (message.type === 'room.snapshot') { applyRoom(message.state); return; }
    if (message.type === 'room.closed' && message.roomId === entry.roomId) {
      fail('closed', 'This room is no longer available.'); return;
    }
    if (message.type === 'command.result' && message.roomId === entry.roomId) {
      if (pending && message.commandId === pending.request.commandId) {
        pending.result = message;
        settleShuffle();
      }
      return;
    }
    fail('error', 'Unexpected server response. Reconnect to synchronize.');
  }

  function sendShuffle() {
    if (!socket || !pending || state.connection !== 'connected') return;
    pending.result = undefined;
    publish({ shuffle: 'pending', actionError: '' });
    clearTimer();
    timer = setTimeout(() => publish({ shuffle: 'retry',
      actionError: 'The shuffle reply is delayed. Retry the same request; the board will not shuffle twice.' }), deps.timeoutMs);
    try { socket.send(JSON.stringify(pending.request)); }
    catch { fail('disconnected', 'Connection lost. Reconnect before retrying the shuffle.'); }
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
      publish({ connection: 'disconnected', message: 'Disconnected.', shuffle: pending ? 'retry' : 'idle' });
    },
    shuffle: () => {
      if (state.connection !== 'connected' || state.room.status !== 'lobby'
        || state.room.hostSeatId !== entry.seatId || state.shuffle === 'pending') return;
      if (!pending) {
        try {
          const parsed = parseClientRequest({ version: PROTOCOL_VERSION, commandId: deps.commandId(), roomId: entry.roomId,
            context: { lobbyId: state.room.lobbyId }, command: { type: 'board.shuffle' } });
          if (!parsed.ok || !('roomId' in parsed.value)) throw new Error('Invalid shuffle request');
          pending = { request: parsed.value };
        } catch { publish({ actionError: 'A shuffle request could not be prepared. Please try again.' }); return; }
      }
      sendShuffle();
    },
  };
}
