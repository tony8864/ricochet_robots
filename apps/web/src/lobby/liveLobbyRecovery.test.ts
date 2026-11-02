import { afterEach, expect, test, vi } from 'vitest';
import type { PublicRoomState } from '@robot-puzzle/shared';
import { roomEnteredFixture, entryTestId, demonstratingRoomFixture } from '../entry/roomEntry.testFixture';
import { liveLobbyClient, type LiveLobbyClient, type LobbySocketHandlers } from './liveLobbyClient';
import type { ResumeResult } from '../entry/resumeRoom';
import { recoveryFixture } from './recovery.testFixture';
import { reconnectDelay } from './recoveryEnvironment';

const clients: LiveLobbyClient[] = [];
afterEach(() => { for (const client of clients.splice(0)) client.disconnect(); vi.useRealTimers(); });
function setup(options: { guest?: boolean; heartbeats?: boolean; resume?: (roomId: string, signal: AbortSignal) => Promise<ResumeResult> } = {}) {
  vi.useFakeTimers(); vi.setSystemTime(0);
  const f = recoveryFixture();
  const base = roomEnteredFixture(entryTestId(1));
  const host = { seatId: entryTestId(110), nickname: 'Host', connected: true };
  const entry = options.guest ? { ...base, membership: 'joined' as const,
    state: { ...base.state, hostSeatId: host.seatId, players: [host, ...base.state.players] } } : base;
  const room = { ...entry.state, revision: 2, players: entry.state.players.map((p) => ({ ...p, connected: true })) };
  const resumed = { ...entry, membership: 'resumed' as const, state: room };
  const resume = vi.fn(options.resume ?? (async () => ({ status: 'resumed' as const, entry: resumed })));
  const sockets: Array<{ handlers: LobbySocketHandlers; sent: string[]; close: ReturnType<typeof vi.fn> }> = [];
  let serial = 500;
  const make = (input = entry) => {
    const client = liveLobbyClient(input, { origin: () => 'https://localhost:5173', now: () => Date.now(),
      commandId: () => entryTestId(serial++), confirm: () => true, timeoutMs: 1000,
      automatic: true, heartbeats: options.heartbeats ?? false, environment: f.environment,
      recovery: f.recovery, random: () => 0.5, resume,
      socket: (_url, handlers) => { const sent: string[] = []; const close = vi.fn(); sockets.push({ handlers, sent, close }); return { close, send: (text) => sent.push(text) }; } });
    clients.push(client); return client;
  };
  const client = make();
  const bind = (state: PublicRoomState = room, index = sockets.length - 1) => sockets[index].handlers.message(JSON.stringify({ version: 2,
    type: 'session.bound', roomId: entry.roomId, seatId: entry.seatId, connectionId: entryTestId(800 + index), state, serverTimeMs: 100 }));
  return { ...f, entry, room, resumed, client, make, bind, sockets, resume };
}

test.each([false, true])('guest departure closes only this client, blocks recovery and preserves pending ID (offline=%s)', async (offline) => {
  const f = setup({ guest: true, heartbeats: true });
  const demo = demonstratingRoomFixture(f.room);
  f.client.connect(); f.bind(demo); f.client.move('red', 'up');
  const request = f.recovery.read()!.pending!;
  const sent = [...f.sockets[0].sent];
  if (offline) f.emit('offline');
  expect(f.client.leave()).toBe(true);
  expect(f.client.leave()).toBe(false);
  expect(f.recovery.read()).toMatchObject({ autoResume: false, pending: request });
  expect(f.listeners.size).toBe(0); expect(f.sockets[0].close).toHaveBeenCalledOnce();
  f.client.connect(); f.client.retry(); f.client.giveUp(); f.emit('online'); f.emit('resume');
  f.sockets[0].handlers.closed(1008); f.sockets[0].handlers.message('{');
  await vi.advanceTimersByTimeAsync(120000);
  expect(f.resume).not.toHaveBeenCalled(); expect(f.sockets).toHaveLength(1);
  expect(f.sockets[0].sent).toEqual(sent);
  expect(f.client.getSnapshot().room).toEqual(demo);
  expect(f.client.getSnapshot().message).toBe('You left the room.');
  // Explicit entry with the same authenticated seat retrieves the exact request.
  if (offline) f.emit('online');
  const rejoined = f.make({ ...f.resumed, state: demo }); rejoined.connect(); f.bind(demo);
  expect(f.recovery.read()?.autoResume).toBeUndefined();
  expect(rejoined.getSnapshot().attempt).toBe('retry');
  expect(f.sockets[1].sent.every((text) => JSON.parse(text).type === 'connection.ping')).toBe(true);
  rejoined.retry(); expect(JSON.parse(f.sockets[1].sent.at(-1)!)).toEqual(request);
});

