import { afterEach, expect, test, vi } from 'vitest';
import { MAX_SERVER_MESSAGE_BYTES } from '@robot-puzzle/shared';
import { roomEntryClient } from './roomEntryClient';
import { entryTestId, roomEnteredFixture } from './roomEntry.testFixture';

afterEach(() => vi.useRealTimers());

const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), {
  status, headers: { 'Content-Type': 'application/json' },
});
const request = (init?: RequestInit) => JSON.parse(init!.body as string) as {
  commandId: string; command: { type: string; nickname?: string };
};
const sessionReady = (commandId: string) => json({ version: 2, type: 'session.ready', commandId, serverTimeMs: 1_000 });
const rejection = (commandId: string, reason: string, status = 503) => json({ version: 2,
  type: 'request.rejected', commandId, serverTimeMs: 1_000, reason }, status);

function setup(handler?: (path: string, init: RequestInit) => Promise<Response> | Response) {
  let nextId = 1;
  const fetcher = vi.fn<typeof fetch>(async (input, init) => {
    if (handler) return handler(String(input), init!);
    const body = request(init);
    return body.command.type === 'session.open' ? sessionReady(body.commandId)
      : json(roomEnteredFixture(body.commandId, body.command.nickname));
  });
  const client = roomEntryClient({ fetch: fetcher, commandId: () => entryTestId(nextId++), isHttps: () => true });
  return { client, fetcher };
}

test('only submits on demand, opens a session before normalized creation, and retains binding/snapshot', async () => {
  const { client, fetcher } = setup();
  expect(fetcher).not.toHaveBeenCalled();
  await client.create('  Jose\u0301  ');
  expect(fetcher.mock.calls.map(([path]) => path)).toEqual(['/api/session', '/api/rooms']);
  const [path, init] = fetcher.mock.calls[1]!;
  expect(path).toBe('/api/rooms');
  expect(request(init).command).toEqual({ type: 'room.create', nickname: 'José' });
  expect(init).toMatchObject({ method: 'POST', credentials: 'same-origin', cache: 'no-store', redirect: 'error',
    headers: { 'Content-Type': 'application/json' } });
  expect(init!.headers).not.toHaveProperty('Cookie');
  const state = client.getSnapshot();
  expect(state.status).toBe('entered');
  if (state.status !== 'entered') throw new Error('Expected entry');
  expect(state.entry.state.roomCode).toBe('ABC234');
  expect(state.entry.state.players[0]!.nickname).toBe('José');
  expect(state.entry.seatId).toBe(state.entry.state.hostSeatId);
  await client.create('Other');
  expect(fetcher).toHaveBeenCalledTimes(2);
});

test('rapid duplicate submissions share one session open and one pending operation', async () => {
  let resolve!: (response: Response) => void;
  const { client, fetcher } = setup((path, init) => path === '/api/session'
    ? new Promise<Response>((done) => { resolve = done; }) : json(roomEnteredFixture(request(init).commandId)));
  const first = client.create('Maria');
  expect(client.getSnapshot()).toEqual({ status: 'pending', action: 'create', nickname: 'Maria' });
  expect(client.create('Alex')).toBe(first);
  expect(client.retry()).toBe(first);
  expect(fetcher).toHaveBeenCalledTimes(1);
  resolve(sessionReady(request(fetcher.mock.calls[0]![1]).commandId));
  await first;
  expect(fetcher).toHaveBeenCalledTimes(2);
});

test('lost create reply retries the exact original request without another session open', async () => {
  let lost = true;
  const { client, fetcher } = setup((path, init) => {
    const body = request(init);
    if (path === '/api/session') return sessionReady(body.commandId);
    if (lost) { lost = false; throw new Error('sensitive internal details'); }
    return json(roomEnteredFixture(body.commandId));
  });
  await client.create('Maria');
  expect(client.getSnapshot()).toMatchObject({ status: 'error', retryable: true, sessionExpired: false });
  expect(JSON.stringify(client.getSnapshot())).not.toContain('sensitive');
  await client.create('Alex'); // Cannot replace an ambiguous pending payload with edited data.
  expect(fetcher.mock.calls[2]![1]!.body).toBe(fetcher.mock.calls[1]![1]!.body);
  expect(request(fetcher.mock.calls[2]![1]).command.nickname).toBe('Maria');
  expect(fetcher.mock.calls.filter(([path]) => path === '/api/session')).toHaveLength(1);
  expect(client.getSnapshot().status).toBe('entered');
});

