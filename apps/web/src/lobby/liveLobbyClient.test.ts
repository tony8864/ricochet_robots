import { afterEach, expect, test, vi } from 'vitest';
import { puzzleCatalog } from '@robot-puzzle/puzzles';
import { MAX_SERVER_MESSAGE_BYTES, type PublicRoomState } from '@robot-puzzle/shared';
import { entryTestId, roomEnteredFixture, preparingRoomFixture } from '../entry/roomEntry.testFixture';
import { liveLobbyClient, type LiveLobbyClient, type LobbySocketHandlers } from './liveLobbyClient';

const clients: LiveLobbyClient[] = [];
afterEach(() => { clients.splice(0).forEach((client) => client.disconnect()); vi.useRealTimers(); });

function setup(isHost = true) {
  const base = roomEnteredFixture(entryTestId(1));
  const host = { seatId: entryTestId(110), nickname: 'Host', connected: true };
  const entry = isHost ? base : { ...base, state: { ...base.state,
    hostSeatId: host.seatId, players: [host, ...base.state.players] } };
  let next = 500;
  const sockets: Array<{ handlers: LobbySocketHandlers; sent: string[]; close: ReturnType<typeof vi.fn> }> = [];
  const socket = vi.fn((url: string, handlers: LobbySocketHandlers) => {
    const sent: string[] = [];
    const close = vi.fn();
    sockets.push({ handlers, sent, close });
    return { close, send: (text: string) => { sent.push(text); } };
  });
  const client = liveLobbyClient(entry, { socket, origin: () => 'https://localhost:5173',
    commandId: () => entryTestId(next++), timeoutMs: 100 });
  clients.push(client);
  const message = (value: unknown, index = sockets.length - 1) => sockets[index]!.handlers.message(JSON.stringify(value));
  const initialRoom: PublicRoomState = { ...entry.state, revision: 2,
    players: entry.state.players.map((player) => ({ ...player, connected: true })) };
  const bind = (room: PublicRoomState = initialRoom) => message({ version: 1, type: 'session.bound',
    roomId: entry.roomId, seatId: entry.seatId, state: room, serverTimeMs: 100 });
  const snapshot = (room: PublicRoomState) => message({ version: 1, type: 'room.snapshot', state: room, serverTimeMs: 100 });
  const result = (revision = 3, outcome: object = { status: 'accepted' }) => {
    const request = JSON.parse(sockets.at(-1)!.sent.at(-1)!);
    message({ version: 1, type: 'command.result', roomId: entry.roomId, commandId: request.commandId,
      outcome, processedRevision: revision, currentRevision: revision, duplicate: false, serverTimeMs: 100 });
  };
  return { entry, client, sockets, socket, initialRoom, bind, message, snapshot, result };
}

test('opens only explicit same-origin WSS and enables actions after the private binding', () => {
  const { client, socket, bind, entry } = setup();
  client.shuffle();
  expect(socket).not.toHaveBeenCalled();
  client.connect();
  client.connect();
  expect(socket).toHaveBeenCalledTimes(1);
  expect(socket.mock.calls[0]![0]).toBe(`wss://localhost:5173/api/rooms/${entry.roomId}/socket`);
  expect(client.getSnapshot().connection).toBe('connecting');
  bind();
  expect(client.getSnapshot().connection).toBe('connected');
  expect(client.getSnapshot().room.players[0]!.connected).toBe(true);
});

test('host shuffle sends current lobby context, never edits the board optimistically, and waits for its snapshot', () => {
  const { client, sockets, bind, initialRoom, result, snapshot } = setup();
  client.connect(); bind(); client.shuffle(); client.shuffle();
  expect(sockets[0]!.sent).toHaveLength(1);
  const request = JSON.parse(sockets[0]!.sent[0]!);
  expect(request.command).toEqual({ type: 'board.shuffle' });
  expect(request.context).toEqual({ lobbyId: initialRoom.status === 'lobby' ? initialRoom.lobbyId : '' });
  expect(client.getSnapshot().room.puzzle.id).toBe(initialRoom.puzzle.id);
  result(3);
  expect(client.getSnapshot().shuffle).toBe('pending');
  const next = { ...initialRoom, revision: 3, puzzle: puzzleCatalog.find((puzzle) => puzzle.id !== initialRoom.puzzle.id)! };
  snapshot(next);
  expect(client.getSnapshot()).toMatchObject({ shuffle: 'idle', room: { revision: 3, puzzle: { id: next.puzzle.id } } });
});

test('guest cannot send shuffle and live joins/connection flags come from snapshots', () => {
  const { client, sockets, bind, initialRoom, snapshot } = setup(false);
  client.connect(); bind(); client.shuffle();
  expect(sockets[0]!.sent).toHaveLength(0);
  snapshot({ ...initialRoom, revision: 3, players: [...initialRoom.players,
    { seatId: entryTestId(111), nickname: 'Friend', connected: false }] });
  expect(client.getSnapshot().room.players).toHaveLength(3);
  expect(client.getSnapshot().room.players[2]!.connected).toBe(false);
});

