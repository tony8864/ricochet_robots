import { env, SELF, runDurableObjectAlarm, runInDurableObject } from 'cloudflare:test';
import { afterEach, expect, test, vi } from 'vitest';
import { parseServerMessage, type ServerMessage } from '@robot-puzzle/shared';
import { PresenceStore } from '../src/presence';
import { LiveLobby } from '../src/liveLobby';
import { executeLobbyCommand, storedRoom } from '../src/lobbyCommands';
import { canonicalJson } from '../src/creations';

const origin = 'https://localhost:5173';
const registry = () => env.REGISTRY.get(env.REGISTRY.idFromName('registry-v1'));
const stub = (id: string) => env.ROOMS.get(env.ROOMS.idFromName(id));
const clients: Client[] = [];
const rooms: string[] = [];
class Client {
  readonly messages: ServerMessage[] = [];
  readonly closed: Promise<number>;
  readonly listeners = new Set<() => void>();
  connectionId = '';
  sequence = 0;
  constructor(readonly ws: WebSocket) {
    this.closed = new Promise((resolve) => ws.addEventListener('close', (event) => {
      if (ws.readyState === WebSocket.CLOSING) ws.close(); resolve(event.code);
    }));
    ws.addEventListener('message', (event) => {
      const parsed = parseServerMessage(JSON.parse(String(event.data)));
      if (!parsed.ok) throw new Error('Invalid presence response');
      if (parsed.value.type === 'session.bound') this.connectionId = parsed.value.connectionId;
      this.messages.push(parsed.value); for (const listener of this.listeners) listener();
    });
    ws.accept();
  }
  next(predicate: (value: ServerMessage) => boolean): Promise<ServerMessage> {
    const read = () => { const i = this.messages.findIndex(predicate); return i < 0 ? undefined : this.messages.splice(i, 1)[0]; };
    const existing = read(); if (existing) return Promise.resolve(existing);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.listeners.delete(listener); reject(new Error('Missing presence response')); }, 5000);
      const listener = () => { const value = read(); if (value) { clearTimeout(timer); this.listeners.delete(listener); resolve(value); } };
      this.listeners.add(listener);
    });
  }
  async ping(roomId: string) {
    const sequence = ++this.sequence;
    this.ws.send(JSON.stringify({ version: 2, type: 'connection.ping', roomId, connectionId: this.connectionId, sequence }));
    await this.next((m) => m.type === 'connection.pong' && m.sequence === sequence);
  }
}
async function fixture() {
  using opened = await registry().openSession(null);
  if (opened.status !== 'ready' || !opened.credential) throw new Error('Missing session');
  using created = await registry().createRoom(opened.credential, { version: 2, commandId: crypto.randomUUID(), command: { type: 'room.create', nickname: 'Host' } });
  if (created.status !== 'created') throw new Error('Missing room');
  rooms.push(created.state.roomId);
  return { roomId: created.state.roomId, token: opened.credential, session: opened.session, seatId: created.seatId };
}
async function connect(roomId: string, token: string) {
  const response = await SELF.fetch(`${origin}/api/rooms/${roomId}/socket`, {
    headers: { Origin: origin, Upgrade: 'websocket', Cookie: `__Host-rr-session=${token}` },
  });
  expect(response.status).toBe(101);
  if (!response.webSocket) throw new Error('Missing socket');
  const client = new Client(response.webSocket); clients.push(client);
  await client.next((m) => m.type === 'session.bound'); return client;
}
const inspect = (roomId: string) => runInDurableObject(stub(roomId), async (_instance, ctx) => ({
  room: storedRoom(ctx.storage)!, alarm: await ctx.storage.getAlarm(),
  leases: ctx.storage.sql.exec('SELECT * FROM connection_leases').toArray(),
  presence: ctx.storage.sql.exec('SELECT * FROM seat_presence').toArray(),
  empty: ctx.storage.sql.exec('SELECT * FROM room_presence').toArray(),
  receipts: ctx.storage.sql.exec('SELECT * FROM membership_replays').toArray(),
}));

