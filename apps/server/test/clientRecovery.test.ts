import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { build } from 'esbuild';
import { Miniflare } from 'miniflare';
import { afterEach, expect, test } from 'vitest';
import { parseServerMessage, type RoomEnteredMessage, type ServerMessage } from '@robot-puzzle/shared';
import { liveLobbyClient, type LiveLobbyClient, type LobbySocketHandlers } from '../../web/src/lobby/liveLobbyClient';
import { recoveryRecord, roomRecoveryStore } from '../../web/src/lobby/roomRecovery';
import { entryRecovery, type EntryRecovery } from '../../web/src/entry/entryRecovery';
import { resumeRoom } from '../../web/src/entry/resumeRoom';
import type { LifecycleEvent } from '../../web/src/lobby/recoveryEnvironment';
import { moveRobot, DIRECTIONS, ROBOT_IDS, isTargetComplete } from '../../../packages/game-engine/src';

const origin = 'https://localhost:5173';
const flows: LiveLobbyClient[] = [];
const restorers: EntryRecovery[] = [];
let runtime: Miniflare | undefined;
let directory: string | undefined;
let logicalNow = 0;
const connections: Array<{ ws: WebSocket; closed: Promise<void> }> = [];
const requests = new Set<Promise<unknown>>();
function track<T>(promise: Promise<T>): Promise<T> {
  requests.add(promise); void promise.then(() => requests.delete(promise), () => requests.delete(promise)); return promise;
}
function waitFor<T>(subscribe: (listener: () => void) => () => void, read: () => T | undefined): Promise<T> {
  const existing = read(); if (existing !== undefined) return Promise.resolve(existing);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { unsubscribe(); reject(new Error('Missing authoritative client recovery state')); }, 10000);
    const unsubscribe = subscribe(() => { const value = read(); if (value !== undefined) { clearTimeout(timer); unsubscribe(); resolve(value); } });
  });
}
const until = async (flow: LiveLobbyClient, predicate: (state: ReturnType<LiveLobbyClient['getSnapshot']>) => boolean) => {
  try { return await waitFor(flow.subscribe, () => predicate(flow.getSnapshot()) ? flow.getSnapshot() : undefined); }
  catch {
    const s = flow.getSnapshot();
    throw new Error(`Recovery wait failed: ${s.connection}; ${s.message}; ${s.room.status === 'playing' ? s.room.match.phase : s.room.status}; action ${s.attempt}/${s.shuffle}/${s.start}/${s.bid}`);
  }
};

