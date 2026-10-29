import { env, SELF, runInDurableObject } from 'cloudflare:test';
import { describe, expect, test, vi } from 'vitest';
import { parsePublicRoomState, parseServerMessage } from '@robot-puzzle/shared';
import { MembershipStore } from '../src/roomMembership';
import type { MembershipRequest, StoredRoom } from '../src/roomMembership';
import { CreationStore } from '../src/creations';
import { handleMembershipRequest } from '../src/membershipRoute';

const origin = 'https://localhost:5173';
const registry = () => env.REGISTRY.get(env.REGISTRY.idFromName('registry-v1'));
const roomStub = (id: string) => env.ROOMS.get(env.ROOMS.idFromName(id));
const join = (roomCode: string, nickname = 'Maria', commandId = crypto.randomUUID()): MembershipRequest => ({
  version: 1, commandId, command: { type: 'room.join', nickname, roomCode },
});
const resume = (roomId: string, commandId = crypto.randomUUID()): MembershipRequest => ({
  version: 1, commandId, command: { type: 'session.resume', roomId },
});
const path = (id: string) => `/api/rooms/${id}/resume`;
function request(endpoint: string, body: unknown, cookie?: string, headers: Record<string, string> = {}) {
  return new Request(`${origin}${endpoint}`, { method: 'POST', body: JSON.stringify(body),
    headers: { Origin: origin, 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...headers } });
}
async function response(endpoint: string, body: unknown, cookie?: string, status = 200) {
  const reply = await SELF.fetch(request(endpoint, body, cookie));
  expect(reply.status).toBe(status);
  expect(reply.headers.has('Set-Cookie')).toBe(false);
  expect(reply.headers.get('Cache-Control')).toBe('no-store');
  const parsed = parseServerMessage(await reply.json());
  if (!parsed.ok) throw new Error('Expected valid protocol reply');
  return parsed.value;
}
async function entered(endpoint: string, body: unknown, cookie: string) {
  const reply = await response(endpoint, body, cookie);
  if (reply.type !== 'room.entered') throw new Error('Expected membership');
  return reply;
}
async function identity() {
  using opened = await registry().openSession(null);
  if (opened.status !== 'ready' || !opened.credential) throw new Error('Expected identity');
  return { cookie: `__Host-rr-session=${opened.credential}`, token: opened.credential, session: opened.session };
}
async function lobby() {
  const owner = await identity();
  const state = await entered('/api/rooms', {
    version: 1, commandId: crypto.randomUUID(), command: { type: 'room.create', nickname: 'Host' },
  }, owner.cookie);
  return { owner, ...state };
}

