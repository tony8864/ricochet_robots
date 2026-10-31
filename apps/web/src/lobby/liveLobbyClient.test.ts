import { afterEach, expect, test, vi } from 'vitest';
import { puzzleCatalog } from '@robot-puzzle/puzzles';
import { MAX_SERVER_MESSAGE_BYTES, type PublicRoomState } from '@robot-puzzle/shared';
import { entryTestId, roomEnteredFixture, preparingRoomFixture, failedPreparationFixture, thinkingRoomFixture, biddingRoomFixture, demonstratingRoomFixture } from '../entry/roomEntry.testFixture';
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
    commandId: () => entryTestId(next++), timeoutMs: 100, now: () => Date.now() });
  clients.push(client);
  const message = (value: unknown, index = sockets.length - 1) => sockets[index]!.handlers.message(JSON.stringify(value));
  const initialRoom: PublicRoomState = { ...entry.state, revision: 2,
    players: entry.state.players.map((player) => ({ ...player, connected: true })) };
  const bind = (room: PublicRoomState = initialRoom) => message({ version: 1, type: 'session.bound',
    roomId: entry.roomId, seatId: entry.seatId, state: room, serverTimeMs: 100 });
  const snapshot = (room: PublicRoomState, serverTimeMs = 100) => message({ version: 1, type: 'room.snapshot', state: room, serverTimeMs });
  const result = (revision = 3, outcome: object = { status: 'accepted' }) => {
    const request = JSON.parse(sockets.at(-1)!.sent.at(-1)!);
    message({ version: 1, type: 'command.result', roomId: entry.roomId, commandId: request.commandId,
      outcome, processedRevision: revision, currentRevision: revision, duplicate: false, serverTimeMs: 100 });
  };
  return { entry, client, sockets, socket, initialRoom, bind, message, snapshot, result };
}

test('preparation Retry waits for server-relative cooldown, sends exact context once and awaits authoritative state', async () => {
  vi.useFakeTimers();
  const { client, bind, initialRoom, sockets, result, snapshot } = setup();
  const failed = failedPreparationFixture(withGuest(initialRoom));
  client.connect(); bind(failed);
  client.retryPreparation();
  expect(sockets[0].sent).toHaveLength(0);
  await vi.advanceTimersByTimeAsync(4999);
  expect(client.getSnapshot().canRetryPreparation).toBe(false);
  await vi.advanceTimersByTimeAsync(1);
  expect(client.getSnapshot().canRetryPreparation).toBe(true);
  client.retryPreparation(); client.retryPreparation(); client.start(); client.shuffle();
  expect(sockets[0].sent).toHaveLength(1);
  const request = JSON.parse(sockets[0].sent[0]);
  expect(request.command).toEqual({ type: 'preparation.retry' });
  expect(request.context).toEqual({ matchId: entryTestId(200), preparationId: entryTestId(201) });
  expect(client.getSnapshot().room).toEqual(failed);
  result(4);
  expect(client.getSnapshot().preparation).toBe('pending');
  const working = preparingRoomFixture(withGuest(initialRoom));
  snapshot({ ...working, revision: 4 });
  expect(client.getSnapshot().preparation).toBe('idle');
  expect(client.getSnapshot().canRetryPreparation).toBe(false);
});

test('lost retry acknowledgment resends the original request after reconnect and Thinking, never a fresh job', async () => {
  vi.useFakeTimers();
  const { client, bind, initialRoom, sockets, snapshot, result } = setup();
  const failed = failedPreparationFixture(withGuest(initialRoom));
  client.connect(); bind(failed);
  await vi.advanceTimersByTimeAsync(5000);
  client.retryPreparation();
  const original = sockets[0].sent[0];
  const thinking = { ...thinkingRoomFixture(failed), revision: 5 };
  snapshot(thinking);
  await vi.advanceTimersByTimeAsync(100);
  expect(client.getSnapshot().preparation).toBe('retry');
  sockets[0].handlers.closed(1006);
  client.connect(); bind(thinking);
  sockets[0].handlers.message(JSON.stringify({ version: 1, type: 'room.snapshot', state: failed, serverTimeMs: 10000 }));
  client.retryPreparation(); // Exact pending retry is allowed even though phase advanced.
  expect(sockets[1].sent[0]).toBe(original);
  result(5);
  expect(client.getSnapshot()).toMatchObject({ preparation: 'idle', room: { match: { phase: 'thinking' } } });
  client.retryPreparation();
  expect(sockets[1].sent).toHaveLength(1);
});

test.each(['guest', 'unavailable', 'working', 'disconnected', 'no-metadata'])('%s cannot create a preparation retry', async (kind) => {
  vi.useFakeTimers();
  const { client, initialRoom, bind, sockets } = setup(kind !== 'guest');
  let room = kind === 'working' ? preparingRoomFixture(withGuest(initialRoom))
    : failedPreparationFixture(withGuest(initialRoom), kind === 'unavailable' ? 'unavailable' : 'error');
  if (kind === 'no-metadata' && room.status === 'playing' && room.match.phase === 'preparing') room = {
    ...room, match: { ...room.match, preparation: { status: 'error' } },
  };
  client.connect(); bind(room);
  await vi.advanceTimersByTimeAsync(5000);
  if (kind === 'disconnected') client.disconnect();
  client.retryPreparation();
  expect(sockets[0].sent).toHaveLength(0);
});