async function setup(count: 2 | 6 = 2) {
  const bundle = await build({ entryPoints: ['test/clientRecovery.worker.ts'], bundle: true, write: false,
    format: 'esm', platform: 'browser', target: 'es2022', external: ['cloudflare:workers'] });
  directory = await mkdtemp(join(tmpdir(), 'rr-t17-client-'));
  runtime = new Miniflare({ modules: true, script: bundle.outputFiles[0].text, compatibilityDate: '2025-10-11',
    host: '127.0.0.1', port: 0, durableObjects: { REGISTRY: { className: 'Registry', useSQLite: true }, ROOMS: { className: 'Room', useSQLite: true } },
    bindings: { APP_ENV: 'local', ALLOWED_ORIGINS: origin }, durableObjectsPersist: join(directory, 'saved') });
  await clock();
  const post = async (path: string, command: object, cookie?: string) => {
    const response = await runtime!.dispatchFetch(`${origin}${path}`, { method: 'POST',
      headers: { Origin: origin, 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
      body: JSON.stringify({ version: 2, commandId: crypto.randomUUID(), command }) });
    expect(response.status).toBe(200);
    const parsed = parseServerMessage(await response.json()); if (!parsed.ok) throw new Error('Invalid HTTP setup response');
    return { message: parsed.value, cookie: response.headers.get('Set-Cookie')?.split(';')[0] };
  };
  const host = await post('/api/session', { type: 'session.open' }); const guest = await post('/api/session', { type: 'session.open' });
  if (!host.cookie || !guest.cookie) throw new Error('Missing test cookies');
  const created = await post('/api/rooms', { type: 'room.create', nickname: 'Host' }, host.cookie);
  if (created.message.type !== 'room.entered') throw new Error('Expected host entry');
  const joined = await post('/api/rooms/join', { type: 'room.join', nickname: 'Guest', roomCode: created.message.state.roomCode }, guest.cookie);
  if (joined.message.type !== 'room.entered') throw new Error('Expected guest entry');
  const additional: Array<{ entry: RoomEnteredMessage; cookie: string }> = [];
  let state = joined.message.state;
  for (let i = 2; i < count; i++) {
    const identity = await post('/api/session', { type: 'session.open' });
    if (!identity.cookie) throw new Error('Missing additional test cookie');
    const admitted = await post('/api/rooms/join', { type: 'room.join', nickname: `Player ${i + 1}`, roomCode: state.roomCode }, identity.cookie);
    if (admitted.message.type !== 'room.entered') throw new Error('Expected additional guest entry');
    state = admitted.message.state;
    additional.push({ entry: admitted.message, cookie: identity.cookie });
  }
  return { roomId: created.message.roomId, host: bridge({ ...created.message, state }, host.cookie),
    guest: bridge({ ...joined.message, state }, guest.cookie),
    others: additional.map(({ entry, cookie }) => bridge({ ...entry, state }, cookie)) };
}
async function clock(value?: number, roomId?: string) {
  if (value !== undefined) logicalNow = value;
  const response = await runtime!.dispatchFetch('https://test.invalid/__test/clock', { method: 'POST',
    body: JSON.stringify({ ...(value !== undefined ? { now: value } : {}), ...(roomId ? { roomId } : {}) }) });
  expect(response.status).toBe(200); logicalNow = (await response.json() as { now: number }).now;
}

function bridge(entry: RoomEnteredMessage, cookie: string) {
  const storage = new Map<string, string>();
  const recovery = roomRecoveryStore(() => ({ getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => { storage.set(key, value); }, removeItem: (key) => { storage.delete(key); } }));
  const listeners = new Set<(event: LifecycleEvent) => void>(); let online = true;
  const environment = { online: () => online, watch: (listener: (event: LifecycleEvent) => void) => {
    listeners.add(listener); return () => { listeners.delete(listener); };
  } };
  const httpPaths: string[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    const path = String(input); httpPaths.push(path);
    const headers = new Headers(init?.headers); headers.set('Origin', origin); headers.set('Cookie', cookie);
    const outgoing: Record<string, string> = {}; headers.forEach((value, name) => { outgoing[name] = value; });
    // Translate browser fetch options to the in-process Worker binding. Cookie
    // handling is supplied by this test browser, never the production adapter.
    return track(runtime!.dispatchFetch(`${origin}${path}`, { method: init?.method, body: init?.body as string, headers: outgoing })) as unknown as Promise<Response>;
  };
  const resume = (id: string, signal: AbortSignal) => track(resumeRoom(id, signal, fetcher));
  let latest: WebSocket | undefined; let dropResults = false;
  const sent: string[] = []; const received: ServerMessage[] = []; const changes = new Set<() => void>();
  const readId = crypto.randomUUID();
  const socket = (url: string, handlers: LobbySocketHandlers) => {
    let ws: WebSocket | undefined; let cancelled = false;
    void track(runtime!.dispatchFetch(url.replace('wss:', 'https:'), { headers: { Origin: origin, Upgrade: 'websocket', Cookie: cookie } }).then(async (response) => {
      if (response.status !== 101 || !response.webSocket) { await response.arrayBuffer(); if (!cancelled) handlers.failed(); return; }
      ws = response.webSocket as unknown as WebSocket; latest = ws;
      const native = ws;
      const closed = new Promise<void>((resolve) => native.addEventListener('close', (event) => {
        if (native.readyState === 2) native.close(); handlers.closed(event.code); resolve();
      }));
      connections.push({ ws, closed });
      native.addEventListener('message', (event) => {
        const message = JSON.parse(String(event.data)) as ServerMessage;
        received.push(message); for (const change of changes) change();
        if (!(dropResults && message.type === 'command.result')) handlers.message(event.data);
      });
      native.accept(); if (cancelled) native.close(1000);
    }).catch(() => { if (!cancelled) handlers.failed(); }));
    return { send(text: string) { if (!ws) throw new Error('Unbound transport'); sent.push(text); ws.send(text); },
      close() { cancelled = true; if (ws?.readyState === 1) ws.close(1000); } };
  };
  const make = (current = entry) => {
    const flow = liveLobbyClient(current, { socket, origin: () => origin, now: () => logicalNow, random: () => 0.5,
      heartbeats: false, environment, recovery, resume, confirm: () => true });
    flows.push(flow); return flow;
  };
  const flow = make();
  return { entry, flow, make, recovery, storage, httpPaths, received, sent,
    api: (path: string, input: object) => fetcher(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) }),
    async rawCommand(input: { commandId: string; [key: string]: unknown }) {
      const before = received.length; latest!.send(JSON.stringify(input));
      return waitFor((listener) => { changes.add(listener); return () => { changes.delete(listener); }; },
        () => received.slice(before).find((m) => m.type === 'command.result' && m.commandId === input.commandId));
    },
    anotherTab: () => bridge(entry, cookie),
    async joinAgain() {
      const response = await fetcher('/api/rooms/join', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ version: 2,
        commandId: crypto.randomUUID(), command: { type: 'room.join', nickname: 'Guest', roomCode: entry.state.roomCode } }) });
      expect(response.status).toBe(200);
      const parsed = parseServerMessage(await response.json());
      if (!parsed.ok || parsed.value.type !== 'room.entered') throw new Error('Expected explicit same-seat rejoin');
      return parsed.value;
    },
    setDropResults(value: boolean) { dropResults = value; },
    emit(event: LifecycleEvent) { if (event === 'offline') online = false; if (event === 'online') online = true; for (const listener of [...listeners]) listener(event); },
    async keepAliveRead() {
      const before = received.length;
      latest!.send(JSON.stringify({ version: 2, commandId: readId, roomId: entry.roomId, context: {}, command: { type: 'state.request' } }));
      await waitFor((listener) => { changes.add(listener); return () => { changes.delete(listener); }; },
        () => received.slice(before).find((m) => m.type === 'command.result' && m.commandId === readId));
    },
    restore() {
      const restoring = entryRecovery('/', { recovery, environment, resume, now: () => logicalNow, random: () => 0.5 });
      restorers.push(restoring); return restoring;
    },
  };
}

