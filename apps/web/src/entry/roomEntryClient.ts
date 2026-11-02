import {
  MAX_SERVER_MESSAGE_BYTES, PROTOCOL_VERSION, parseClientRequest, parseServerMessageJson,
  type BootstrapRejectionReason, type ClientRequest, type RoomEnteredMessage, type ServerMessage,
} from '@robot-puzzle/shared';
import { normalizeNickname, normalizeRoomCode } from './entryDraft';

type RoomEntryIntent =
  | { readonly action: 'create'; readonly nickname: string }
  | { readonly action: 'join'; readonly nickname: string; readonly roomCode: string };

export type RoomEntryState =
  | { readonly status: 'idle' }
  | ({ readonly status: 'pending' } & RoomEntryIntent)
  | ({ readonly status: 'error'; readonly message: string;
      readonly retryable: boolean; readonly sessionExpired: boolean } & RoomEntryIntent)
  | { readonly status: 'entered'; readonly entry: RoomEnteredMessage };

export interface RoomEntryClient {
  readonly getSnapshot: () => RoomEntryState;
  readonly subscribe: (listener: () => void) => () => void;
  readonly create: (nickname: string) => Promise<void>;
  readonly join: (nickname: string, roomCode: string) => Promise<void>;
  readonly retry: () => Promise<void>;
  /** Explicit user consent to bootstrap a different identity on the next submission. */
  readonly startNewSession: () => void;
}

interface Dependencies {
  readonly fetch: typeof fetch;
  readonly commandId: () => string;
  readonly isHttps: () => boolean;
  readonly timeoutMs: number;
}

const IDLE: RoomEntryState = { status: 'idle' };
const REJECTION_TEXT: Record<BootstrapRejectionReason, string> = {
  'not-authenticated': 'Your session is no longer valid. Start a new session before creating or joining a room. Previous seats cannot be recovered this way.',
  'room-not-found': 'Room not found. Check the room code and try again.',
  'room-full': 'The room is full.',
  'room-closed': 'The host ended this room. Create or join another room.',
  'room-expired': 'This room has expired. Create or join another room.',
  'match-started': 'The match has already started.',
  'seat-not-found': 'Your seat could not be found.',
  'command-id-conflict': 'This request could not be reused. Submit again to make a new request.',
  'rate-limited': 'Too many requests. Wait a moment, then retry.',
  'temporarily-unavailable': 'The service is temporarily unavailable. Please retry.',
};

class EntryFailure extends Error {
  constructor(message: string, readonly retryable = true, readonly sessionExpired = false) { super(message); }
}

async function readReply(response: Response): Promise<string> {
  if (response.headers.get('Content-Type')?.split(';')[0]?.trim().toLowerCase() !== 'application/json') {
    throw new EntryFailure('The server returned an unexpected response. Please retry.');
  }
  const reader = response.body?.getReader();
  if (!reader) throw new EntryFailure('The server returned an empty response. Please retry.');
  const bytes = new Uint8Array(MAX_SERVER_MESSAGE_BYTES);
  let length = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      if (length + chunk.value.byteLength > bytes.length) {
        await reader.cancel();
        throw new EntryFailure('The server returned an invalid response. Please retry.');
      }
      bytes.set(chunk.value, length);
      length += chunk.value.byteLength;
    }
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, length));
  } finally { reader.releaseLock(); }
}