test('ignores older snapshots and accepts identical equal-revision snapshots', () => {
  const { client, bind, snapshot, initialRoom } = setup();
  client.connect(); bind();
  snapshot({ ...initialRoom, revision: 1 });
  expect(client.getSnapshot().room.revision).toBe(2);
  snapshot(initialRoom);
  expect(client.getSnapshot().connection).toBe('connected');
});

test('equal-revision conflict fails closed, then an explicit rebind resynchronizes without merging', () => {
  const { client, bind, snapshot, initialRoom } = setup();
  client.connect(); bind();
  const conflicting = { ...initialRoom, players: initialRoom.players.map((player) => ({ ...player, connected: false })) };
  snapshot(conflicting);
  expect(client.getSnapshot().connection).toBe('error');
  expect(client.getSnapshot().room.players[0]!.connected).toBe(true);
  client.connect(); bind(conflicting);
  expect(client.getSnapshot().connection).toBe('connected');
  expect(client.getSnapshot().room.players[0]!.connected).toBe(false);
});

test.each(['binary', 'malformed', 'oversized', 'wrong-room', 'wrong-seat', 'snapshot-before-binding'])('rejects %s incoming data', (kind) => {
  const { client, sockets, message, initialRoom, entry, snapshot } = setup();
  client.connect();
  if (kind === 'binary') sockets[0]!.handlers.message(new ArrayBuffer(1));
  else if (kind === 'malformed') sockets[0]!.handlers.message('{');
  else if (kind === 'oversized') sockets[0]!.handlers.message(' '.repeat(MAX_SERVER_MESSAGE_BYTES + 1));
  else if (kind === 'snapshot-before-binding') snapshot(initialRoom);
  else message({ version: 1, type: 'session.bound', roomId: kind === 'wrong-room' ? entryTestId(999) : entry.roomId,
    seatId: kind === 'wrong-seat' ? entryTestId(999) : entry.seatId, state: initialRoom, serverTimeMs: 100 });
  expect(client.getSnapshot().connection).toBe('error');
  expect(sockets[0]!.close).toHaveBeenCalled();
});

test('late socket events after cleanup/reconnect cannot overwrite the active room', () => {
  const { client, sockets, bind, snapshot, initialRoom } = setup();
  client.connect(); bind(); client.disconnect(); client.connect(); bind();
  sockets[0]!.handlers.closed(1008);
  sockets[0]!.handlers.message(JSON.stringify({ version: 1, type: 'room.snapshot', serverTimeMs: 100,
    state: { ...initialRoom, revision: 99 } }));
  snapshot({ ...initialRoom, revision: 3 });
  expect(client.getSnapshot().connection).toBe('connected');
  expect(client.getSnapshot().room.revision).toBe(3);
});

test('lost shuffle ack times out to explicit retry with the exact same ID/payload', async () => {
  vi.useFakeTimers();
  const { client, sockets, bind, snapshot, result, initialRoom } = setup();
  client.connect(); bind(); client.shuffle();
  snapshot({ ...initialRoom, revision: 3 }); // A snapshot alone does not acknowledge our command.
  await vi.advanceTimersByTimeAsync(100);
  expect(client.getSnapshot().shuffle).toBe('retry');
  client.shuffle();
  expect(sockets[0]!.sent).toHaveLength(2);
  expect(sockets[0]!.sent[1]).toBe(sockets[0]!.sent[0]);
  result(3);
  expect(client.getSnapshot().shuffle).toBe('idle');
});

test('disconnect requires explicit reconnect; unacknowledged shuffle remains retryable after rebind', () => {
  const { client, sockets, socket, bind, initialRoom } = setup();
  client.connect(); bind(); client.shuffle();
  sockets[0]!.handlers.closed(1006);
  client.shuffle();
  expect(socket).toHaveBeenCalledTimes(1);
  expect(client.getSnapshot()).toMatchObject({ connection: 'disconnected', shuffle: 'retry' });
  client.connect(); bind({ ...initialRoom, revision: 3 }); client.shuffle();
  expect(sockets[1]!.sent[0]).toBe(sockets[0]!.sent[0]);
});

test('rejected shuffle never changes the board and shows safe feedback after synchronization', () => {
  const { client, bind, result, initialRoom } = setup();
  client.connect(); bind(); client.shuffle(); result(2, { status: 'rejected', reason: 'not-host' });
  expect(client.getSnapshot()).toMatchObject({ shuffle: 'idle', actionError: 'Only the host can shuffle the board.' });
  expect(client.getSnapshot().room.puzzle.id).toBe(initialRoom.puzzle.id);
});