afterEach(async () => {
  for (const client of clients) { if (client.ws.readyState === WebSocket.OPEN) client.ws.close(1000); await client.closed; }
  for (const id of rooms) await runInDurableObject(stub(id), async (instance) => { await (instance as unknown as { live: LiveLobby }).live.idle(); });
  clients.length = 0; rooms.length = 0; vi.restoreAllMocks();
});

test('heartbeats renew only live leases, not revisions/receipts; duplicates and broadcasts cannot keep a stale socket online', async () => {
  const start = Date.now(); const clock = vi.spyOn(Date, 'now').mockReturnValue(start);
  const f = await fixture(); const client = await connect(f.roomId, f.token);
  const before = await inspect(f.roomId);
  clock.mockReturnValue(start + 10000); await client.ping(f.roomId);
  const renewed = await inspect(f.roomId);
  expect(renewed.room).toEqual(before.room); expect(renewed.receipts).toEqual(before.receipts);
  expect(renewed.leases[0]).toMatchObject({ deadline: start + 40000, sequence: 1 });
  clock.mockReturnValue(start + 20000);
  client.ws.send(JSON.stringify({ version: 2, type: 'connection.ping', roomId: f.roomId, connectionId: client.connectionId, sequence: 1 }));
  await runInDurableObject(stub(f.roomId), async (instance) => { await (instance as unknown as { live: LiveLobby }).live.idle(); });
  clock.mockReturnValue(start + 39999);
  await runInDurableObject(stub(f.roomId), async (instance) => { await (instance as unknown as { live: LiveLobby }).live.publish(); });
  expect((await inspect(f.roomId)).leases[0]).toMatchObject({ deadline: start + 40000 });
  clock.mockReturnValue(start + 45000); await runDurableObjectAlarm(stub(f.roomId));
  expect(await client.closed).toBe(1001);
  const ended = await inspect(f.roomId);
  expect(ended.room.state.players[0].connected).toBe(false);
  expect(ended.presence[0]).toMatchObject({ offline_since: start + 40000 });
  expect(ended.empty[0]).toMatchObject({ empty_since: start + 40000 });
  expect(ended.leases).toEqual([]); expect(ended.receipts).toEqual(before.receipts);
});

test('one responsive tab keeps the seat online and old closes cannot overwrite a new binding', async () => {
  const start = Date.now(); const clock = vi.spyOn(Date, 'now').mockReturnValue(start);
  const f = await fixture(); const a = await connect(f.roomId, f.token); const b = await connect(f.roomId, f.token);
  const revision = (await inspect(f.roomId)).room.state.revision;
  clock.mockReturnValue(start + 29000); await b.ping(f.roomId);
  clock.mockReturnValue(start + 30000); await runDurableObjectAlarm(stub(f.roomId)); expect(await a.closed).toBe(1001);
  expect((await inspect(f.roomId)).room.state.revision).toBe(revision);
  const c = await connect(f.roomId, f.token);
  b.ws.close(1000); expect(await b.closed).toBe(1000);
  await c.ping(f.roomId);
  const current = await inspect(f.roomId);
  expect(current.room.state.players[0].connected).toBe(true); expect(current.leases).toHaveLength(1);
  expect(current.presence[0]).toMatchObject({ offline_since: null }); expect(current.empty[0]).toMatchObject({ empty_since: null });
});

test('wrong connection IDs/invalid heartbeats do not renew and a deadline input cannot revive the expired connection', async () => {
  const start = Date.now(); const clock = vi.spyOn(Date, 'now').mockReturnValue(start);
  const f = await fixture(); const a = await connect(f.roomId, f.token); const b = await connect(f.roomId, f.token);
  clock.mockReturnValue(start + 10000);
  a.ws.send(JSON.stringify({ version: 2, type: 'connection.ping', roomId: f.roomId, connectionId: b.connectionId, sequence: 1 }));
  await a.next((m) => m.type === 'protocol.error');
  a.ws.send(JSON.stringify({ version: 2, type: 'connection.ping', roomId: f.roomId, connectionId: a.connectionId, sequence: 0 }));
  await a.next((m) => m.type === 'protocol.error');
  expect((await inspect(f.roomId)).leases.every((row) => row.deadline === start + 30000)).toBe(true);
  clock.mockReturnValue(start + 30000);
  a.ws.send(JSON.stringify({ version: 2, type: 'connection.ping', roomId: f.roomId, connectionId: a.connectionId, sequence: 1 }));
  expect(await a.closed).toBe(1001); expect(await b.closed).toBe(1001);
  const returned = await connect(f.roomId, f.token); expect(returned.connectionId).not.toBe(a.connectionId);
  expect((await inspect(f.roomId)).room.state.players).toHaveLength(1);
});