test('failed session bootstrap can only be explicitly retried, with the same session request', async () => {
  let lost = true;
  const { client, fetcher } = setup((path, init) => {
    const body = request(init);
    if (lost) { lost = false; throw new Error('offline'); }
    return path === '/api/session' ? sessionReady(body.commandId) : json(roomEnteredFixture(body.commandId));
  });
  await client.create('Maria');
  expect(fetcher).toHaveBeenCalledTimes(1);
  await client.retry();
  expect(fetcher.mock.calls[0]![1]!.body).toBe(fetcher.mock.calls[1]![1]!.body);
  expect(client.getSnapshot().status).toBe('entered');
});

test('expired identity does not silently reopen or retry; explicit reset creates a new logical request', async () => {
  let expired = true;
  const { client, fetcher } = setup((path, init) => {
    const body = request(init);
    return path === '/api/session' ? sessionReady(body.commandId)
      : expired ? rejection(body.commandId, 'not-authenticated', 401) : json(roomEnteredFixture(body.commandId));
  });
  await client.create('Maria');
  expect(client.getSnapshot()).toMatchObject({ status: 'error', retryable: false, sessionExpired: true });
  await client.retry();
  await client.create('Alex');
  expect(fetcher).toHaveBeenCalledTimes(2);
  client.startNewSession();
  expect(client.getSnapshot()).toEqual({ status: 'idle' });
  expect(fetcher).toHaveBeenCalledTimes(2); // Reset itself performs no network work.
  expired = false;
  await client.create('Alex');
  expect(fetcher.mock.calls[2]![0]).toBe('/api/session');
  expect(request(fetcher.mock.calls[3]![1]).commandId).not.toBe(request(fetcher.mock.calls[1]![1]).commandId);
  expect(request(fetcher.mock.calls[3]![1]).command.nickname).toBe('Alex');
});

test('definitive ID conflict allows a deliberate fresh request without replacing a valid session', async () => {
  let conflict = true;
  const { client, fetcher } = setup((path, init) => {
    const body = request(init);
    return path === '/api/session' ? sessionReady(body.commandId)
      : conflict ? rejection(body.commandId, 'command-id-conflict', 409) : json(roomEnteredFixture(body.commandId));
  });
  await client.create('Maria');
  expect(client.getSnapshot()).toMatchObject({ status: 'error', retryable: false });
  conflict = false;
  await client.create('Alex');
  expect(request(fetcher.mock.calls[2]![1]).commandId).not.toBe(request(fetcher.mock.calls[1]![1]).commandId);
  expect(fetcher.mock.calls.filter(([path]) => path === '/api/session')).toHaveLength(1);
});

test.each(['rate-limited', 'temporarily-unavailable'])('safe %s errors retain the original creation request', async (reason) => {
  const { client, fetcher } = setup((path, init) => path === '/api/session' ? sessionReady(request(init).commandId)
    : rejection(request(init).commandId, reason, reason === 'rate-limited' ? 429 : 503));
  await client.create('Maria');
  expect(client.getSnapshot()).toMatchObject({ status: 'error', retryable: true });
  await client.retry();
  expect(fetcher.mock.calls[2]![1]!.body).toBe(fetcher.mock.calls[1]![1]!.body);
});

test.each(['wrong-id', 'wrong-type', 'invalid-seat', 'malformed', 'http-error', 'not-json', 'oversized'])('rejects %s room replies without entering', async (kind) => {
  const { client } = setup((path, init) => {
    const body = request(init);
    if (path === '/api/session') return sessionReady(body.commandId);
    const reply = roomEnteredFixture(body.commandId);
    if (kind === 'wrong-id') return json({ ...reply, commandId: entryTestId(999) });
    if (kind === 'wrong-type') return sessionReady(body.commandId);
    if (kind === 'invalid-seat') return json({ ...reply, seatId: entryTestId(999) });
    if (kind === 'malformed') return new Response('{', { headers: { 'Content-Type': 'application/json' } });
    if (kind === 'http-error') return json(reply, 503);
    if (kind === 'not-json') return new Response('<html>Error</html>');
    return new Response('x'.repeat(MAX_SERVER_MESSAGE_BYTES + 1), { headers: { 'Content-Type': 'application/json' } });
  });
  await client.create('Maria');
  expect(client.getSnapshot()).toMatchObject({ status: 'error', retryable: true });
});