afterEach(async () => {
  for (const flow of flows.splice(0)) flow.disconnect(); for (const restore of restorers.splice(0)) restore.stop();
  while (requests.size) await Promise.allSettled([...requests]);
  for (const { ws, closed } of connections) { if (ws.readyState === 1) ws.close(1000); await closed; }
  while (requests.size) await Promise.allSettled([...requests]);
  connections.length = 0;
  await runtime?.dispose(); runtime = undefined;
  if (directory) {
    const target = resolve(directory);
    if (dirname(target) !== resolve(tmpdir()) || !basename(target).startsWith('rr-t17-client-')) throw new Error('Unsafe recovery test cleanup');
    await rm(target, { recursive: true, force: true }); directory = undefined;
  }
});

test('real client automatically restores the same guest seat and current snapshots after network/resume events', async () => {
  const f = await setup(); f.host.flow.connect(); f.guest.flow.connect();
  await until(f.host.flow, (s) => s.connection === 'connected'); await until(f.guest.flow, (s) => s.connection === 'connected');
  f.guest.emit('offline'); await until(f.host.flow, (s) => !s.room.players.find((p) => p.seatId === f.guest.entry.seatId)?.connected);
  f.host.flow.shuffle(); await until(f.host.flow, (s) => s.shuffle === 'idle' && s.room.puzzle.id !== f.host.entry.state.puzzle.id);
  f.guest.emit('online');
  const restored = await until(f.guest.flow, (s) => s.connection === 'connected' && s.room.puzzle.id === f.host.flow.getSnapshot().room.puzzle.id);
  expect(restored.room.players.map((p) => p.seatId)).toEqual(f.host.entry.state.players.map((p) => p.seatId));
  expect(restored.room.hostSeatId).toBe(f.host.entry.seatId);
  expect(f.guest.httpPaths).toEqual([`/api/rooms/${f.roomId}/resume`]);
}, 15000);