/** One entry-flow instance. No credentials, room recovery data or requests are persisted. */
export function roomEntryClient(overrides: Partial<Dependencies> = {}): RoomEntryClient {
  const deps: Dependencies = {
    fetch: (...args) => fetch(...args), commandId: () => crypto.randomUUID(),
    isHttps: () => location.protocol === 'https:', timeoutMs: 15_000, ...overrides,
  };
  let state: RoomEntryState = IDLE;
  const listeners = new Set<() => void>();
  let sessionReady = false;
  let sessionRequest: ClientRequest | undefined;
  let roomRequest: ClientRequest | undefined;
  let pending: Promise<void> | undefined;

  const publish = (next: RoomEntryState) => {
    state = next;
    listeners.forEach((listener) => listener());
  };
  function request(command: ClientRequest['command']): ClientRequest {
    const parsed = parseClientRequest({ version: PROTOCOL_VERSION, commandId: deps.commandId(), command });
    if (!parsed.ok) throw new EntryFailure('A valid request could not be prepared. Please try again.', false);
    return parsed.value;
  }

  async function post(path: string, input: ClientRequest): Promise<ServerMessage> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), deps.timeoutMs);
    try {
      const response = await deps.fetch(path, {
        method: 'POST', credentials: 'same-origin', cache: 'no-store', redirect: 'error',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input), signal: controller.signal,
      });
      const parsed = parseServerMessageJson(await readReply(response));
      if (!parsed.ok && parsed.error === 'unsupported-version') throw new EntryFailure('Update required. Reload the game.', false);
      if (!parsed.ok) throw new EntryFailure('The server returned an invalid response. Please retry.');
      const message = parsed.value;
      if (message.type === 'protocol.error' && message.reason === 'unsupported-version') throw new EntryFailure('Update required. Reload the game.', false);
      // A null-ID Origin rejection cannot establish identity or membership.
      if (message.type === 'protocol.error' && message.commandId === null && response.status === 403) {
        throw new EntryFailure('Connection refused. Use the configured HTTPS address and check the server Origin settings.');
      }
      if (!('commandId' in message) || message.commandId !== input.commandId) {
        throw new EntryFailure('The server response did not match this request. Please retry.');
      }
      if (message.type === 'request.rejected') {
        throw new EntryFailure(REJECTION_TEXT[message.reason],
          message.reason === 'rate-limited' || message.reason === 'temporarily-unavailable',
          message.reason === 'not-authenticated');
      }
      if (!response.ok || message.type === 'protocol.error') {
        throw new EntryFailure('The server could not accept this request. Please retry.');
      }
      return message;
    } catch (error) {
      if (error instanceof EntryFailure) throw error;
      throw new EntryFailure(controller.signal.aborted
        ? 'The request timed out. Retry to recover the same room request.'
        : 'Connection lost. Check your connection, then retry.');
    } finally { clearTimeout(timeout); }
  }

  function run(attempt: RoomEntryIntent): Promise<void> {
    const intent: RoomEntryIntent = attempt.action === 'create'
      ? { action: 'create', nickname: attempt.nickname }
      : { action: 'join', nickname: attempt.nickname, roomCode: attempt.roomCode };
    // Publish synchronously to block rapid/keyboard submissions before React rerenders.
    publish({ status: 'pending', ...intent });
    pending = (async () => {
      try {
        if (!deps.isHttps()) throw new EntryFailure('Open the game using the configured HTTPS address to create or join a room.', false);
        roomRequest ??= request(intent.action === 'create'
          ? { type: 'room.create', nickname: intent.nickname }
          : { type: 'room.join', nickname: intent.nickname, roomCode: intent.roomCode });
        if (!sessionReady) {
          sessionRequest ??= request({ type: 'session.open' });
          const reply = await post('/api/session', sessionRequest);
          if (reply.type !== 'session.ready') throw new EntryFailure('The session response was unexpected. Please retry.');
          sessionReady = true;
        }
        const reply = await post(intent.action === 'create' ? '/api/rooms' : '/api/rooms/join', roomRequest);
        if (reply.type !== 'room.entered' || (intent.action === 'create'
          ? reply.membership !== 'created'
          : (reply.membership !== 'joined' && reply.membership !== 'resumed') || reply.state.roomCode !== intent.roomCode)) {
          throw new EntryFailure('The room response was unexpected. Please retry.');
        }
        publish({ status: 'entered', entry: reply });
      } catch (error) {
        const failure = error instanceof EntryFailure ? error : new EntryFailure('The request could not be completed. Please retry.');
        publish({ status: 'error', ...intent, message: failure.message,
          retryable: failure.retryable, sessionExpired: failure.sessionExpired });
      }
    })().finally(() => { pending = undefined; });
    return pending;
  }

  function submit(rawIntent: RoomEntryIntent): Promise<void> {
    if (pending) return pending;
    if (state.status === 'pending') return Promise.resolve();
    if (state.status === 'entered' || (state.status === 'error' && state.sessionExpired)) return Promise.resolve();
    // Ambiguous outcomes may only retry their original immutable payload.
    if (state.status === 'error' && state.retryable) return run(state);
    const nickname = normalizeNickname(rawIntent.nickname);
    if (!nickname) return Promise.resolve();
    const roomCode = rawIntent.action === 'join' ? normalizeRoomCode(rawIntent.roomCode) : undefined;
    if (rawIntent.action === 'join' && !roomCode) return Promise.resolve();
    roomRequest = undefined;
    return run(rawIntent.action === 'create' ? { action: 'create', nickname }
      : { action: 'join', nickname, roomCode: roomCode! });
  }

  return {
    getSnapshot: () => state,
    subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    create: (nickname) => submit({ action: 'create', nickname }),
    join: (nickname, roomCode) => submit({ action: 'join', nickname, roomCode }),
    retry: () => pending ?? (state.status === 'error' && state.retryable ? run(state) : Promise.resolve()),
    startNewSession: () => {
      if (pending || state.status !== 'error' || !state.sessionExpired) return;
      sessionReady = false;
      sessionRequest = undefined;
      roomRequest = undefined;
      publish(IDLE);
    },
  };
}