describe('join and resume endpoints', () => {
  test('two cookie jars share the roster/board, not private identities; code and nickname normalize', async () => {
    const room = await lobby();
    const guest = await identity();
    const joined = await entered('/api/rooms/join', join(` ${room.state.roomCode.toLowerCase()} `, ' Maria '), guest.cookie);
    expect(joined.membership).toBe('joined');
    expect(joined.seatId).not.toBe(room.seatId);
    expect(joined.state.hostSeatId).toBe(room.seatId);
    expect(joined.state.players.map((p) => p.nickname)).toEqual(['Host', 'Maria']);
    expect(joined.state.players.every((p) => !p.connected)).toBe(true);
    expect(joined.state.revision).toBe(2);
    const resumed = await entered(path(room.roomId), resume(room.roomId), room.owner.cookie);
    expect(resumed.membership).toBe('resumed');
    expect(resumed.seatId).toBe(room.seatId);
    expect(resumed.state).toEqual(joined.state);
    const json = JSON.stringify(joined);
    for (const secret of [guest.token, room.owner.token, guest.session.sessionId, room.owner.session.sessionId]) {
      expect(json).not.toContain(secret);
    }
    expect(await registry().verifySession(guest.token)).toEqual(guest.session);
  });

  test('concurrent duplicate joins allocate one seat; retry reads current state rather than the old snapshot', async () => {
    const room = await lobby();
    const guest = await identity();
    const input = join(room.state.roomCode);
    const replies = await Promise.all(Array.from({ length: 3 }, () => entered('/api/rooms/join', input, guest.cookie)));
    expect(new Set(replies.map((r) => r.seatId)).size).toBe(1);
    expect(replies.every((r) => r.membership === 'joined' && r.state.players.length === 2)).toBe(true);
    const another = await identity();
    const latest = await entered('/api/rooms/join', join(room.state.roomCode, 'Alex'), another.cookie);
    const replay = await entered('/api/rooms/join', input, guest.cookie);
    expect(replay.state).toEqual(latest.state);
    expect(replay.seatId).toBe(replies[0].seatId);
    await runInDurableObject(roomStub(room.roomId), (_instance, ctx) => {
      expect(ctx.storage.sql.exec('SELECT processed_revision FROM membership_replays WHERE command_id = ?', input.commandId).one())
        .toEqual({ processed_revision: 2 });
    });
  });

  test('rejoining never renames/reallocates; command-ID conflicts span join and resume in the same room', async () => {
    const room = await lobby();
    const guest = await identity();
    const input = join(room.state.roomCode);
    const first = await entered('/api/rooms/join', input, guest.cookie);
    expect(await response('/api/rooms/join', join(room.state.roomCode, 'Alex', input.commandId), guest.cookie, 409))
      .toMatchObject({ reason: 'command-id-conflict' });
    expect(await response(path(room.roomId), resume(room.roomId, input.commandId), guest.cookie, 409))
      .toMatchObject({ reason: 'command-id-conflict' });
    const rejoin = await entered('/api/rooms/join', join(room.state.roomCode, 'Alex'), guest.cookie);
    expect(rejoin.membership).toBe('resumed');
    expect(rejoin.seatId).toBe(first.seatId);
    expect(rejoin.state).toEqual(first.state);
  });

  test('identical nicknames and command IDs in different sessions do not impersonate another member', async () => {
    const room = await lobby();
    const first = await identity();
    const second = await identity();
    const input = join(room.state.roomCode, 'Host');
    const a = await entered('/api/rooms/join', input, first.cookie);
    const b = await entered('/api/rooms/join', input, second.cookie);
    expect(a.seatId).not.toBe(b.seatId);
    expect(b.state.players.map((p) => p.nickname)).toEqual(['Host', 'Host', 'Host']);
    expect(b.state.hostSeatId).toBe(room.seatId);
  });

  test('two concurrent joins at five seats admit one sixth player; existing members still resume', async () => {
    const room = await lobby();
    for (let index = 0; index < 4; index++) {
      const user = await identity();
      await entered('/api/rooms/join', join(room.state.roomCode, `Player ${index}`), user.cookie);
    }
    const candidates = await Promise.all([identity(), identity()]);
    const replies = await Promise.all(candidates.map((user) => SELF.fetch(request('/api/rooms/join', join(room.state.roomCode), user.cookie))));
    expect(replies.map((r) => r.status).sort()).toEqual([200, 409]);
    const rejected = await replies.find((r) => r.status === 409)!.json();
    expect(rejected).toMatchObject({ type: 'request.rejected', reason: 'room-full' });
    const resumed = await entered(path(room.roomId), resume(room.roomId), room.owner.cookie);
    expect(resumed.state.players).toHaveLength(6);
    expect(resumed.state.revision).toBe(6);
    const rejoined = await entered('/api/rooms/join', join(room.state.roomCode, 'Changed'), room.owner.cookie);
    expect(rejoined.seatId).toBe(room.seatId);
    expect(rejoined.state).toEqual(resumed.state);
  });

  test('resume cannot allocate a seat and preserves a recorded rejection even after a later join', async () => {
    const room = await lobby();
    const outsider = await identity();
    const input = resume(room.roomId);
    expect(await response(path(room.roomId), input, outsider.cookie, 403)).toMatchObject({ reason: 'seat-not-found' });
    const joined = await entered('/api/rooms/join', join(room.state.roomCode), outsider.cookie);
    expect(await response(path(room.roomId), input, outsider.cookie, 403)).toMatchObject({ reason: 'seat-not-found' });
    const current = await entered(path(room.roomId), resume(room.roomId), outsider.cookie);
    expect(current.seatId).toBe(joined.seatId);
    expect(current.state.players).toHaveLength(2);
  });

  test('locked-match fixture rejects new members but permits existing join/resume without modifying the match', async () => {
    const room = await lobby();
    const guest = await identity();
    await entered('/api/rooms/join', join(room.state.roomCode), guest.cookie);
    await runInDurableObject(roomStub(room.roomId), (_instance, ctx) => {
      const row = ctx.storage.sql.exec<{ value: string }>('SELECT value FROM room_state').one();
      const saved = JSON.parse(row.value) as StoredRoom;
      const { lobbyId: _unused, ...base } = saved.state as Extract<StoredRoom['state'], { status: 'lobby' }>;
      const locked = { ...base, status: 'playing', revision: base.revision + 1,
        match: { matchId: crypto.randomUUID(), phase: 'preparing', completedRounds: 0,
          scores: Object.fromEntries(base.players.map((p) => [p.seatId, 0])), officialRobots: base.puzzle.initialRobots,
          usedTargetIds: [], preparation: { status: 'working' } } };
      expect(parsePublicRoomState(locked).ok).toBe(true);
      ctx.storage.sql.exec('UPDATE room_state SET value = ?', JSON.stringify({ ...saved, state: locked }));
    });
    const outsider = await identity();
    expect(await response('/api/rooms/join', join(room.state.roomCode), outsider.cookie, 409)).toMatchObject({ reason: 'match-started' });
    const resumed = await entered(path(room.roomId), resume(room.roomId), guest.cookie);
    const rejoined = await entered('/api/rooms/join', join(room.state.roomCode, 'New name'), guest.cookie);
    expect(resumed.state.status).toBe('playing');
    expect(rejoined.state).toEqual(resumed.state);
    expect(rejoined.seatId).toBe(resumed.seatId);
  });

  test.each(['join', 'resume'] as const)('unauthenticated %s reveals no room existence details', async (kind) => {
    for (const cookie of [undefined, '__Host-rr-session=bad', `__Host-rr-session=${'a'.repeat(64)}`,
      `__Host-rr-session=${'a'.repeat(64)}; __Host-rr-session=${'b'.repeat(64)}`]) {
      const roomId = crypto.randomUUID();
      expect(await response(kind === 'join' ? '/api/rooms/join' : path(roomId), kind === 'join' ? join('AAAAAA') : resume(roomId), cookie, 401))
        .toMatchObject({ reason: 'not-authenticated' });
    }
  });

  test.each(['expired', 'revoked'] as const)('%s identity cannot regain its seat by name', async (kind) => {
    const room = await lobby();
    await runInDurableObject(registry(), (_instance, ctx) => {
      ctx.storage.sql.exec(kind === 'expired' ? 'UPDATE browser_sessions SET expires_at = 0'
        : 'UPDATE browser_sessions SET revoked_at = 1');
    });
    expect(await response('/api/rooms/join', join(room.state.roomCode, 'Host'), room.owner.cookie, 401)).toMatchObject({ reason: 'not-authenticated' });
    expect(await response(path(room.roomId), resume(room.roomId), room.owner.cookie, 401)).toMatchObject({ reason: 'not-authenticated' });
  });

  test('unknown code/room and route/body mismatch fail without creating a room', async () => {
    const user = await identity();
    expect(await response('/api/rooms/join', join('AAAAAA'), user.cookie, 404)).toMatchObject({ reason: 'room-not-found' });
    const id = crypto.randomUUID();
    expect(await response(path(id), resume(id), user.cookie, 404)).toMatchObject({ reason: 'room-not-found' });
    expect(await response(path(id), resume(crypto.randomUUID()), user.cookie, 400)).toMatchObject({ reason: 'invalid-message' });
    await runInDurableObject(registry(), (_instance, ctx) => {
      expect(ctx.storage.sql.exec('SELECT COUNT(*) AS count FROM room_creations').one()).toEqual({ count: 0 });
    });
  });

  test('pending reservations are not joinable or resumable before publication', async () => {
    const user = await identity();
    let pendingId = '';
    await runInDurableObject(registry(), (_instance, ctx) => {
      const record = new CreationStore(ctx.storage).reserve(user.session.sessionId, user.session.expiresAt, {
        version: 1, commandId: crypto.randomUUID(), command: { type: 'room.create', nickname: 'Host' },
      });
      if (record.status === 'rejected') throw new Error('Expected reservation');
      pendingId = record.initialization.roomId;
      ctx.storage.sql.exec("UPDATE room_creations SET room_code = 'AAAAAA'");
    });
    expect(await response('/api/rooms/join', join('AAAAAA'), user.cookie, 503)).toMatchObject({ reason: 'temporarily-unavailable' });
    expect(await response(path(pendingId), resume(pendingId), user.cookie, 503)).toMatchObject({ reason: 'temporarily-unavailable' });
  });

  test.each(['join', 'resume'] as const)('%s enforces method, Origin, content type, byte bounds, and exact command shape', async (kind) => {
    const room = await lobby();
    const user = await identity();
    const endpoint = kind === 'join' ? '/api/rooms/join' : path(room.roomId);
    const input = kind === 'join' ? join(room.state.roomCode) : resume(room.roomId);
    for (const [headers, status] of [[{ Origin: 'https://evil.test' }, 403], [{ 'Content-Type': 'text/plain' }, 415]] as const) {
      expect((await SELF.fetch(request(endpoint, input, user.cookie, headers))).status).toBe(status);
    }
    expect((await SELF.fetch(`${origin}${endpoint}`, { method: 'GET' })).status).toBe(405);
    expect(await response(endpoint, { ...input, seatId: room.seatId }, user.cookie, 400)).toMatchObject({ reason: 'invalid-message' });
    expect(await response(endpoint, { ...input, extra: 'x'.repeat(5000) }, user.cookie, 413)).toMatchObject({ reason: 'message-too-large' });
  });

  test('Registry outage returns a bounded private error', async () => {
    const user = await identity();
    const broken = { ...env, REGISTRY: { idFromName() { throw new Error(user.token); } } } as unknown as Env;
    const result = await handleMembershipRequest(request('/api/rooms/join', join('AAAAAA'), user.cookie), broken);
    expect(result.status).toBe(503);
    const text = await result.text();
    expect(text).toContain('temporarily-unavailable');
    expect(text).not.toContain(user.token);
  });
});