test('never-opened rooms expire at thirty minutes; lookups cannot renew them and clients learn distinct expiry without a new identity', async () => {
  const f = await setup(); const start = logicalNow;
  // The entry screen remembers admission even if the page closes before WSS binds.
  f.host.recovery.save(recoveryRecord(f.host.entry, null));
  const resume = () => f.host.api(`/api/rooms/${f.roomId}/resume`, { version: 2, commandId: crypto.randomUUID(), command: { type: 'session.resume', roomId: f.roomId } });
  await clock(start + 1800000 - 1, f.roomId); expect((await resume()).status).toBe(200);
  await clock(start + 1800000, f.roomId);
  const late = await resume(); expect(late.status).toBe(409); expect(await late.json()).toMatchObject({ reason: 'room-expired' });
  const join = await f.guest.api('/api/rooms/join', { version: 2, commandId: crypto.randomUUID(), command: { type: 'room.join', nickname: 'Guest', roomCode: f.guest.entry.state.roomCode } });
  expect(join.status).toBe(409); expect(await join.json()).toMatchObject({ reason: 'room-expired' });
  const restoring = f.host.restore(); restoring.start();
  const restored = await waitFor(restoring.subscribe, () => { const s = restoring.getSnapshot(); return s.status === 'entry' ? s : undefined; });
  expect(restored.message).toBe('This room has expired.');
  expect(f.host.recovery.read()).toBeNull();
  expect(f.host.httpPaths.filter((p) => p === '/api/session')).toEqual([]);
  const identity = await f.host.api('/api/session', { version: 2, commandId: crypto.randomUUID(), command: { type: 'session.open' } });
  expect(identity.status).toBe(200); expect(identity.headers.get('Set-Cookie')).toBeNull();
  const fresh = await f.host.api('/api/rooms', { version: 2, commandId: crypto.randomUUID(), command: { type: 'room.create', nickname: 'Host' } });
  expect(fresh.status).toBe(200);
}, 15000);

test('authenticated return before expiry cancels the old deadline; last disconnect starts a fresh window and offline refresh discovers expiry', async () => {
  const f = await setup(); const start = logicalNow; f.host.flow.connect(); await until(f.host.flow, (s) => s.connection === 'connected');
  f.host.flow.disconnect();
  // Complete the definitive-close event and normalize it with a read, not a bind.
  await f.host.api(`/api/rooms/${f.roomId}/resume`, { version: 2, commandId: crypto.randomUUID(), command: { type: 'session.resume', roomId: f.roomId } });
  await clock(start + 1800000 - 1, f.roomId); f.guest.flow.connect(); await until(f.guest.flow, (s) => s.connection === 'connected');
  await clock(start + 1800000 + 1000, f.roomId); await f.guest.keepAliveRead();
  expect(f.guest.flow.getSnapshot().connection).toBe('connected');
  f.guest.flow.disconnect();
  await f.host.api(`/api/rooms/${f.roomId}/resume`, { version: 2, commandId: crypto.randomUUID(), command: { type: 'session.resume', roomId: f.roomId } });
  await clock(start + 3600000 + 1000, f.roomId);
  const restore = f.host.restore(); restore.start();
  const entry = await waitFor(restore.subscribe, () => { const s = restore.getSnapshot(); return s.status === 'entry' ? s : undefined; });
  expect(entry.message).toBe('This room has expired.'); expect(f.host.recovery.read()).toBeNull();
}, 15000);

test('End Room closes all tabs, invalidates code/resume/old creation and preserves exact receipts and unrelated identity', async () => {
  const f = await setup(); const otherHost = f.host.anotherTab(); const offlineGuest = f.guest.anotherTab();
  for (const peer of [f.host, f.guest, otherHost, offlineGuest]) { peer.flow.connect(); await until(peer.flow, (s) => s.connection === 'connected'); }
  offlineGuest.flow.disconnect();
  if (f.host.entry.state.status !== 'lobby') throw new Error('Expected lobby');
  const context = { lobbyId: f.host.entry.state.lobbyId };
  const forged = await f.guest.rawCommand({ version: 2, roomId: f.roomId, commandId: crypto.randomUUID(), context, command: { type: 'room.end', confirmed: true } });
  expect(forged.type === 'command.result' && forged.outcome).toEqual({ status: 'rejected', reason: 'not-host' });
  f.host.flow.endRoom(); otherHost.flow.endRoom();
  for (const peer of [f.host, f.guest, otherHost]) await until(peer.flow, (s) => s.connection === 'closed');
  expect(f.guest.flow.getSnapshot().message).toBe('The host ended this room.');
  const closed = await f.guest.api('/api/rooms/join', { version: 2, commandId: crypto.randomUUID(), command: { type: 'room.join', roomCode: f.guest.entry.state.roomCode, nickname: 'Guest' } });
  expect(closed.status).toBe(409); expect(await closed.json()).toMatchObject({ type: 'request.rejected', reason: 'room-closed' });
  const restore = offlineGuest.restore(); restore.start();
  const state = await waitFor(restore.subscribe, () => { const s = restore.getSnapshot(); return s.status === 'entry' ? s : undefined; });
  expect(state.message).toBe('The host ended this room.'); expect(offlineGuest.recovery.read()).toBeNull();
  const originals = [f.host, otherHost].map((peer) => JSON.parse(peer.sent.find((text) => JSON.parse(text).command?.type === 'room.end')!));
  const receipts = [];
  for (const original of originals) {
    const response = await f.host.api(`/api/rooms/${f.roomId}/retry`, original); expect(response.status).toBe(200); receipts.push(await response.json());
  }
  expect(receipts.filter((r) => (r as { outcome: { status: string } }).outcome.status === 'accepted')).toHaveLength(1);
  const accepted = receipts.find((r) => (r as { outcome: { status: string } }).outcome.status === 'accepted');
  expect(accepted).toMatchObject({ duplicate: true });
  const oldCreate = await f.host.api('/api/rooms', { version: 2, commandId: f.host.entry.commandId, command: { type: 'room.create', nickname: 'Host' } });
  expect(oldCreate.status).toBe(409); expect(await oldCreate.json()).toMatchObject({ reason: 'room-closed' });
  const session = await f.host.api('/api/session', { version: 2, commandId: crypto.randomUUID(), command: { type: 'session.open' } });
  expect(session.status).toBe(200); expect(session.headers.get('Set-Cookie')).toBeNull();
  const fresh = await f.host.api('/api/rooms', { version: 2, commandId: crypto.randomUUID(), command: { type: 'room.create', nickname: 'Host' } });
  expect(fresh.status).toBe(200); expect(await fresh.json()).toMatchObject({ type: 'room.entered', membership: 'created' });
}, 15000);