test('guest can leave without an outstanding action; host leave is always rejected', () => {
  const host = setup(); host.client.connect(); host.bind();
  expect(host.client.leave()).toBe(false); expect(host.sockets[0].close).not.toHaveBeenCalled();
  expect(host.recovery.read()?.autoResume).toBeUndefined();
  const guest = setup({ guest: true }); guest.client.connect(); guest.bind();
  expect(guest.client.leave()).toBe(true);
  expect(guest.recovery.read()).toMatchObject({ autoResume: false, pending: null });
  expect(guest.sockets[0].sent).toEqual([]);
});

test('blocked storage refuses departure rather than losing retry data or unexpectedly auto-rejoining on refresh', () => {
  const f = setup({ guest: true }); f.client.connect(); f.bind();
  f.storage.setItem.mockImplementation(() => { throw new Error('blocked'); });
  expect(f.client.leave()).toBe(false);
  expect(f.client.getSnapshot().connection).toBe('connected');
  expect(f.client.getSnapshot().actionError).toContain('You are still in the room.');
  expect(f.sockets[0].close).not.toHaveBeenCalled();
});

test('lost connection resumes automatically, coalesces triggers and stays read-only until private bind', async () => {
  const f = setup(); f.client.connect(); f.bind();
  f.sockets[0].handlers.closed(1006);
  f.client.connect(); f.client.connect(); f.emit('resume');
  await vi.advanceTimersByTimeAsync(0);
  expect(f.resume).toHaveBeenCalledTimes(1); expect(f.sockets).toHaveLength(2);
  expect(f.client.getSnapshot().connection).toBe('connecting');
  f.client.shuffle(); f.client.placeBid(1); f.client.giveUp(); expect(f.sockets[1].sent).toEqual([]);
  f.bind(); expect(f.client.getSnapshot().connection).toBe('connected');
  const current = f.client.getSnapshot();
  f.sockets[0].handlers.closed(1008); f.sockets[0].handlers.message('{');
  expect(f.client.getSnapshot()).toBe(current);
});

test('offline pauses recovery; resume replaces a stale socket and aborts/ignores old HTTP callbacks', async () => {
  let finish: ((value: ResumeResult) => void) | undefined;
  const f = setup({ resume: (_id, _signal) => new Promise((resolve) => { finish = resolve; }) });
  f.client.connect(); f.bind(); f.emit('resume'); await vi.advanceTimersByTimeAsync(0);
  const signal = f.resume.mock.calls[0][1]; expect(f.sockets[0].close).toHaveBeenCalledOnce();
  f.emit('offline'); expect(signal.aborted).toBe(true);
  finish!({ status: 'resumed', entry: f.resumed }); await vi.advanceTimersByTimeAsync(20000);
  expect(f.sockets).toHaveLength(1); expect(f.client.getSnapshot().connection).toBe('disconnected');
  f.emit('online'); await vi.advanceTimersByTimeAsync(0); expect(f.resume).toHaveBeenCalledTimes(2);
  f.client.disconnect(); finish!({ status: 'resumed', entry: f.resumed }); await vi.advanceTimersByTimeAsync(30000);
  expect(f.sockets).toHaveLength(1); expect(f.listeners.size).toBe(0);
});

test('HTTP probes stay ten seconds apart despite repeated manual/online triggers and retry jitter is bounded', async () => {
  const f = setup({ resume: async () => ({ status: 'transient', message: 'Unavailable.' }) });
  f.client.connect(); f.bind(); f.sockets[0].handlers.failed(); await vi.advanceTimersByTimeAsync(0);
  expect(f.resume).toHaveBeenCalledTimes(1);
  for (let n = 0; n < 10; n++) { f.client.connect(); f.emit('online'); }
  await vi.advanceTimersByTimeAsync(9999); expect(f.resume).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1); expect(f.resume).toHaveBeenCalledTimes(2);
  for (const random of [0, 0.5, 1]) for (let step = 0; step < 15; step++) {
    const delay = reconnectDelay(step, () => random); expect(delay).toBeGreaterThanOrEqual(0); expect(delay).toBeLessThanOrEqual(15000);
  }
});

test('watchdog replaces silent transport without queuing actions or treating outbound pings as replies', async () => {
  const f = setup({ heartbeats: true }); f.client.connect(); f.bind();
  await vi.advanceTimersByTimeAsync(30001); // Flush the zero-delay reconnect queued by the watchdog.
  expect(f.sockets[0].close).toHaveBeenCalledOnce(); expect(f.resume).toHaveBeenCalledTimes(1);
  expect(f.sockets[0].sent.every((text) => JSON.parse(text).type === 'connection.ping')).toBe(true);
  expect(f.client.getSnapshot().connection).toBe('connecting');
});