describe('membership durability and resource protection', () => {
  test('membership, revision and replay outcome roll back together when ledger persistence fails', async () => {
    const room = await lobby();
    const user = await identity();
    const input = join(room.state.roomCode);
    await runInDurableObject(roomStub(room.roomId), (_instance, ctx) => {
      ctx.storage.sql.exec(`CREATE TRIGGER fail_membership BEFORE INSERT ON membership_replays
        BEGIN SELECT RAISE(ABORT, 'injected ledger failure'); END`);
      expect(() => new MembershipStore(ctx.storage).enter(user.session, input)).toThrow('injected ledger failure');
      const saved = JSON.parse(ctx.storage.sql.exec<{ value: string }>('SELECT value FROM room_state').one().value) as StoredRoom;
      expect(saved.state.revision).toBe(1);
      expect(saved.state.players).toHaveLength(1);
      expect(saved.members[user.session.sessionId]).toBeUndefined();
      ctx.storage.sql.exec('DROP TRIGGER fail_membership');
    });
    expect((await entered('/api/rooms/join', input, user.cookie)).state.revision).toBe(2);
  });

  test('expired trusted session context cannot allocate or record an outcome at the Room boundary', async () => {
    const room = await lobby();
    const user = await identity();
    await runInDurableObject(roomStub(room.roomId), (_instance, ctx) => {
      const store = new MembershipStore(ctx.storage, { now: () => user.session.expiresAt, uuid: () => crypto.randomUUID() });
      expect(store.enter(user.session, join(room.state.roomCode))).toEqual({ status: 'rejected', reason: 'not-authenticated' });
      expect(ctx.storage.sql.exec('SELECT COUNT(*) AS count FROM membership_replays').one()).toEqual({ count: 0 });
    });
  });

  test.each(['session', 'room'] as const)('%s replay capacity fails closed while existing retries remain available', async (capacity) => {
    const room = await lobby();
    const user = await identity();
    const input = join(room.state.roomCode);
    const original = await entered('/api/rooms/join', input, user.cookie);
    await runInDurableObject(roomStub(room.roomId), (_instance, ctx) => {
      const count = capacity === 'session' ? 9999 : 99999;
      const owner = capacity === 'session' ? user.session.sessionId : 'other-fixture-owner';
      ctx.storage.sql.exec(`WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM n WHERE x < ?)
        INSERT INTO membership_replays SELECT ?, printf('fixture-%d', x), '{}', '{}', 2 FROM n`, count, owner);
      const store = new MembershipStore(ctx.storage);
      expect(store.enter(user.session, resume(room.roomId))).toEqual({ status: 'rejected', reason: 'temporarily-unavailable' });
      expect(store.enter(user.session, input)).toMatchObject({ status: 'entered', seatId: original.seatId, state: original.state });
    });
  });

  test('create/join/resume share the durable 30-request/minute budget, including retries', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
    try {
      const room = await lobby();
      await runInDurableObject(registry(), (_instance, ctx) => {
        ctx.storage.sql.exec('UPDATE bootstrap_budgets SET total_count = 29 WHERE session_id = ?', room.owner.session.sessionId);
      });
      const input = resume(room.roomId);
      await entered(path(room.roomId), input, room.owner.cookie);
      expect(await response('/api/rooms/join', join(room.state.roomCode, 'Host'), room.owner.cookie, 429)).toMatchObject({ reason: 'rate-limited' });
      clock.mockReturnValue(1_060_000);
      expect((await entered(path(room.roomId), input, room.owner.cookie)).state).toEqual(room.state);
    } finally { clock.mockRestore(); }
  });
});