test('guest Leave is tab-local, preserves the lobby seat, and refresh waits for explicit rejoin', async () => {
  const f = await setup(); const other = f.guest.anotherTab();
  f.host.flow.connect(); f.guest.flow.connect(); other.flow.connect();
  await until(f.host.flow, (s) => s.connection === 'connected' && s.room.players.every((p) => p.connected));
  await until(f.guest.flow, (s) => s.connection === 'connected'); await until(other.flow, (s) => s.connection === 'connected');
  expect(f.host.flow.leave()).toBe(false);
  expect(f.guest.flow.leave()).toBe(true);
  // A fresh authoritative response after the close still sees the other tab.
  await f.host.keepAliveRead();
  expect(f.host.flow.getSnapshot().room.players).toHaveLength(2);
  expect(f.host.flow.getSnapshot().room.players.find((p) => p.seatId === f.guest.entry.seatId)?.connected).toBe(true);
  const refreshed = f.guest.restore(); refreshed.start();
  expect(refreshed.getSnapshot().status).toBe('entry'); expect(f.guest.httpPaths).toEqual([]);
  expect(other.flow.leave()).toBe(true);
  const offline = (await until(f.host.flow, (s) => !s.room.players.find((p) => p.seatId === f.guest.entry.seatId)?.connected)).room;
  expect(offline.players.map((p) => [p.seatId, p.nickname])).toEqual(f.host.entry.state.players.map((p) => [p.seatId, p.nickname]));
  expect(offline.hostSeatId).toBe(f.host.entry.seatId);
  const entered = await f.guest.joinAgain(); expect(entered.membership).toBe('resumed'); expect(entered.seatId).toBe(f.guest.entry.seatId);
  const rejoined = f.guest.make(entered); rejoined.connect(); await until(rejoined, (s) => s.connection === 'connected');
  expect(f.guest.recovery.read()?.autoResume).toBeUndefined(); expect(rejoined.getSnapshot().room.players).toHaveLength(2);
}, 15000);