test('unexpected session message cannot permit creation', async () => {
  const { client, fetcher } = setup((_path, init) => json(roomEnteredFixture(request(init).commandId)));
  await client.create('Maria');
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(client.getSnapshot().status).toBe('error');
});

test('bad Origin response explains HTTPS configuration without accepting a null-ID reply', async () => {
  const { client } = setup(() => json({ version: 2, type: 'protocol.error', commandId: null,
    serverTimeMs: 1_000, reason: 'invalid-message' }, 403));
  await client.create('Maria');
  expect(client.getSnapshot()).toMatchObject({ status: 'error', message: expect.stringContaining('HTTPS address') });
});

test('invalid nicknames and non-HTTPS addresses cannot submit room requests', async () => {
  const { client, fetcher } = setup();
  for (const name of ['', ' ', 'a'.repeat(25)]) await client.create(name);
  expect(fetcher).not.toHaveBeenCalled();
  const httpClient = roomEntryClient({ fetch: fetcher, isHttps: () => false });
  await httpClient.create('Maria');
  expect(fetcher).not.toHaveBeenCalled();
  expect(httpClient.getSnapshot()).toMatchObject({ status: 'error', retryable: false });
});

test('request timeout is bounded and does not automatically retry', async () => {
  vi.useFakeTimers();
  const fetcher = vi.fn<typeof fetch>((_path, init) => new Promise((_resolve, reject) => {
    init!.signal!.addEventListener('abort', () => reject(new Error('aborted')));
  }));
  const client = roomEntryClient({ fetch: fetcher, commandId: () => entryTestId(1), isHttps: () => true, timeoutMs: 100 });
  const attempt = client.create('Maria');
  await vi.advanceTimersByTimeAsync(100);
  await attempt;
  expect(client.getSnapshot()).toMatchObject({ status: 'error', retryable: true, message: expect.stringContaining('timed out') });
  expect(fetcher).toHaveBeenCalledTimes(1);
});

test('unsubscribing prevents late completion updates to a departed view', async () => {
  const { client } = setup();
  const listener = vi.fn();
  const unsubscribe = client.subscribe(listener);
  const attempt = client.create('Maria');
  expect(listener).toHaveBeenCalledTimes(1);
  unsubscribe();
  await attempt;
  expect(listener).toHaveBeenCalledTimes(1);
  expect(client.getSnapshot().status).toBe('entered');
});

function joined(commandId: string, membership: 'joined' | 'resumed' = 'joined', nickname = 'Alex') {
  const reply = roomEnteredFixture(commandId, nickname);
  const host = { seatId: entryTestId(103), nickname: 'Maria', connected: false };
  return { ...reply, membership, state: { ...reply.state, hostSeatId: host.seatId, players: [host, ...reply.state.players] } };
}

test('join normalizes nickname/code and bootstraps before the existing join endpoint', async () => {
  const { client, fetcher } = setup((path, init) => {
    const body = request(init);
    return path === '/api/session' ? sessionReady(body.commandId) : json(joined(body.commandId));
  });
  await client.join(' Alex ', ' abc234 ');
  expect(fetcher.mock.calls.map(([path]) => path)).toEqual(['/api/session', '/api/rooms/join']);
  expect(request(fetcher.mock.calls[1]![1]).command).toEqual({ type: 'room.join', nickname: 'Alex', roomCode: 'ABC234' });
  expect(client.getSnapshot()).toMatchObject({ status: 'entered', entry: { membership: 'joined', state: { roomCode: 'ABC234' } } });
});

