import { env, SELF, runInDurableObject, runDurableObjectAlarm } from 'cloudflare:test';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { parseServerMessage } from '@robot-puzzle/shared';
import type { ServerMessage, RoomEnteredMessage } from '@robot-puzzle/shared';
import { LiveLobby } from '../src/liveLobby';
import { executeLobbyCommand } from '../src/lobbyCommands';
import type { StoredRoom } from '../src/roomMembership';
import { runPreparationAlarm } from '../src/roomPreparation';

const origin = 'https://localhost:5173';
const registry = () => env.REGISTRY.get(env.REGISTRY.idFromName('registry-v1'));
const stub = (id: string) => env.ROOMS.get(env.ROOMS.idFromName(id));
const rooms = new Set<string>();
const clients: Client[] = [];
async function identity() {
  using opened = await registry().openSession(null);
  if (opened.status !== 'ready' || !opened.credential) throw new Error('Expected identity');
  return { cookie: `__Host-rr-session=${opened.credential}`, token: opened.credential, session: opened.session };
}
async function post(endpoint: string, command: object, cookie: string) {
  const response = await SELF.fetch(`${origin}${endpoint}`, { method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ version: 1, commandId: crypto.randomUUID(), command }) });
  expect(response.status).toBe(200);
  const parsed = parseServerMessage(await response.json());
  if (!parsed.ok || parsed.value.type !== 'room.entered') throw new Error('Expected membership');
  return parsed.value;
}
async function lobby() {
  const host = await identity();
  const room = await post('/api/rooms', { type: 'room.create', nickname: 'Host' }, host.cookie);
  rooms.add(room.roomId);
  return { host, room };
}
const upgrade = (id: string, cookie?: string, headers: Record<string, string> = {}, suffix = '') => SELF.fetch(
  `${origin}/api/rooms/${id}/socket${suffix}`, { headers: { Origin: origin, Upgrade: 'websocket', ...(cookie ? { Cookie: cookie } : {}), ...headers } },
);

class Client {
  readonly messages: ServerMessage[] = [];
  private waiters: Array<{ predicate: (message: ServerMessage) => boolean; resolve: (message: ServerMessage) => void }> = [];
  readonly closed: Promise<number>;
  constructor(readonly ws: WebSocket) {
    this.closed = new Promise((resolve) => ws.addEventListener('close', (event) => {
      if (ws.readyState === WebSocket.CLOSING) ws.close();
      resolve(event.code);
    }));
    ws.addEventListener('message', (event) => {
      const parsed = parseServerMessage(JSON.parse(event.data as string));
      if (!parsed.ok) throw new Error('Invalid socket reply');
      const index = this.waiters.findIndex((entry) => entry.predicate(parsed.value));
      if (index < 0) this.messages.push(parsed.value);
      else this.waiters.splice(index, 1)[0].resolve(parsed.value);
    });
    ws.accept();
  }
  next(predicate: (message: ServerMessage) => boolean): Promise<ServerMessage> {
    const index = this.messages.findIndex(predicate);
    if (index >= 0) return Promise.resolve(this.messages.splice(index, 1)[0]);
    return new Promise((resolve) => this.waiters.push({ predicate, resolve }));
  }
  send(message: unknown) { this.ws.send(JSON.stringify(message)); }
}
async function connect(id: string, cookie: string) {
  const response = await upgrade(id, cookie);
  expect(response.status).toBe(101);
  if (!response.webSocket) throw new Error('Expected socket');
  const client = new Client(response.webSocket);
  clients.push(client);
  const bound = await client.next((m) => m.type === 'session.bound');
  if (bound.type !== 'session.bound') throw new Error('Expected binding');
  return { client, bound };
}
const stateRequest = (roomId: string, commandId = crypto.randomUUID()) => ({
  version: 1, commandId, roomId, context: {}, command: { type: 'state.request' },
} as const);
function shuffle(room: RoomEnteredMessage, commandId = crypto.randomUUID(), lobbyId?: string) {
  if (room.state.status !== 'lobby') throw new Error('Expected lobby');
  return { version: 1, commandId, roomId: room.roomId, context: { lobbyId: lobbyId ?? room.state.lobbyId }, command: { type: 'board.shuffle' } };
}
function start(room: RoomEnteredMessage, commandId = crypto.randomUUID(), boardId = room.state.puzzle.id) {
  if (room.state.status !== 'lobby') throw new Error('Expected lobby');
  return { version: 1, commandId, roomId: room.roomId, context: { lobbyId: room.state.lobbyId }, command: { type: 'room.start', boardId } };
}
async function command<Input extends { readonly commandId: string }>(client: Client, input: Input) {
  client.send(input);
  const reply = await client.next((m) => m.type === 'command.result' && m.commandId === input.commandId);
  if (reply.type !== 'command.result') throw new Error('Expected result');
  return reply;
}