test('heartbeat budget is enforced without filling the replay ledger', async () => {
  const start = Date.now(); vi.spyOn(Date, 'now').mockReturnValue(start);
  const f = await fixture(); const client = await connect(f.roomId, f.token);
  await runInDurableObject(stub(f.roomId), (_instance, ctx) => {
    ctx.storage.sql.exec('INSERT INTO socket_budgets VALUES (?, ?, 119)', f.session.sessionId, Math.floor(start / 60000) * 60000);
  });
  await client.ping(f.roomId);
  client.ws.send(JSON.stringify({ version: 2, type: 'connection.ping', roomId: f.roomId, connectionId: client.connectionId, sequence: 2 }));
  expect(await client.closed).toBe(1013); expect((await inspect(f.roomId)).receipts).toHaveLength(0);
});

test('a valid rejected action renews its live connection; old protocol traffic cannot mutate gameplay', async () => {
  const start = Date.now(); const clock = vi.spyOn(Date, 'now').mockReturnValue(start);
  const f = await fixture(); const client = await connect(f.roomId, f.token);
  const before = await inspect(f.roomId);
  clock.mockReturnValue(start + 29000);
  client.ws.send(JSON.stringify({ version: 2, commandId: crypto.randomUUID(), roomId: f.roomId,
    context: { lobbyId: crypto.randomUUID() }, command: { type: 'board.shuffle' } }));
  const result = await client.next((m) => m.type === 'command.result');
  expect(result).toMatchObject({ outcome: { status: 'rejected', reason: 'stale-context' } });
  const after = await inspect(f.roomId);
  expect(after.leases[0]).toMatchObject({ deadline: start + 59000 });
  expect(after.room).toEqual(before.room); expect(after.receipts).toHaveLength(1);
  clock.mockReturnValue(start + 50000);
  client.ws.send(JSON.stringify({ version: 1, commandId: crypto.randomUUID(), roomId: f.roomId, context: {}, command: { type: 'state.request' } }));
  expect(await client.next((m) => m.type === 'protocol.error')).toMatchObject({ reason: 'unsupported-version' });
  expect(await client.closed).toBe(1002);
  expect((await inspect(f.roomId)).room.state.puzzle).toEqual(before.room.state.puzzle);
});

test('session expiry remains earlier than lease expiry and never transfers host', async () => {
  const start = Date.now(); const clock = vi.spyOn(Date, 'now').mockReturnValue(start);
  const f = await fixture(); await connect(f.roomId, f.token);
  // Represent continuous keepalives, so the large identity-clock jump does not
  // instead model an empty room abandoned for almost 24 hours.
  await runInDurableObject(stub(f.roomId), (_instance, ctx) => {
    ctx.storage.sql.exec('UPDATE connection_leases SET last_seen = ?, deadline = ?', f.session.expiresAt - 5001, f.session.expiresAt + 24999);
  });
  clock.mockReturnValue(f.session.expiresAt - 5000);
  const client = await connect(f.roomId, f.token); await client.ping(f.roomId);
  const before = await inspect(f.roomId); expect(await before.alarm).toBe(f.session.expiresAt);
  clock.mockReturnValue(f.session.expiresAt); await runDurableObjectAlarm(stub(f.roomId));
  expect(await client.closed).toBe(1008);
  const after = await inspect(f.roomId); expect(after.room.state.hostSeatId).toBe(f.seatId);
  expect(after.presence[0]).toMatchObject({ offline_since: f.session.expiresAt });
});