test('newer working snapshot cancels cooldown; stale failed snapshot cannot re-enable Retry', async () => {
  vi.useFakeTimers();
  const { client, bind, initialRoom, snapshot } = setup();
  const base = withGuest(initialRoom);
  const failed = failedPreparationFixture(base);
  client.connect(); bind(failed);
  const working = { ...preparingRoomFixture(base), revision: 4 };
  snapshot(working); snapshot(failed);
  await vi.advanceTimersByTimeAsync(10000);
  expect(client.getSnapshot().canRetryPreparation).toBe(false);
  expect(client.getSnapshot().room).toEqual(working);
});

test('server rejection clears preparation pending state with safe feedback', async () => {
  vi.useFakeTimers();
  const { client, bind, initialRoom, result } = setup();
  client.connect(); bind(failedPreparationFixture(withGuest(initialRoom)));
  await vi.advanceTimersByTimeAsync(5000);
  client.retryPreparation();
  result(3, { status: 'rejected', reason: 'preparation-cooldown' });
  expect(client.getSnapshot().preparation).toBe('idle');
  expect(client.getSnapshot().actionError).toContain('not ready yet');
});

test.each([true, false])('host=%s can submit an independent bid only after binding, with no optimistic accepted bid', (isHost) => {
  const { client, bind, initialRoom, sockets, snapshot, result } = setup(isHost);
  const room = withGuest(initialRoom);
  const thinking = thinkingRoomFixture(room);
  client.placeBid(7);
  client.connect(); bind(thinking);
  client.placeBid(7); client.placeBid(6);
  expect(sockets[0].sent).toHaveLength(1);
  const request = JSON.parse(sockets[0].sent[0]);
  expect(request.context).toEqual({ matchId: entryTestId(200), roundNumber: 1 });
  expect(request.command).toEqual({ type: 'bid.submit', value: 7 });
  expect(client.getSnapshot()).toMatchObject({ bid: 'pending', room: { match: { phase: 'thinking' } } });
  result(4);
  expect(client.getSnapshot().bid).toBe('pending');
  snapshot({ ...biddingRoomFixture(room), revision: 4 });
  expect(client.getSnapshot().bid).toBe('idle');
});

test('only lower own accepted bids are sent; another higher bid is allowed by independent seat rules', () => {
  const { client, bind, initialRoom, sockets, result, snapshot } = setup();
  const room = withGuest(initialRoom);
  const bidding = biddingRoomFixture(room, [7, 3]);
  client.connect(); bind(bidding);
  client.placeBid(8); client.placeBid(7); client.placeBid(0); client.placeBid(1.5);
  expect(sockets[0].sent).toHaveLength(0);
  client.placeBid(5);
  expect(JSON.parse(sockets[0].sent[0]).command.value).toBe(5);
  result(4);
  snapshot({ ...biddingRoomFixture(room, [5, 3]), revision: 4 });
  expect(client.getSnapshot().room).toMatchObject({ match: { bids: [{ value: 5 }, { value: 3 }] } });
});

test('local deadline disables new bids but never creates a Demonstrating phase or sends a controller command', async () => {
  vi.useFakeTimers();
  const { client, bind, initialRoom, sockets } = setup();
  client.connect(); bind(biddingRoomFixture(withGuest(initialRoom)));
  expect(client.getServerNow()).toBe(100);
  await vi.advanceTimersByTimeAsync(60000);
  expect(client.getSnapshot().bidWindowOpen).toBe(false);
  expect(client.getSnapshot().room).toMatchObject({ match: { phase: 'bidding' } });
  client.placeBid(3);
  expect(sockets[0].sent).toHaveLength(0);
});

test('duplicate snapshots with the same send time cannot restart the countdown estimate', async () => {
  vi.useFakeTimers();
  const { client, bind, initialRoom, snapshot } = setup();
  const bidding = biddingRoomFixture(withGuest(initialRoom));
  client.connect(); bind(bidding);
  await vi.advanceTimersByTimeAsync(30000);
  snapshot(bidding);
  expect(client.getServerNow()).toBe(30100);
  await vi.advanceTimersByTimeAsync(30000);
  expect(client.getSnapshot().bidWindowOpen).toBe(false);
});

test('lost bid reply can be retried exactly after reconnect into Demonstrating', async () => {
  vi.useFakeTimers();
  const { client, bind, initialRoom, sockets, snapshot, result } = setup();
  const room = withGuest(initialRoom);
  client.connect(); bind(thinkingRoomFixture(room));
  client.placeBid(7);
  const original = sockets[0].sent[0];
  const demo = { ...demonstratingRoomFixture(room), revision: 5 };
  snapshot(demo, 60100);
  await vi.advanceTimersByTimeAsync(100);
  expect(client.getSnapshot().bid).toBe('retry');
  sockets[0].handlers.closed(1006);
  client.connect(); bind(demo);
  client.placeBid(3);
  expect(sockets[1].sent).toHaveLength(0);
  client.retry();
  expect(sockets[1].sent[0]).toBe(original);
  result(5);
  expect(client.getSnapshot().bid).toBe('idle');
});

test.each(['bid-increase', 'bidding-closed', 'invalid-bid'])('bid rejection %s is explicit and never updates accepted values optimistically', (reason) => {
  const { client, bind, initialRoom, result } = setup();
  client.connect(); bind(thinkingRoomFixture(withGuest(initialRoom)));
  client.placeBid(7);
  result(3, { status: 'rejected', reason });
  expect(client.getSnapshot().bid).toBe('idle');
  expect(client.getSnapshot().actionError).not.toBe('');
  expect(client.getSnapshot().room).toMatchObject({ match: { phase: 'thinking' } });
});

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