afterEach(async () => {
  for (const client of clients) {
    if (client.ws.readyState === WebSocket.OPEN) client.ws.close(1000);
    await client.closed;
  }
  for (const id of rooms) {
    await runInDurableObject(stub(id), async (instance) => {
      await (instance as unknown as { live: LiveLobby }).live.idle();
    });
  }
  clients.length = 0; rooms.clear(); vi.restoreAllMocks();
});

describe('real lobby WebSockets', () => {
  test('bidding alarm remains armed with no sockets; returning seat sees the already-expired attempt', async () => {
    const now = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now);
    const { host, room } = await lobby();
    const guest = await identity();
    await post('/api/rooms/join', { type: 'room.join', nickname: 'Guest', roomCode: room.state.roomCode }, guest.cookie);
    const a = await connect(room.roomId, host.cookie);
    const b = await connect(room.roomId, guest.cookie);
    await command(a.client, start(room));
    clock.mockReturnValue(now + 1);
    await runDurableObjectAlarm(stub(room.roomId));
    const thinking = await a.client.next((m) => m.type === 'room.snapshot' && m.state.status === 'playing' && m.state.match.phase === 'thinking');
    if (thinking.type !== 'room.snapshot' || thinking.state.status !== 'playing') throw new Error('Expected match');
    await command(a.client, { version: 1, commandId: crypto.randomUUID(), roomId: room.roomId,
      context: { matchId: thinking.state.match.matchId, roundNumber: 1 }, command: { type: 'bid.submit', value: 5 } });
    a.client.ws.close(1000); b.client.ws.close(1000);
    await a.client.closed; await b.client.closed;
    await runInDurableObject(stub(room.roomId), async (instance, ctx) => {
      await (instance as unknown as { live: LiveLobby }).live.idle();
      expect(await ctx.storage.getAlarm()).toBe(now + 60001);
    });
    clock.mockReturnValue(now + 60001);
    await runDurableObjectAlarm(stub(room.roomId));
    const rebound = await connect(room.roomId, guest.cookie);
    expect(rebound.bound.state).toMatchObject({ status: 'playing', match: { phase: 'demonstrating', attempt: { moveCount: 0 } } });
    expect(rebound.bound.state.players).toHaveLength(2);
  });

  test.each([2, 6])('%i clients share accepted bids/deadline and one alarm-driven demonstration', async (count) => {
    const now = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now);
    const { host, room } = await lobby();
    const identities = [host];
    const seats = [room.seatId];
    for (let i = 1; i < count; i++) {
      const guest = await identity();
      const joined = await post('/api/rooms/join', { type: 'room.join', nickname: `Player ${i}`, roomCode: room.state.roomCode }, guest.cookie);
      identities.push(guest); seats.push(joined.seatId);
    }
    const connected = [];
    for (const identity of identities) connected.push(await connect(room.roomId, identity.cookie));
    await command(connected[0].client, start(room));
    clock.mockReturnValue(now + 1);
    await runDurableObjectAlarm(stub(room.roomId));
    const thinking = await connected[0].client.next((m) => m.type === 'room.snapshot' && m.state.status === 'playing' && m.state.match.phase === 'thinking');
    if (thinking.type !== 'room.snapshot' || thinking.state.status !== 'playing' || thinking.state.match.phase !== 'thinking') throw new Error('Expected Thinking');
    const bid = (value: number) => ({ version: 1, commandId: crypto.randomUUID(), roomId: room.roomId,
      context: { matchId: thinking.state.status === 'playing' ? thinking.state.match.matchId : '', roundNumber: 1 }, command: { type: 'bid.submit', value } });
    const first = bid(7);
    const original = await command(connected[0].client, first);
    expect(original.outcome.status).toBe('accepted');
    for (let i = 1; i < count; i++) expect((await command(connected[i].client, bid(7 + i))).outcome.status).toBe('accepted');
    expect((await command(connected[0].client, bid(9))).outcome).toEqual({ status: 'rejected', reason: 'bid-increase' });
    await runInDurableObject(stub(room.roomId), async (_instance, ctx) => {
      expect(await ctx.storage.getAlarm()).toBe(now + 60001);
    });
    clock.mockReturnValue(now + 60000);
    expect((await command(connected[count - 1].client, bid(3))).outcome.status).toBe('accepted');
    clock.mockReturnValue(now + 60001);
    // No client expiry command: the room alarm freezes and broadcasts the queue.
    await runDurableObjectAlarm(stub(room.roomId));
    let expected;
    for (const client of connected) {
      const latest = await client.client.next((m) => m.type === 'room.snapshot' && m.state.status === 'playing' && m.state.match.phase === 'demonstrating');
      if (latest.type !== 'room.snapshot' || latest.state.status !== 'playing' || latest.state.match.phase !== 'demonstrating') throw new Error('Expected demonstration');
      expect(latest.state.match.bidderQueue[0].seatId).toBe(seats[count - 1]);
      expect(latest.state.match.attempt).toMatchObject({ version: 0, moveCount: 0, robots: thinking.state.match.officialRobots });
      if (expected) expect(latest.state).toEqual(expected);
      expected = latest.state;
    }
    expect((await command(connected[1].client, bid(1))).outcome).toEqual({ status: 'rejected', reason: 'bidding-closed' });
    expect(await command(connected[0].client, first)).toMatchObject({ duplicate: true, processedRevision: original.processedRevision, outcome: original.outcome });
    const rebound = await connect(room.roomId, identities[1].cookie);
    expect(rebound.bound.state).toEqual(expected);
  });

  test('host Start schedules one verified Thinking reveal; replay/late actions and rebind preserve it', async () => {
    const startedAt = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(startedAt);
    const { host, room } = await lobby();
    const guest = await identity();
    const joined = await post('/api/rooms/join', { type: 'room.join', nickname: 'Guest', roomCode: room.state.roomCode }, guest.cookie);
    const a = await connect(room.roomId, host.cookie);
    const b = await connect(room.roomId, guest.cookie);
    expect((await command(b.client, start(room))).outcome).toEqual({ status: 'rejected', reason: 'not-host' });
    const request = start(room);
    const accepted = await command(a.client, request);
    expect(accepted.outcome).toEqual({ status: 'accepted' });
    const hostState = await a.client.next((m) => m.type === 'room.snapshot' && m.state.status === 'playing');
    const guestState = await b.client.next((m) => m.type === 'room.snapshot' && m.state.status === 'playing');
    if (hostState.type !== 'room.snapshot' || guestState.type !== 'room.snapshot' || hostState.state.status !== 'playing') throw new Error('Expected started match');
    expect(hostState.state).toEqual(guestState.state);
    expect(hostState.state.match).toMatchObject({ phase: 'preparing', completedRounds: 0, usedTargetIds: [],
      officialRobots: room.state.puzzle.initialRobots, scores: { [room.seatId]: 0, [joined.seatId]: 0 } });
    expect(hostState.state.puzzle).toEqual(room.state.puzzle);
    clock.mockReturnValue(startedAt + 1);
    await runDurableObjectAlarm(stub(room.roomId));
    const thinking = (m: ServerMessage) => m.type === 'room.snapshot' && m.state.status === 'playing' && m.state.match.phase === 'thinking';
    const revealed = await a.client.next(thinking);
    const guestRevealed = await b.client.next(thinking);
    if (revealed.type !== 'room.snapshot') throw new Error('Expected Thinking');
    expect(revealed.state).toEqual(guestRevealed.type === 'room.snapshot' ? guestRevealed.state : null);
    expect(JSON.stringify(revealed)).not.toMatch(/internalProof|candidateOrder|diagnostics|request/);
    expect(b.client.messages.every((m) => m.type === 'room.snapshot')).toBe(true);
    const duplicate = await command(a.client, request);
    expect(duplicate).toMatchObject({ duplicate: true, outcome: { status: 'accepted' }, processedRevision: accepted.processedRevision });
    expect((await command(a.client, start(room))).outcome).toEqual({ status: 'rejected', reason: 'wrong-phase' });
    expect((await command(a.client, { ...request, command: { type: 'board.shuffle' } })).outcome)
      .toEqual({ status: 'rejected', reason: 'command-id-conflict' });
    const resumed = await post(`/api/rooms/${room.roomId}/resume`, { type: 'session.resume', roomId: room.roomId }, guest.cookie);
    expect(resumed.state).toEqual(revealed.state);
    const rebind = await connect(room.roomId, guest.cookie);
    expect(rebind.bound.seatId).toBe(joined.seatId);
    expect(rebind.bound.state).toEqual(revealed.state);
  });

  test('Retry is authenticated, host-only, cooldown-limited and schedules once over WSS', async () => {
    const now = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now);
    const { host, room } = await lobby();
    const guest = await identity();
    await post('/api/rooms/join', { type: 'room.join', nickname: 'Guest', roomCode: room.state.roomCode }, guest.cookie);
    const a = await connect(room.roomId, host.cookie);
    const b = await connect(room.roomId, guest.cookie);
    await command(a.client, start(room));
    clock.mockReturnValue(now + 1);
    await runInDurableObject(stub(room.roomId), async (instance, ctx) => {
      await runPreparationAlarm(ctx.storage, now + 1, () => { throw new Error('secret failure'); });
      await (instance as unknown as { live: LiveLobby }).live.publish();
      const alarm = await ctx.storage.getAlarm();
      // Failed preparation has no due work; the session alarm remains armed.
      expect(alarm).toBe(host.session.expiresAt);
    });
    const failed = await a.client.next((m) => m.type === 'room.snapshot' && m.state.status === 'playing' && m.state.match.phase === 'preparing' && m.state.match.preparation.status === 'error');
    if (failed.type !== 'room.snapshot' || failed.state.status !== 'playing' || failed.state.match.phase !== 'preparing') throw new Error('Expected error');
    const metadata = failed.state.match.preparation.retry!;
    const input = { version: 1, commandId: crypto.randomUUID(), roomId: room.roomId,
      context: { matchId: failed.state.match.matchId, preparationId: metadata.preparationId }, command: { type: 'preparation.retry' } };
    expect((await command(b.client, input)).outcome).toEqual({ status: 'rejected', reason: 'not-host' });
    expect((await command(a.client, input)).outcome).toEqual({ status: 'rejected', reason: 'preparation-cooldown' });
    clock.mockReturnValue(metadata.availableAtMs);
    const accepted = { ...input, commandId: crypto.randomUUID() };
    expect((await command(a.client, accepted)).outcome.status).toBe('accepted');
    expect((await command(a.client, accepted)).duplicate).toBe(true);
    clock.mockReturnValue(metadata.availableAtMs + 1);
    await runDurableObjectAlarm(stub(room.roomId));
    const ready = await b.client.next((m) => m.type === 'room.snapshot' && m.state.status === 'playing' && m.state.match.phase === 'thinking');
    expect(JSON.stringify(ready)).not.toContain('secret failure');
  });

  test('join/start and shuffle/start ordering locks exactly the accepted roster and selected board', async () => {
    const { host, room } = await lobby();
    const a = await connect(room.roomId, host.cookie);
    expect((await command(a.client, start(room))).outcome).toEqual({ status: 'rejected', reason: 'not-enough-players' });
    const guest = await identity();
    await post('/api/rooms/join', { type: 'room.join', nickname: 'Guest', roomCode: room.state.roomCode }, guest.cookie);
    await command(a.client, shuffle(room));
    const changed = await a.client.next((m) => m.type === 'room.snapshot' && m.state.puzzle.id !== room.state.puzzle.id);
    if (changed.type !== 'room.snapshot') throw new Error('Expected shuffled board');
    expect((await command(a.client, start(room))).outcome).toEqual({ status: 'rejected', reason: 'preview-changed' });
    const current = { ...room, state: changed.state };
    expect((await command(a.client, start(current))).outcome).toEqual({ status: 'accepted' });
    const outsider = await identity();
    const rejected = await SELF.fetch(`${origin}/api/rooms/join`, { method: 'POST',
      headers: { Origin: origin, 'Content-Type': 'application/json', Cookie: outsider.cookie },
      body: JSON.stringify({ version: 1, commandId: crypto.randomUUID(), command: { type: 'room.join', nickname: 'Late', roomCode: room.state.roomCode } }) });
    expect(rejected.status).toBe(409);
    expect(await rejected.json()).toMatchObject({ type: 'request.rejected', reason: 'match-started' });
    expect((await command(a.client, shuffle(current))).outcome).toEqual({ status: 'rejected', reason: 'wrong-phase' });
    const existing = await post('/api/rooms/join', { type: 'room.join', nickname: 'Changed', roomCode: room.state.roomCode }, guest.cookie);
    expect(existing.membership).toBe('resumed');
    expect(existing.state.players.map((p) => p.nickname)).toEqual(['Host', 'Guest']);
  });

  test('private bindings differ; joins and connection changes reach existing clients as public snapshots', async () => {
    const { host, room } = await lobby();
    const first = await connect(room.roomId, host.cookie);
    expect(first.bound.seatId).toBe(room.seatId);
    expect(first.bound.state.players[0].connected).toBe(true);
    const guest = await identity();
    const joined = await post('/api/rooms/join', { type: 'room.join', nickname: 'Guest', roomCode: room.state.roomCode }, guest.cookie);
    await first.client.next((m) => m.type === 'room.snapshot' && m.state.players.length === 2);
    const second = await connect(room.roomId, guest.cookie);
    expect(second.bound.seatId).toBe(joined.seatId);
    expect(second.bound.seatId).not.toBe(first.bound.seatId);
    const latest = await first.client.next((m) => m.type === 'room.snapshot' && m.state.players.length === 2 && m.state.players.every((p) => p.connected));
    if (latest.type !== 'room.snapshot') throw new Error('Expected snapshot');
    expect(latest.state).toEqual(second.bound.state);
    const text = JSON.stringify(first.client.messages);
    expect(first.client.messages.some((m) => m.type === 'session.bound')).toBe(false);
    for (const secret of [host.token, guest.token, host.session.sessionId, guest.session.sessionId]) expect(text).not.toContain(secret);
  });

  test('host shuffle broadcasts once; exact retry preserves board/outcome and ID conflict does not replace it', async () => {
    const { host, room } = await lobby();
    const guest = await identity();
    await post('/api/rooms/join', { type: 'room.join', nickname: 'Guest', roomCode: room.state.roomCode }, guest.cookie);
    const a = await connect(room.roomId, host.cookie);
    const b = await connect(room.roomId, guest.cookie);
    const input = shuffle(room);
    const result = await command(a.client, input);
    expect(result.outcome).toEqual({ status: 'accepted' });
    const snapshot = await b.client.next((m) => m.type === 'room.snapshot' && m.state.puzzle.id !== room.state.puzzle.id);
    if (snapshot.type !== 'room.snapshot') throw new Error('Expected snapshot');
    const retry = await command(a.client, input);
    expect(retry.duplicate).toBe(true);
    expect(retry.processedRevision).toBe(result.processedRevision);
    expect(retry.currentRevision).toBe(result.currentRevision);
    const conflict = await command(a.client, stateRequest(room.roomId, input.commandId));
    expect(conflict.outcome).toEqual({ status: 'rejected', reason: 'command-id-conflict' });
    const stillSame = await post(`/api/rooms/${room.roomId}/resume`, { type: 'session.resume', roomId: room.roomId }, host.cookie);
    expect(stillSame.state.puzzle).toEqual(snapshot.state.puzzle);
    expect(b.client.messages.every((m) => m.type === 'room.snapshot')).toBe(true);
  });

  test('non-host, stale-context and wrong-room inputs do not shuffle; state reads are free of public changes', async () => {
    const { host, room } = await lobby();
    const guest = await identity();
    await post('/api/rooms/join', { type: 'room.join', nickname: 'Guest', roomCode: room.state.roomCode }, guest.cookie);
    const a = await connect(room.roomId, host.cookie);
    const b = await connect(room.roomId, guest.cookie);
    expect((await command(b.client, shuffle(room))).outcome).toEqual({ status: 'rejected', reason: 'not-host' });
    expect((await command(a.client, shuffle(room, crypto.randomUUID(), crypto.randomUUID()))).outcome)
      .toEqual({ status: 'rejected', reason: 'stale-context' });
    a.client.send(stateRequest(crypto.randomUUID()));
    await a.client.next((m) => m.type === 'protocol.error');
    const read = await command(a.client, stateRequest(room.roomId));
    expect(read.outcome).toEqual({ status: 'no-op', reason: 'snapshot-requested' });
    expect(read.processedRevision).toBe(b.bound.state.revision);
  });

  test('four tabs share one seat; closing one does not disconnect it, fifth is rejected', async () => {
    const { host, room } = await lobby();
    const tabs: Array<Awaited<ReturnType<typeof connect>>> = [];
    for (let index = 0; index < 4; index++) tabs.push(await connect(room.roomId, host.cookie));
    expect(tabs.every((t) => t.bound.seatId === room.seatId && t.bound.state.revision === tabs[0].bound.state.revision)).toBe(true);
    expect((await upgrade(room.roomId, host.cookie)).status).toBe(429);
    tabs[0].client.ws.close(1000);
    await tabs[0].client.closed;
    const result = await command(tabs[1].client, stateRequest(room.roomId));
    expect(result.currentRevision).toBe(tabs[1].bound.state.revision);
    const replacement = await connect(room.roomId, host.cookie);
    expect(replacement.bound.state.players).toHaveLength(1);
    expect(replacement.bound.state.players[0].connected).toBe(true);
  });

  test('a host cannot shuffle a locked match', async () => {
    const { host, room } = await lobby();
    const guest = await identity();
    await post('/api/rooms/join', { type: 'room.join', nickname: 'Guest', roomCode: room.state.roomCode }, guest.cookie);
    const a = await connect(room.roomId, host.cookie);
    expect((await command(a.client, start(room))).outcome).toEqual({ status: 'accepted' });
    const result = await command(a.client, shuffle(room));
    expect(result.outcome).toEqual({ status: 'rejected', reason: 'wrong-phase' });
    expect(result.currentRevision).toBeGreaterThan(a.bound.state.revision);
  });

  test('last-tab close updates the other client without deleting a seat or transferring host', async () => {
    const { host, room } = await lobby();
    const guest = await identity();
    await post('/api/rooms/join', { type: 'room.join', nickname: 'Guest', roomCode: room.state.roomCode }, guest.cookie);
    const a = await connect(room.roomId, host.cookie);
    const b = await connect(room.roomId, guest.cookie);
    a.client.ws.close(1000); await a.client.closed;
    const changed = await b.client.next((m) => m.type === 'room.snapshot' && !m.state.players[0].connected);
    if (changed.type !== 'room.snapshot') throw new Error('Expected disconnection');
    expect(changed.state.hostSeatId).toBe(room.seatId);
    expect(changed.state.players).toHaveLength(2);
  });

  test('revoked sessions close before commands/delivery; another player receives accurate flags', async () => {
    const { host, room } = await lobby();
    const guest = await identity();
    await post('/api/rooms/join', { type: 'room.join', nickname: 'Guest', roomCode: room.state.roomCode }, guest.cookie);
    const a = await connect(room.roomId, host.cookie);
    const b = await connect(room.roomId, guest.cookie);
    await runInDurableObject(registry(), (_instance, ctx) => {
      ctx.storage.sql.exec('UPDATE browser_sessions SET revoked_at = ? WHERE session_id = ?', Date.now(), host.session.sessionId);
    });
    await command(b.client, stateRequest(room.roomId));
    expect(await a.client.closed).toBe(1008);
    const changed = await b.client.next((m) => m.type === 'room.snapshot' && !m.state.players[0].connected);
    expect(changed.type).toBe('room.snapshot');
  });

  test('expiry alarm invalidates an already-open session at its hard deadline using a controlled clock', async () => {
    const { host, room } = await lobby();
    const a = await connect(room.roomId, host.cookie);
    const clock = vi.spyOn(Date, 'now').mockReturnValue(host.session.expiresAt);
    expect(await runDurableObjectAlarm(stub(room.roomId))).toBe(true);
    expect(await a.client.closed).toBe(1008);
    await runInDurableObject(stub(room.roomId), (_instance, ctx) => {
      const saved = JSON.parse(ctx.storage.sql.exec<{ value: string }>('SELECT value FROM room_state').one().value) as StoredRoom;
      expect(saved.state.players[0].connected).toBe(false);
      expect(saved.state.hostSeatId).toBe(room.seatId);
    });
    clock.mockRestore();
  });

  test('session expiry during Bidding closes sockets but preserves the later game deadline', async () => {
    const issuedAt = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(issuedAt);
    const { host, room } = await lobby();
    const guest = await identity();
    await post('/api/rooms/join', { type: 'room.join', nickname: 'Guest', roomCode: room.state.roomCode }, guest.cookie);
    const a = await connect(room.roomId, host.cookie);
    const b = await connect(room.roomId, guest.cookie);
    await command(a.client, start(room));
    clock.mockReturnValue(issuedAt + 1);
    await runDurableObjectAlarm(stub(room.roomId));
    const ready = await a.client.next((m) => m.type === 'room.snapshot' && m.state.status === 'playing' && m.state.match.phase === 'thinking');
    if (ready.type !== 'room.snapshot' || ready.state.status !== 'playing') throw new Error('Expected verified match');
    clock.mockReturnValue(host.session.expiresAt - 1);
    await command(a.client, { version: 1, commandId: crypto.randomUUID(), roomId: room.roomId,
      context: { matchId: ready.state.match.matchId, roundNumber: 1 }, command: { type: 'bid.submit', value: 5 } });
    const deadline = host.session.expiresAt + 59999;
    await runInDurableObject(stub(room.roomId), async (_instance, ctx) => {
      expect(await ctx.storage.getAlarm()).toBe(host.session.expiresAt);
    });
    clock.mockReturnValue(host.session.expiresAt);
    expect(await runDurableObjectAlarm(stub(room.roomId))).toBe(true);
    expect(await a.client.closed).toBe(1008);
    expect(await b.client.closed).toBe(1008);
    await runInDurableObject(stub(room.roomId), async (_instance, ctx) => {
      const saved = JSON.parse(ctx.storage.sql.exec<{ value: string }>('SELECT value FROM room_state').one().value) as StoredRoom;
      expect(saved.state.players.every((p) => !p.connected)).toBe(true);
      expect(saved.match!.state).toMatchObject({ phase: 'bidding', deadlineAtMs: deadline });
      expect(await ctx.storage.getAlarm()).toBe(deadline);
    });
    clock.mockReturnValue(deadline);
    expect(await runDurableObjectAlarm(stub(room.roomId))).toBe(true);
    await runInDurableObject(stub(room.roomId), async (instance, ctx) => {
      const before = ctx.storage.sql.exec<{ value: string }>('SELECT value FROM room_state').one().value;
      const saved = JSON.parse(before) as StoredRoom;
      expect(saved.match!.state).toMatchObject({ phase: 'demonstrating', officialRobots: ready.state.status === 'playing' ? ready.state.match.officialRobots : {},
        scores: { [room.seatId]: 0, [saved.state.players[1].seatId]: 0 } });
      expect(saved.state.hostSeatId).toBe(room.seatId); // Host continuity remains T17.
      await instance.alarm();
      expect(ctx.storage.sql.exec<{ value: string }>('SELECT value FROM room_state').one().value).toBe(before);
      expect(await ctx.storage.getAlarm()).toBeNull();
    });
    expect((await upgrade(room.roomId, host.cookie)).status).toBe(401);
  });

  test('binary, oversized text, malformed messages and unsupported commands fail safely', async () => {
    const { host, room } = await lobby();
    const a = await connect(room.roomId, host.cookie);
    a.client.ws.send('{');
    await a.client.next((m) => m.type === 'protocol.error' && m.reason === 'invalid-json');
    a.client.ws.send(new Uint8Array([1, 2, 3]));
    expect(await a.client.closed).toBe(1003);
    const b = await connect(room.roomId, host.cookie);
    b.client.ws.send('é'.repeat(2049));
    expect(await b.client.closed).toBe(1009);
    const c = await connect(room.roomId, host.cookie);
    c.client.send({ version: 1, commandId: crypto.randomUUID(), roomId: room.roomId,
      context: { matchId: crypto.randomUUID(), roundNumber: 1, attemptId: crypto.randomUUID(), attemptVersion: 0 },
      command: { type: 'attempt.undo' } });
    expect(await c.client.closed).toBe(1013);
  });

  test('socket rate limits persist across tabs and reject before executing another shuffle', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.now());
    const { host, room } = await lobby();
    const a = await connect(room.roomId, host.cookie);
    await runInDurableObject(stub(room.roomId), (_instance, ctx) => {
      ctx.storage.sql.exec('INSERT INTO socket_budgets VALUES (?, ?, 120)', host.session.sessionId, Math.floor(Date.now() / 60000) * 60000);
    });
    a.client.send(shuffle(room));
    expect(await a.client.closed).toBe(1013);
    const resumed = await post(`/api/rooms/${room.roomId}/resume`, { type: 'session.resume', roomId: room.roomId }, host.cookie);
    expect(resumed.state.puzzle.id).toBe(room.state.puzzle.id);
  });

  test('fresh controller reconstructs real socket attachments without allocating seats or changing revision', async () => {
    const { host, room } = await lobby();
    const a = await connect(room.roomId, host.cookie);
    await runInDurableObject(stub(room.roomId), async (instance, ctx) => {
      await (instance as unknown as { live: LiveLobby }).live.idle();
      // Use the Room's native bindings, not test-worker proxy capabilities.
      const nativeEnv = (instance as unknown as { env: Env }).env;
      const restored = new LiveLobby(ctx, nativeEnv);
      await restored.publish(false);
      Reflect.set(instance, 'live', restored);
      const saved = JSON.parse(ctx.storage.sql.exec<{ value: string }>('SELECT value FROM room_state').one().value) as StoredRoom;
      expect(saved.state).toEqual(a.bound.state);
      expect(ctx.getWebSockets()[0].deserializeAttachment()).not.toHaveProperty('credential');
    });
    expect((await command(a.client, stateRequest(room.roomId))).outcome.status).toBe('no-op');
  });

  test('socket commands share membership IDs and replay caps without evicting old outcomes', async () => {
    const { host, room } = await lobby();
    const resumeId = crypto.randomUUID();
    await SELF.fetch(`${origin}/api/rooms/${room.roomId}/resume`, { method: 'POST',
      headers: { Origin: origin, 'Content-Type': 'application/json', Cookie: host.cookie },
      body: JSON.stringify({ version: 1, commandId: resumeId, command: { type: 'session.resume', roomId: room.roomId } }) });
    const a = await connect(room.roomId, host.cookie);
    expect((await command(a.client, stateRequest(room.roomId, resumeId))).outcome)
      .toEqual({ status: 'rejected', reason: 'command-id-conflict' });
    const read = stateRequest(room.roomId);
    await command(a.client, read);
    await runInDurableObject(stub(room.roomId), (_instance, ctx) => {
      ctx.storage.sql.exec(`WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM n WHERE x < 9998)
        INSERT INTO membership_replays SELECT ?, printf('fixture-%d', x), '{}', '{}', 1 FROM n`, host.session.sessionId);
      expect(executeLobbyCommand(ctx.storage, host.session.sessionId, room.seatId, read)?.duplicate).toBe(true);
    });
    a.client.send(shuffle(room));
    expect(await a.client.closed).toBe(1013);
  });

  test('expired sessions cannot upgrade and forged actor fields never reach command execution', async () => {
    const { host, room } = await lobby();
    const a = await connect(room.roomId, host.cookie);
    a.client.send({ ...stateRequest(room.roomId), seatId: crypto.randomUUID() });
    await a.client.next((m) => m.type === 'protocol.error' && m.reason === 'invalid-message');
    await runInDurableObject(registry(), (_instance, ctx) => {
      ctx.storage.sql.exec('UPDATE browser_sessions SET expires_at = 0 WHERE session_id = ?', host.session.sessionId);
    });
    expect((await upgrade(room.roomId, host.cookie)).status).toBe(401);
    a.client.send(stateRequest(room.roomId));
    expect(await a.client.closed).toBe(1008);
  });

  test('upgrade rejects unsafe Origins, credentials in URL/protocol, outsiders and forged binding headers', async () => {
    const { host, room } = await lobby();
    const outsider = await identity();
    expect((await upgrade(room.roomId)).status).toBe(401);
    expect((await upgrade(room.roomId, outsider.cookie)).status).toBe(403);
    expect((await upgrade(room.roomId, '__Host-rr-session=bad')).status).toBe(401);
    expect((await upgrade(room.roomId, host.cookie, { Origin: 'https://evil.test' })).status).toBe(403);
    expect((await upgrade(room.roomId, host.cookie, {}, '?token=fake')).status).toBe(400);
    expect((await upgrade(room.roomId, host.cookie, { 'Sec-WebSocket-Protocol': 'fake-token' })).status).toBe(400);
    expect((await upgrade(room.roomId, outsider.cookie, { 'X-RR-Session': host.session.sessionId, 'X-RR-Room': room.roomId })).status).toBe(403);
    expect((await upgrade(crypto.randomUUID(), host.cookie)).status).toBe(404);
  });
});