test('guest bidder Leave preserves accepted bids and an active attempt, without Give Up or a new seat', async () => {
  const f = await setup(); f.host.flow.connect(); f.guest.flow.connect();
  await until(f.host.flow, (s) => s.connection === 'connected'); await until(f.guest.flow, (s) => s.connection === 'connected');
  f.host.flow.start(); await until(f.host.flow, (s) => s.room.status === 'playing' && s.start === 'idle');
  await clock(logicalNow + 1, f.roomId);
  await until(f.guest.flow, (s) => s.room.status === 'playing' && s.room.match.phase === 'thinking');
  f.guest.flow.placeBid(8);
  const bidding = (await until(f.guest.flow, (s) => s.bid === 'idle' && s.room.status === 'playing' && s.room.match.phase === 'bidding')).room;
  if (bidding.status !== 'playing' || bidding.match.phase !== 'bidding') throw new Error('Expected bidding');
  expect(f.guest.flow.leave()).toBe(true);
  await until(f.host.flow, (s) => !s.room.players.find((p) => p.seatId === f.guest.entry.seatId)?.connected);
  while (logicalNow < bidding.match.deadlineAtMs) {
    await clock(Math.min(logicalNow + 20000, bidding.match.deadlineAtMs), f.roomId); await f.host.keepAliveRead();
  }
  const demo = (await until(f.host.flow, (s) => s.room.status === 'playing' && s.room.match.phase === 'demonstrating')).room;
  if (demo.status !== 'playing' || demo.match.phase !== 'demonstrating') throw new Error('Expected demonstration');
  expect(demo.match.bidderQueue).toEqual(bidding.match.bids);
  const entered = await f.guest.joinAgain(); const rejoined = f.guest.make(entered); rejoined.connect();
  await until(rejoined, (s) => s.connection === 'connected'); expect(rejoined.leave()).toBe(true);
  const left = (await until(f.host.flow, (s) => !s.room.players.find((p) => p.seatId === f.guest.entry.seatId)?.connected)).room;
  if (left.status !== 'playing' || left.match.phase !== 'demonstrating') throw new Error('Leave must not forfeit');
  expect({ ...left.match, disconnect: demo.match.disconnect }).toEqual(demo.match);
  expect(left.players.map((p) => p.seatId)).toEqual(demo.players.map((p) => p.seatId));
  expect(f.guest.sent.map((text) => JSON.parse(text).command?.type)).not.toContain('attempt.giveUp');
  const grace = left.match.disconnect!;
  f.host.flow.skipDisconnected(); expect(f.host.sent.map((text) => JSON.parse(text).command?.type)).not.toContain('attempt.skipDisconnected');
  while (logicalNow < grace.skipAllowedAtMs) {
    await clock(Math.min(logicalNow + 20000, grace.skipAllowedAtMs), f.roomId); await f.host.keepAliveRead();
  }
  await until(f.host.flow, (s) => s.room.status === 'playing' && s.room.match.phase === 'demonstrating' && s.room.match.disconnect?.status === 'skippable');
  const otherHost = f.host.anotherTab(); otherHost.flow.connect();
  await until(otherHost.flow, (s) => s.connection === 'connected');
  f.host.setDropResults(true); f.host.flow.skipDisconnected(); otherHost.flow.skipDisconnected();
  const result = (await until(f.host.flow, (s) => s.room.status === 'playing' && s.room.match.phase === 'round-result')).room;
  if (result.status !== 'playing' || result.match.phase !== 'round-result') throw new Error('Expected exhausted-queue result');
  expect(result.match.outcome).toEqual({ kind: 'all-bidders-gave-up' });
  expect(result.match.scores).toEqual(demo.match.scores); expect(result.match.officialRobots).toEqual(demo.match.officialRobots);
  await until(otherHost.flow, (s) => s.attempt === 'idle' && s.room.status === 'playing' && s.room.match.phase === 'round-result');
  const original = f.host.recovery.read()!.pending!;
  expect(original.command.type).toBe('attempt.skipDisconnected');
  f.host.flow.disconnect(); f.host.setDropResults(false);
  const restoring = f.host.restore(); restoring.start();
  const restored = await waitFor(restoring.subscribe, () => { const s = restoring.getSnapshot(); return s.status === 'resumed' ? s.entry : undefined; });
  const refreshed = f.host.make(restored); refreshed.connect(); await until(refreshed, (s) => s.connection === 'connected');
  refreshed.retry(); await until(refreshed, (s) => s.attempt === 'idle');
  expect(f.host.received.some((m) => m.type === 'command.result' && m.commandId === original.commandId && m.duplicate)).toBe(true);
  expect(refreshed.getSnapshot().room.status === 'playing' && refreshed.getSnapshot().room).toMatchObject({ match: result.match });
}, 15000);