test('known offline state rejects inputs even before the browser offline event is delivered', () => {
  const f = setup(); f.client.connect(); f.bind();
  vi.spyOn(f.environment, 'online').mockReturnValue(false);
  f.client.shuffle(); f.client.placeBid(1); f.client.move('red', 'right');
  expect(f.client.getSnapshot().connection).toBe('disconnected');
  expect(f.sockets[0].sent).toEqual([]); expect(f.recovery.read()?.pending).toBeNull();
});

test.each([1008, 1002])('terminal/policy close %i stops retries and lifecycle listeners', async (code) => {
  const f = setup(); f.client.connect(); f.bind(); f.sockets[0].handlers.closed(code);
  f.emit('online'); f.emit('resume'); await vi.advanceTimersByTimeAsync(120000);
  expect(f.resume).not.toHaveBeenCalled(); expect(f.listeners.size).toBe(0);
  const terminal = f.client.getSnapshot();
  vi.spyOn(f.environment, 'online').mockReturnValue(false);
  f.client.shuffle(); f.client.giveUp(); f.client.returnToLobby();
  expect(f.client.getSnapshot()).toBe(terminal);
  f.client.connect(); expect(f.sockets).toHaveLength(1);
});

test('malformed messages fail closed without automatic loops, but explicit resync is allowed', async () => {
  const f = setup(); f.client.connect(); f.bind(); f.sockets[0].handlers.message('{');
  await vi.advanceTimersByTimeAsync(60000); expect(f.resume).not.toHaveBeenCalled();
  f.client.connect(); await vi.advanceTimersByTimeAsync(0); expect(f.resume).toHaveBeenCalledOnce();
});

test('refresh retains an unresolved action ID/context, snaps fresh state and requires explicit exact retry', () => {
  const f = setup();
  const players = [...f.room.players, { seatId: entryTestId(111), nickname: 'Guest', connected: true }];
  const demo = demonstratingRoomFixture({ ...f.room, players });
  if (demo.status !== 'playing' || demo.match.phase !== 'demonstrating') throw new Error('Expected attempt');
  const active = { ...demo, match: { ...demo.match, activeBidderIndex: 1 } };
  f.client.connect(); f.bind(active); f.client.move('red', 'up');
  const original = JSON.parse(f.sockets[0].sent[0]);
  f.client.disconnect();
  const refreshed = f.make({ ...f.resumed, state: active }); refreshed.connect(); f.bind(active);
  expect(refreshed.getSnapshot().attempt).toBe('retry'); expect(refreshed.getSnapshot().boardEpoch).toBeGreaterThan(0);
  expect(f.sockets[1].sent).toEqual([]); refreshed.move('blue', 'left'); expect(f.sockets[1].sent).toEqual([]);
  refreshed.retry(); expect(JSON.parse(f.sockets[1].sent[0])).toEqual(original);
  f.sockets[1].handlers.message(JSON.stringify({ version: 2, type: 'command.result', roomId: f.entry.roomId,
    commandId: original.commandId, outcome: { status: 'accepted' }, processedRevision: active.revision,
    currentRevision: active.revision, duplicate: true, serverTimeMs: 100 }));
  expect(refreshed.getSnapshot().attempt).toBe('idle'); expect(f.recovery.read()?.pending).toBeNull();
});

test('unavailable storage reports refresh limitation while in-memory exact retry remains safe', async () => {
  const f = setup(); f.storage.setItem.mockImplementation(() => { throw new Error('blocked'); });
  f.client.connect(); f.bind(); f.client.shuffle();
  expect(f.client.getSnapshot().actionError).toContain('Refresh recovery could not be saved');
  const original = f.sockets[0].sent[0]; f.client.disconnect();
  f.client.connect(); await vi.advanceTimersByTimeAsync(0); f.bind();
  expect(f.client.getSnapshot().shuffle).toBe('retry');
  f.client.retry(); expect(f.sockets[1].sent[0]).toBe(original);
});

test.each(['closed', 'expired'] as const)('HTTP resume %s stops retries and clears only this room route', async (status) => {
  const f = setup({ resume: async () => ({ status, message: 'Room/seat unavailable.' }) });
  f.client.connect(); f.bind(); f.sockets[0].handlers.failed(); await vi.advanceTimersByTimeAsync(60000);
  expect(f.resume).toHaveBeenCalledOnce(); expect(f.client.getSnapshot().connection).toBe(status);
  expect(f.recovery.read()).toBeNull(); expect(f.listeners.size).toBe(0);
});