test('session expiry and room closure stop actions without silently issuing a new identity', () => {
  const { client, sockets, bind, socket } = setup();
  client.connect(); bind(); sockets[0]!.handlers.closed(1008); client.connect(); client.shuffle();
  expect(client.getSnapshot().connection).toBe('expired');
  expect(socket).toHaveBeenCalledTimes(1);
  const other = setup(); other.client.connect(); other.bind();
  other.message({ version: 1, type: 'room.closed', roomId: other.entry.roomId, lastRevision: 2, reason: 'expired', serverTimeMs: 100 });
  expect(other.client.getSnapshot().connection).toBe('closed');
});

test('handshake timeout is bounded and listener cleanup does not leak updates', async () => {
  vi.useFakeTimers();
  const { client } = setup();
  const listener = vi.fn();
  const unsubscribe = client.subscribe(listener);
  client.connect(); unsubscribe();
  const calls = listener.mock.calls.length;
  await vi.advanceTimersByTimeAsync(100);
  expect(client.getSnapshot().connection).toBe('disconnected');
  expect(listener).toHaveBeenCalledTimes(calls);
});

const withGuest = (room: PublicRoomState): PublicRoomState => ({ ...room,
  players: [...room.players, { seatId: entryTestId(111), nickname: 'Guest', connected: false }] });

test('Start needs bound current host and two seats, not two online connections', () => {
  const { client, bind, initialRoom, sockets } = setup();
  client.start(); client.connect(); bind(); client.start();
  expect(sockets[0]!.sent).toHaveLength(0);
  const guest = setup(false); guest.client.connect(); guest.bind(); guest.client.start();
  expect(guest.sockets[0]!.sent).toHaveLength(0);
  // Start becomes possible after an ordinary newer roster snapshot; no exact revision precondition.
  const room = { ...withGuest(initialRoom), revision: 3 };
  const message = { version: 1, type: 'room.snapshot', state: room, serverTimeMs: 100 };
  sockets[0]!.handlers.message(JSON.stringify(message));
  client.start();
  const request = JSON.parse(sockets[0]!.sent[0]!);
  expect(request.command).toEqual({ type: 'room.start', boardId: room.puzzle.id });
  expect(request.context).toEqual({ lobbyId: room.status === 'lobby' ? room.lobbyId : '' });
  expect(request).not.toHaveProperty('revision');
});

test('Start and Shuffle serialize and only snapshots enter Preparing', () => {
  const { client, bind, initialRoom, sockets, result, snapshot } = setup();
  const room = withGuest(initialRoom);
  client.connect(); bind(room); client.start(); client.shuffle(); client.start();
  expect(sockets[0]!.sent).toHaveLength(1);
  expect(client.getSnapshot()).toMatchObject({ start: 'pending', shuffle: 'idle', room: { status: 'lobby' } });
  result(3);
  expect(client.getSnapshot().room.status).toBe('lobby');
  snapshot(preparingRoomFixture(room));
  expect(client.getSnapshot()).toMatchObject({ start: 'idle', room: { status: 'playing', match: { phase: 'preparing' } } });
  client.start(); client.shuffle();
  expect(sockets[0]!.sent).toHaveLength(1);
});

test('a pending shuffle also blocks Start', () => {
  const { client, bind, initialRoom, sockets } = setup();
  client.connect(); bind(withGuest(initialRoom)); client.shuffle(); client.start();
  expect(sockets[0]!.sent).toHaveLength(1);
  expect(client.getSnapshot()).toMatchObject({ shuffle: 'pending', start: 'idle' });
});

test('lost Start acknowledgment can be exactly retried from Preparing after reconnect without another match', async () => {
  vi.useFakeTimers();
  const { client, bind, initialRoom, sockets, snapshot, result } = setup();
  const room = withGuest(initialRoom);
  client.connect(); bind(room); client.start();
  const original = sockets[0]!.sent[0];
  snapshot(preparingRoomFixture(room));
  await vi.advanceTimersByTimeAsync(100);
  expect(client.getSnapshot().start).toBe('retry');
  sockets[0]!.handlers.closed(1006);
  client.connect(); bind(preparingRoomFixture(room));
  client.shuffle(); // A different action cannot replace the unresolved Start.
  expect(sockets[1]!.sent).toHaveLength(0);
  client.retry();
  expect(sockets[1]!.sent[0]).toBe(original);
  result(3);
  expect(client.getSnapshot().start).toBe('idle');
  client.start();
  expect(sockets[1]!.sent).toHaveLength(1);
});

test.each([
  ['preview-changed', 'preview board changed'], ['not-enough-players', 'At least two'], ['not-host', 'Only the host'],
])('Start rejection %s gives safe feedback without entering Preparing', (reason, text) => {
  const { client, bind, initialRoom, result } = setup();
  client.connect(); bind(withGuest(initialRoom)); client.start();
  result(2, { status: 'rejected', reason });
  expect(client.getSnapshot()).toMatchObject({ start: 'idle', room: { status: 'lobby' } });
  expect(client.getSnapshot().actionError).toContain(text);
});