test('six authenticated clients preserve bids and host authority through host absence, bidder recovery/skip and terminal closure', async () => {
  const f = await setup(6); const peers = [f.host, f.guest, ...f.others];
  for (const peer of peers) { peer.flow.connect(); await until(peer.flow, (s) => s.connection === 'connected'); }
  await until(f.host.flow, (s) => s.room.players.every((p) => p.connected));
  const seats = f.host.entry.state.players.map((p) => p.seatId);
  f.host.flow.start();
  await until(f.host.flow, (s) => s.start === 'idle' && s.room.status === 'playing');
  await clock(logicalNow + 1, f.roomId);
  await until(f.guest.flow, (s) => s.room.status === 'playing' && s.room.match.phase === 'thinking');
  f.host.emit('offline');
  await until(f.guest.flow, (s) => !s.room.players.find((p) => p.seatId === seats[0])?.connected);
  f.guest.flow.placeBid(4);
  await until(f.guest.flow, (s) => s.bid === 'idle' && s.room.status === 'playing' && s.room.match.phase === 'bidding');
  await until(f.others[0].flow, (s) => s.room.status === 'playing' && s.room.match.phase === 'bidding');
  f.others[0].flow.placeBid(3);
  await until(f.others[0].flow, (s) => s.bid === 'idle' && s.room.status === 'playing' && s.room.match.phase === 'bidding' && s.room.match.bids.length === 2);
  f.guest.flow.placeBid(3);
  const bidding = (await until(f.guest.flow, (s) => s.bid === 'idle' && s.room.status === 'playing' && s.room.match.phase === 'bidding' && s.room.match.bids.find((b) => b.seatId === seats[1])?.value === 3)).room;
  if (bidding.status !== 'playing' || bidding.match.phase !== 'bidding') throw new Error('Expected bidding');
  expect(bidding.hostSeatId).toBe(seats[0]);
  f.host.emit('online'); await until(f.host.flow, (s) => s.connection === 'connected');
  while (logicalNow < bidding.match.deadlineAtMs) {
    await clock(Math.min(logicalNow + 20000, bidding.match.deadlineAtMs), f.roomId);
    await Promise.all(peers.map((peer) => peer.keepAliveRead()));
  }
  const demo = (await until(f.host.flow, (s) => s.room.status === 'playing' && s.room.match.phase === 'demonstrating')).room;
  if (demo.status !== 'playing' || demo.match.phase !== 'demonstrating') throw new Error('Expected demonstration');
  expect(demo.match.bidderQueue.map((b) => b.seatId)).toEqual([seats[1], seats[2]]);
  const attempt = demo.match.attempt;
  f.guest.emit('offline');
  await until(f.host.flow, (s) => s.room.status === 'playing' && s.room.match.phase === 'demonstrating' && s.room.match.disconnect?.status === 'grace');
  f.guest.emit('online');
  const recovered = (await until(f.guest.flow, (s) => s.connection === 'connected' && s.room.status === 'playing' && s.room.match.phase === 'demonstrating' && s.room.match.disconnect === null)).room;
  if (recovered.status !== 'playing' || recovered.match.phase !== 'demonstrating') throw new Error('Expected recovered attempt');
  expect(recovered.match.attempt).toEqual(attempt);
  expect(recovered.match.bidderQueue).toEqual(demo.match.bidderQueue);
  f.guest.emit('offline');
  const disconnected = (await until(f.host.flow, (s) => s.room.status === 'playing' && s.room.match.phase === 'demonstrating' && s.room.match.disconnect?.status === 'grace')).room;
  if (disconnected.status !== 'playing' || disconnected.match.phase !== 'demonstrating') throw new Error('Expected grace');
  const beforeSkip = f.host.sent.length; f.host.flow.skipDisconnected(); expect(f.host.sent).toHaveLength(beforeSkip);
  while (logicalNow < disconnected.match.disconnect!.skipAllowedAtMs) {
    await clock(Math.min(logicalNow + 20000, disconnected.match.disconnect!.skipAllowedAtMs), f.roomId);
    await Promise.all([f.host, ...f.others].map((peer) => peer.keepAliveRead()));
  }
  await until(f.host.flow, (s) => s.room.status === 'playing' && s.room.match.phase === 'demonstrating' && s.room.match.disconnect?.status === 'skippable');
  f.host.flow.skipDisconnected();
  const next = (await until(f.host.flow, (s) => s.attempt === 'idle' && s.room.status === 'playing' && s.room.match.phase === 'demonstrating' && s.room.match.activeBidderIndex === 1)).room;
  if (next.status !== 'playing' || next.match.phase !== 'demonstrating') throw new Error('Expected second bidder');
  expect(next.match.attempt.robots).toEqual(demo.match.round.startRobots);
  expect(next.match.officialRobots).toEqual(demo.match.officialRobots);
  expect(next.match.scores).toEqual(demo.match.scores);
  f.guest.emit('online'); await until(f.guest.flow, (s) => s.connection === 'connected');
  const synced = (await until(f.host.flow, (s) => s.room.players.every((p) => p.connected))).room;
  for (const peer of peers) {
    const state = (await until(peer.flow, (s) => s.room.revision >= synced.revision)).room;
    expect(state).toEqual(synced); expect(state.players.map((p) => p.seatId)).toEqual(seats);
    expect(state.hostSeatId).toBe(seats[0]);
  }
  f.host.flow.endRoom();
  for (const peer of peers) {
    await until(peer.flow, (s) => s.connection === 'closed');
    expect(peer.flow.getSnapshot().message).toBe('The host ended this room.');
  }
  const oldCode = await f.guest.api('/api/rooms/join', { version: 2, commandId: crypto.randomUUID(), command: { type: 'room.join', roomCode: synced.roomCode, nickname: 'Guest' } });
  expect(oldCode.status).toBe(409); expect(await oldCode.json()).toMatchObject({ reason: 'room-closed' });
}, 25000);