test('lost join reply retains the exact nickname/code/ID and cannot become a create or another join', async () => {
  let lost = true;
  const { client, fetcher } = setup((path, init) => {
    const body = request(init);
    if (path === '/api/session') return sessionReady(body.commandId);
    if (lost) { lost = false; throw new Error('lost'); }
    return json(joined(body.commandId, 'resumed'));
  });
  await client.join('Alex', 'ABC234');
  expect(client.getSnapshot()).toMatchObject({ status: 'error', action: 'join', roomCode: 'ABC234', retryable: true });
  await client.create('Maria'); // Retry must keep the pending join, not switch action.
  expect(fetcher.mock.calls[2]![0]).toBe('/api/rooms/join');
  expect(fetcher.mock.calls[2]![1]!.body).toBe(fetcher.mock.calls[1]![1]!.body);
  expect(fetcher).toHaveBeenCalledTimes(3);
  expect(client.getSnapshot()).toMatchObject({ status: 'entered', entry: { membership: 'resumed' } });
});

test('join blocks concurrent create and edited-code submissions while pending', async () => {
  let resolve!: (value: Response) => void;
  let signalRequested!: () => void;
  const requested = new Promise<void>((done) => { signalRequested = done; });
  const { client, fetcher } = setup((path, init) => path === '/api/session' ? sessionReady(request(init).commandId)
    : new Promise<Response>((done) => { resolve = done; signalRequested(); }));
  const operation = client.join('Alex', 'ABC234');
  expect(client.create('Maria')).toBe(operation);
  expect(client.join('Someone', 'DEF567')).toBe(operation);
  await requested;
  resolve(json(joined(request(fetcher.mock.calls[1]![1]).commandId)));
  await operation;
  expect(fetcher).toHaveBeenCalledTimes(2);
});

test('resumed membership preserves server seat/nickname instead of treating input as a rename', async () => {
  const { client } = setup((path, init) => {
    const body = request(init);
    return path === '/api/session' ? sessionReady(body.commandId) : json(joined(body.commandId, 'resumed', 'Original name'));
  });
  await client.join('Different name', 'ABC234');
  const state = client.getSnapshot();
  expect(state.status).toBe('entered');
  if (state.status !== 'entered') throw new Error('Expected membership');
  expect(state.entry.state.players.find((player) => player.seatId === state.entry.seatId)!.nickname).toBe('Original name');
});

test.each(['room-not-found', 'room-full', 'match-started'])('definitive %s join rejection permits a corrected fresh request', async (reason) => {
  const { client, fetcher } = setup((path, init) => path === '/api/session' ? sessionReady(request(init).commandId)
    : rejection(request(init).commandId, reason, reason === 'room-not-found' ? 404 : 409));
  await client.join('Alex', 'ABC234');
  expect(client.getSnapshot()).toMatchObject({ status: 'error', action: 'join', retryable: false, sessionExpired: false });
  await client.join('Alex', 'DEF567');
  expect(request(fetcher.mock.calls[2]![1]).commandId).not.toBe(request(fetcher.mock.calls[1]![1]).commandId);
  expect(request(fetcher.mock.calls[2]![1]).command).toEqual({ type: 'room.join', nickname: 'Alex', roomCode: 'DEF567' });
});

test.each(['wrong-code', 'created-membership', 'wrong-id'])('join rejects %s responses rather than displaying a different room', async (kind) => {
  const { client } = setup((path, init) => {
    const body = request(init);
    if (path === '/api/session') return sessionReady(body.commandId);
    const reply = joined(body.commandId);
    if (kind === 'created-membership') return json({ ...reply, membership: 'created' });
    if (kind === 'wrong-id') return json({ ...reply, commandId: entryTestId(999) });
    return json({ ...reply, state: { ...reply.state, roomCode: 'DEF567' } });
  });
  await client.join('Alex', 'ABC234');
  expect(client.getSnapshot()).toMatchObject({ status: 'error', action: 'join', retryable: true });
});

test('invalid join drafts never bootstrap a session or send a request', async () => {
  const { client, fetcher } = setup();
  await client.join('Alex', 'ABCD12');
  await client.join('', 'ABC234');
  await client.join('Alex', '');
  expect(fetcher).not.toHaveBeenCalled();
});

test('expired session during joining blocks automatic rejoin and does not create a new identity', async () => {
  const { client, fetcher } = setup((path, init) => path === '/api/session' ? sessionReady(request(init).commandId)
    : rejection(request(init).commandId, 'not-authenticated', 401));
  await client.join('Alex', 'ABC234');
  await client.retry();
  await client.join('Alex', 'ABC234');
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(client.getSnapshot()).toMatchObject({ status: 'error', action: 'join', sessionExpired: true });
});