test('expiry during awaited Registry verification wins before a new socket binding can cancel emptiness', async () => {
  const start = Date.now(); const clock = vi.spyOn(Date, 'now').mockReturnValue(start); const f = await fixture();
  await runInDurableObject(stub(f.roomId), async (_instance, ctx) => {
    const deadline = new PresenceStore(ctx.storage).nextEmptyDeadline()!;
    clock.mockReturnValue(deadline - 1);
    const fake = { APP_ENV: 'local', REGISTRY: { idFromName: () => 'registry', get: () => ({
      verifySessionIdentity: async () => { clock.mockReturnValue(deadline); return { ...f.session, [Symbol.dispose]() {} }; }, closeRoomDirectory: async () => {},
    }) } } as unknown as Env;
    const response = await new LiveLobby(ctx, fake).connect(f.session.sessionId, f.roomId);
    expect(response.status).toBe(410);
    expect(ctx.storage.sql.exec('SELECT * FROM connection_leases').toArray()).toEqual([]);
  });
});

test('presence retirement and public revision roll back together on storage failure; unknown schemas fail closed', async () => {
  const start = Date.now(); vi.spyOn(Date, 'now').mockReturnValue(start);
  const f = await fixture(); await connect(f.roomId, f.token);
  const before = await inspect(f.roomId);
  await runInDurableObject(stub(f.roomId), (_instance, ctx) => {
    ctx.storage.sql.exec("CREATE TRIGGER presence_failure BEFORE UPDATE ON room_state BEGIN SELECT RAISE(ABORT, 'fixture failure'); END");
    expect(() => new PresenceStore(ctx.storage).reconcile(new Set(), start)).toThrow();
    ctx.storage.sql.exec('DROP TRIGGER presence_failure');
    ctx.storage.sql.exec('UPDATE presence_metadata SET version = 99');
    expect(() => new PresenceStore(ctx.storage).initialize()).toThrow('Unsupported presence schema');
    ctx.storage.sql.exec('UPDATE presence_metadata SET version = 1');
  });
  expect(await inspect(f.roomId)).toEqual(before);
});

test('transport reconstruction retains live lease/sequence; private historical retries only look up existing receipts', async () => {
  const start = Date.now(); vi.spyOn(Date, 'now').mockReturnValue(start);
  const f = await fixture(); const client = await connect(f.roomId, f.token); await client.ping(f.roomId);
  const before = await inspect(f.roomId);
  await runInDurableObject(stub(f.roomId), async (instance, ctx) => {
    await (instance as unknown as { live: LiveLobby }).live.idle();
    const restored = new LiveLobby(ctx, (instance as unknown as { env: Env }).env);
    await restored.publish(false); Reflect.set(instance, 'live', restored);
  });
  expect((await inspect(f.roomId)).leases).toEqual(before.leases); await client.ping(f.roomId);
  await runInDurableObject(stub(f.roomId), (_instance, ctx) => {
    const originalRequest = { version: 1 as const, roomId: f.roomId, commandId: crypto.randomUUID(), context: {}, command: { type: 'state.request' as const } };
    const input = { version: 2 as const, roomId: f.roomId, commandId: originalRequest.commandId, context: {}, command: { type: 'command.retry' as const, originalRequest } };
    expect(executeLobbyCommand(ctx.storage, f.session.sessionId, f.seatId, input)?.outcome).toEqual({ status: 'rejected', reason: 'retry-not-found' });
    ctx.storage.sql.exec('INSERT INTO membership_replays VALUES (?, ?, ?, ?, ?)', f.session.sessionId, input.commandId,
      canonicalJson(originalRequest), JSON.stringify({ status: 'no-op', reason: 'snapshot-requested' }), before.room.state.revision);
    expect(executeLobbyCommand(ctx.storage, f.session.sessionId, f.seatId, input)).toMatchObject({ duplicate: true, outcome: { status: 'no-op' } });
    expect(executeLobbyCommand(ctx.storage, f.session.sessionId, f.seatId, { ...input, command: { ...input.command,
      originalRequest: { ...originalRequest, command: { type: 'board.shuffle' }, context: { lobbyId: crypto.randomUUID() } } } })?.outcome)
      .toEqual({ status: 'rejected', reason: 'command-id-conflict' });
  });
});