test('real accepted-but-unacknowledged move survives refresh and exact retry without a second movement', async () => {
  const f = await setup(); f.host.flow.connect(); f.guest.flow.connect();
  await until(f.host.flow, (s) => s.connection === 'connected'); await until(f.guest.flow, (s) => s.connection === 'connected');
  f.host.flow.start(); await until(f.host.flow, (s) => s.room.status === 'playing' && s.start === 'idle');
  await clock(logicalNow + 1, f.roomId);
  await until(f.host.flow, (s) => s.room.status === 'playing' && s.room.match.phase === 'thinking');
  f.host.flow.placeBid(8); await until(f.host.flow, (s) => s.bid === 'idle' && s.room.status === 'playing' && s.room.match.phase === 'bidding');
  f.guest.flow.placeBid(9); await until(f.guest.flow, (s) => s.bid === 'idle' && s.room.status === 'playing' && s.room.match.phase === 'bidding' && s.room.match.bids.length === 2);
  const bidding = f.host.flow.getSnapshot().room;
  if (bidding.status !== 'playing' || bidding.match.phase !== 'bidding') throw new Error('Expected Bidding');
  while (logicalNow < bidding.match.deadlineAtMs) { await clock(Math.min(logicalNow + 20000, bidding.match.deadlineAtMs), f.roomId); await Promise.all([f.host.keepAliveRead(), f.guest.keepAliveRead()]); }
  const demo = (await until(f.host.flow, (s) => s.room.status === 'playing' && s.room.match.phase === 'demonstrating')).room;
  if (demo.status !== 'playing' || demo.match.phase !== 'demonstrating') throw new Error('Expected demonstration');
  const targetId = demo.match.round.targetId;
  const target = demo.puzzle.targets.find((t) => t.id === targetId)!;
  let move: { robotId: (typeof ROBOT_IDS)[number]; direction: (typeof DIRECTIONS)[number] } | undefined;
  for (const robotId of ROBOT_IDS) for (const direction of DIRECTIONS) {
    const candidate = moveRobot(demo.puzzle.board, demo.match.attempt.robots, robotId, direction);
    if (candidate.moved && !isTargetComplete(candidate.robots, target)) move ??= { robotId, direction };
  }
  if (!move) throw new Error('Missing deterministic safe move');
  f.host.setDropResults(true); f.host.flow.move(move.robotId, move.direction);
  const moved = (await until(f.host.flow, (s) => s.room.status === 'playing' && s.room.match.phase === 'demonstrating' && s.room.match.attempt.moveCount === 1)).room;
  const original = f.host.recovery.read()!.pending!; expect(f.host.flow.getSnapshot().attempt).toBe('pending');
  f.host.flow.disconnect(); f.host.setDropResults(false);
  const restoring = f.host.restore(); restoring.start();
  const restored = await waitFor(restoring.subscribe, () => { const s = restoring.getSnapshot(); return s.status === 'resumed' ? s.entry : undefined; });
  const refreshed = f.host.make(restored); refreshed.connect(); await until(refreshed, (s) => s.connection === 'connected');
  expect(refreshed.getSnapshot().attempt).toBe('retry');
  expect(f.host.sent.filter((text) => JSON.parse(text).command?.type === 'attempt.move')).toHaveLength(1);
  refreshed.retry(); await until(refreshed, (s) => s.attempt === 'idle');
  const saved = refreshed.getSnapshot().room;
  expect(saved.status === 'playing' ? saved.match : null).toEqual(moved.status === 'playing' ? moved.match : null);
  const requests = f.host.sent.filter((text) => JSON.parse(text).command?.type === 'attempt.move').map((text) => JSON.parse(text));
  expect(requests).toEqual([original, original]); expect(f.host.recovery.read()?.pending).toBeNull();
  expect(f.host.received.some((m) => m.type === 'command.result' && m.commandId === original.commandId && m.duplicate)).toBe(true);
  expect(f.host.httpPaths).toEqual([`/api/rooms/${f.roomId}/resume`]);
}, 20000);
