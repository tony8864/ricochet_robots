import { env, SELF, runInDurableObject, runDurableObjectAlarm } from 'cloudflare:test';
import { describe, expect, test, vi } from 'vitest';
import { puzzleCatalog } from '@robot-puzzle/puzzles';
import { parseServerMessage, parsePublicRoomState } from '@robot-puzzle/shared';
import {
  CODE_ATTEMPTS, CreationCoordinator, CreationStore, RECOVERY_BATCH_SIZE,
} from '../src/creations';
import type { CreateRequest, CreationRecord, RoomInitialization } from '../src/creations';
import { handleCreateRoomRequest } from '../src/createRoomRoute';

const origin = 'https://localhost:5173';
const sessionId = '10000000-0000-4000-8000-000000000001';
const expiresAt = 1_000_000_000;
const create = (nickname = 'Maria', commandId = crypto.randomUUID()): CreateRequest => ({
  version: 1, commandId, command: { type: 'room.create', nickname },
});
const registry = () => env.REGISTRY.get(env.REGISTRY.idFromName('registry-v1'));
const http = (input: unknown, cookie?: string, extra: Record<string, string> = {}) => new Request('https://localhost:5173/api/rooms', {
  method: 'POST', body: JSON.stringify(input),
  headers: { Origin: origin, 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...extra },
});
async function identity() {
  const opened = await registry().openSession(null);
  if (opened.status !== 'ready' || !opened.credential) throw new Error('Expected identity');
  return { token: opened.credential, cookie: `__Host-rr-session=${opened.credential}`, session: opened.session };
}
async function message(response: Response, status = 200) {
  expect(response.status).toBe(status);
  expect(response.headers.has('Set-Cookie')).toBe(false);
  expect(response.headers.get('Cache-Control')).toBe('no-store');
  const body = await response.json();
  const parsed = parseServerMessage(body);
  if (!parsed.ok) throw new Error('Invalid server reply');
  return parsed.value;
}
async function initialize(input: RoomInitialization) {
  using result = await env.ROOMS.get(env.ROOMS.idFromName(input.roomId)).initialize(input);
  const parsed = parsePublicRoomState(JSON.parse(JSON.stringify(result)));
  if (!parsed.ok) throw new Error('Invalid test lobby');
  return parsed.value;
}
function store(storage: DurableObjectStorage, code = () => 'AAAAAA', now = () => 1_000_000) {
  return new CreationStore(storage, { now, code, uuid: () => crypto.randomUUID(), puzzle: () => puzzleCatalog[0] });
}
function reservation(value: ReturnType<CreationStore['reserve']>): CreationRecord {
  if (value.status === 'rejected') throw new Error(`Expected reservation, got ${value.reason}`);
  return value;
}

describe('authenticated room creation boundary', () => {
  test('creates one private-bound host seat with a complete catalog board and no match/target', async () => {
    const user = await identity();
    const response = await SELF.fetch(http(create('  Maria  '), user.cookie));
    const result = await message(response);
    if (result.type !== 'room.entered') throw new Error('Expected membership');
    expect(result.membership).toBe('created');
    expect(result.state.status).toBe('lobby');
    expect(result.state.revision).toBe(1);
    expect(result.state.players).toEqual([{ seatId: result.seatId, nickname: 'Maria', connected: false }]);
    expect(result.state.hostSeatId).toBe(result.seatId);
    expect(result.state.puzzle.targets).toHaveLength(17);
    expect(puzzleCatalog.some((entry) => entry.id === result.state.puzzle.id)).toBe(true);
    expect('match' in result.state).toBe(false);
    const json = JSON.stringify(result);
    expect(json).not.toContain(user.token);
    expect(json).not.toContain(user.session.sessionId);
    expect(json).not.toContain('initialization');
    await runInDurableObject(env.ROOMS.get(env.ROOMS.idFromName(result.roomId)), async (_instance, ctx) => {
      const row = ctx.storage.sql.exec<{ value: string }>('SELECT value FROM room_state').one();
      const saved = JSON.parse(row.value);
      expect(saved.members).toEqual({ [user.session.sessionId]: result.seatId });
      expect(saved.state).toEqual(result.state);
    });
  });

  test('concurrent identical creates and normalized/reordered retries return one room/seat/code', async () => {
    const user = await identity();
    const input = create();
    const results = await Promise.all(Array.from({ length: 3 }, async () => message(await SELF.fetch(http(input, user.cookie)))));
    expect(results[0].type).toBe('room.entered');
    for (const result of results) {
      if (result.type !== 'room.entered' || results[0].type !== 'room.entered') throw new Error('Expected room');
      expect(result.state).toEqual(results[0].state);
      expect(result.seatId).toBe(results[0].seatId);
    }
    const reordered = { command: { nickname: ' Maria ', type: 'room.create' }, commandId: input.commandId, version: 1 };
    expect((await message(await SELF.fetch(http(reordered, user.cookie)))).type).toBe('room.entered');
    await runInDurableObject(registry(), async (_instance, ctx) => {
      expect(ctx.storage.sql.exec('SELECT COUNT(*) AS count FROM room_creations').one()).toEqual({ count: 1 });
    });
  });

  test('conflicting reuse does not overwrite the original; another session cannot replay its seat', async () => {
    const first = await identity();
    const second = await identity();
    const input = create();
    const original = await message(await SELF.fetch(http(input, first.cookie)));
    const conflict = await message(await SELF.fetch(http(create('Alex', input.commandId), first.cookie)), 409);
    expect(conflict).toMatchObject({ type: 'request.rejected', reason: 'command-id-conflict' });
    const other = await message(await SELF.fetch(http(input, second.cookie)));
    if (original.type !== 'room.entered' || other.type !== 'room.entered') throw new Error('Expected rooms');
    expect(other.roomId).not.toBe(original.roomId);
    expect(other.seatId).not.toBe(original.seatId);
    const replay = await message(await SELF.fetch(http(input, first.cookie)));
    if (replay.type !== 'room.entered') throw new Error('Expected replay');
    expect(replay.state).toEqual(original.state);
  });

  test.each([undefined, '__Host-rr-session=bad', `__Host-rr-session=${'f'.repeat(64)}`,
    `__Host-rr-session=${'f'.repeat(64)}; __Host-rr-session=${'e'.repeat(64)}`])(
    'missing/invalid/unknown/ambiguous cookie cannot create: %s', async (cookie) => {
      expect(await message(await SELF.fetch(http(create(), cookie)), 401)).toMatchObject({
        type: 'request.rejected', reason: 'not-authenticated',
      });
    },
  );

  test.each(['expired', 'revoked'])('%s identity cannot create a room', async (kind) => {
    const user = await identity();
    await runInDurableObject(registry(), async (_instance, ctx) => {
      ctx.storage.sql.exec(kind === 'expired' ? 'UPDATE browser_sessions SET expires_at = 0'
        : 'UPDATE browser_sessions SET revoked_at = 1');
    });
    expect(await message(await SELF.fetch(http(create(), user.cookie)), 401)).toMatchObject({ reason: 'not-authenticated' });
    await runInDurableObject(registry(), async (_instance, ctx) => {
      expect(ctx.storage.sql.exec('SELECT COUNT(*) AS count FROM room_creations').one()).toEqual({ count: 0 });
    });
  });

  test.each([
    [{ Origin: 'https://evil.test' }, 403], [{ Origin: '' }, 403],
    [{ 'Content-Type': 'text/plain' }, 415],
  ] as const)('rejects unsafe transport configuration', async (headers, status) => {
    const user = await identity();
    expect((await message(await SELF.fetch(http(create(), user.cookie, headers)), status)).type).toBe('protocol.error');
  });

  test.each([
    { version: 1, commandId: sessionId, command: { type: 'room.create', nickname: '' } },
    { ...create(), hostSeatId: sessionId },
    { version: 1, commandId: sessionId, command: { type: 'session.open' } },
  ])('rejects invalid/forged/wrong commands before creation', async (input) => {
    const user = await identity();
    expect((await message(await SELF.fetch(http(input, user.cookie)), 400)).type).toBe('protocol.error');
  });

  test('oversized body is rejected without creation', async () => {
    const user = await identity();
    expect(await message(await SELF.fetch(http(create('x'.repeat(5000)), user.cookie)), 413))
      .toMatchObject({ type: 'protocol.error', reason: 'message-too-large' });
  });

  test('server failures disclose no private credential or exception text', async () => {
    const user = await identity();
    const broken = { ...env, REGISTRY: { idFromName() { throw new Error(user.token); } } } as unknown as Env;
    const result = await message(await handleCreateRoomRequest(http(create(), user.cookie), broken), 503);
    expect(result).toMatchObject({ reason: 'temporarily-unavailable' });
    expect(JSON.stringify(result)).not.toContain(user.token);
  });
});

describe('durable reservation, initialization and recovery', () => {
  test('code collisions retry without replacing an existing reservation; exhaustion is bounded', async () => {
    await runInDurableObject(registry(), async (_instance, ctx) => {
      const first = reservation(store(ctx.storage).reserve(sessionId, expiresAt, create()));
      let attempts = 0;
      const second = reservation(store(ctx.storage, () => ++attempts === 1 ? 'AAAAAA' : 'BBBBBB')
        .reserve(sessionId, expiresAt, create()));
      expect(attempts).toBe(2);
      expect(second.initialization.roomCode).toBe('BBBBBB');
      expect(store(ctx.storage).lookup(first.initialization.roomCode)).toEqual({ status: 'pending' });
      attempts = 0;
      expect(store(ctx.storage, () => { attempts++; return 'AAAAAA'; }).reserve(sessionId, expiresAt, create()))
        .toEqual({ status: 'rejected', reason: 'temporarily-unavailable' });
      expect(attempts).toBe(CODE_ATTEMPTS);
      expect(ctx.storage.sql.exec('SELECT COUNT(*) AS count FROM room_creations').one()).toEqual({ count: 2 });
    });
  });

  test.each(['before-reservation', 'after-reservation', 'before-init', 'after-init', 'before-publication', 'after-publication'])(
    'interruption %s converges on one logical room on retry', async (phase) => {
      await runInDurableObject(registry(), async (_instance, ctx) => {
        const records = store(ctx.storage);
        const input = create();
        if (phase === 'before-reservation') {
          expect(ctx.storage.sql.exec('SELECT COUNT(*) AS count FROM room_creations').one()).toEqual({ count: 0 });
        }
        const reserved = reservation(records.reserve(sessionId, expiresAt, input));
        const original = reserved.initialization;
        const coordinator = new CreationCoordinator(records, async (value) => {
          if (phase === 'before-init') throw new Error('injected before init');
          const state = await initialize(value);
          if (phase === 'after-init') throw new Error('injected after init');
          return state;
        });
        if (phase === 'before-init' || phase === 'after-init') {
          await expect(coordinator.complete(reserved)).rejects.toThrow('injected');
        } else if (phase === 'before-publication' || phase === 'after-publication') {
          const publish = records.publish.bind(records);
          const injected = vi.spyOn(records, 'publish').mockImplementation((value) => {
            if (phase === 'after-publication') publish(value);
            throw new Error('injected publication/reply loss');
          });
          await expect(coordinator.complete(reserved)).rejects.toThrow('injected');
          injected.mockRestore();
        }
        const retry = reservation(records.reserve(sessionId, expiresAt, input));
        expect(retry.initialization).toEqual(original);
        const recovered = await new CreationCoordinator(records, initialize).complete(retry);
        expect(recovered.state.roomId).toBe(original.roomId);
        expect(recovered.state.players).toHaveLength(1);
        expect(records.lookup(original.roomCode)).toEqual({ status: 'published', roomId: original.roomId });
      });
    },
  );

  test('Room refuses a changed initialization or a reservation for another object', async () => {
    await runInDurableObject(registry(), async (_instance, ctx) => {
      const reserved = reservation(store(ctx.storage).reserve(sessionId, expiresAt, create()));
      const original = await initialize(reserved.initialization);
      const room = env.ROOMS.get(env.ROOMS.idFromName(reserved.initialization.roomId));
      await runInDurableObject(room, async (instance) => {
        await expect(instance.initialize({ ...reserved.initialization, nickname: 'Other' })).rejects.toThrow('initialization conflict');
      });
      const wrongRoom = env.ROOMS.get(env.ROOMS.idFromName(crypto.randomUUID()));
      await runInDurableObject(wrongRoom, async (instance) => {
        await expect(instance.initialize(reserved.initialization)).rejects.toThrow('identity mismatch');
      });
      expect(await initialize(reserved.initialization)).toEqual(original);
    });
  });

  test('maintenance alarm recovers durable pending work without any public seed route', async () => {
    const user = await identity();
    let expected: RoomInitialization | undefined;
    await runInDurableObject(registry(), async (_instance, ctx) => {
      const reserved = reservation(store(ctx.storage, () => 'BBBBBB', () => Date.now() - 120_000)
        .reserve(user.session.sessionId, user.session.expiresAt, create()));
      expected = reserved.initialization;
      // The helper invokes it explicitly; avoid racing an automatically due alarm.
      await ctx.storage.setAlarm(Date.now() + 60_000);
    });
    expect(await runDurableObjectAlarm(registry())).toBe(true);
    await runInDurableObject(registry(), async (_instance, ctx) => {
      expect(new CreationStore(ctx.storage).lookup(expected!.roomCode)).toEqual({ status: 'published', roomId: expected!.roomId });
    });
  });

  test('per-session rate limit counts retries; a later window permits replay without extra allocation', async () => {
    await runInDurableObject(registry(), async (_instance, ctx) => {
      let now = 1_000_000;
      const records = store(ctx.storage, () => 'AAAAAA', () => now);
      const input = create();
      const first = reservation(records.reserve(sessionId, expiresAt, input));
      for (let index = 0; index < 4; index++) expect(records.reserve(sessionId, expiresAt, input)).toEqual(first);
      expect(records.reserve(sessionId, expiresAt, input)).toEqual({ status: 'rejected', reason: 'rate-limited' });
      now += 60_000;
      expect(records.reserve(sessionId, expiresAt, input)).toEqual(first);
      expect(records.reserve(sessionId, now, create())).toEqual({ status: 'rejected', reason: 'not-authenticated' });
    });
  });

  test('pending maintenance batches are bounded', async () => {
    await runInDurableObject(registry(), async (_instance, ctx) => {
      let sequence = 0;
      const records = store(ctx.storage, () => `AAAA${'ABCDEFGHJKLMNPQRSTUVWXYZ'[sequence++]}A`);
      for (let index = 0; index < 12; index++) {
        const reserved = reservation(records.reserve(crypto.randomUUID(), expiresAt, create()));
        records.defer(reserved.initialization);
      }
      ctx.storage.sql.exec('UPDATE room_creations SET next_retry_at = 0');
      expect(records.pending()).toHaveLength(RECOVERY_BATCH_SIZE);
    });
  });

  test('twenty-room lifetime cap does not evict or block replay of an existing creation', async () => {
    await runInDurableObject(registry(), async (_instance, ctx) => {
      let now = 1_000_000;
      let sequence = 0;
      const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
      const records = store(ctx.storage, () => `AAAA${alphabet[Math.floor(sequence / 32)]}${alphabet[sequence++ % 32]}`, () => now);
      const firstInput = create();
      const first = reservation(records.reserve(sessionId, expiresAt, firstInput));
      for (let index = 1; index < 20; index++) {
        now += 60_000;
        reservation(records.reserve(sessionId, expiresAt, create()));
      }
      now += 60_000;
      expect(records.reserve(sessionId, expiresAt, create())).toEqual({ status: 'rejected', reason: 'temporarily-unavailable' });
      expect(records.reserve(sessionId, expiresAt, firstInput)).toEqual(first);
      expect(ctx.storage.sql.exec('SELECT COUNT(*) AS count FROM room_creations').one()).toEqual({ count: 20 });
    });
  });

  test('global capacity includes pending reservations; existing replay remains available', async () => {
    await runInDurableObject(registry(), async (_instance, ctx) => {
      const records = store(ctx.storage);
      const input = create();
      const first = reservation(records.reserve(sessionId, expiresAt, input));
      // Synthetic private rows exercise the count only; none is published/resolved.
      ctx.storage.sql.exec(`WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM n WHERE x < 999)
        INSERT INTO room_creations
        SELECT 'fixture-session', printf('command-%d', x), request_json, printf('room-%d', x),
          printf('code-%d', x), initialization_json, 'pending', next_retry_at FROM n, room_creations WHERE room_id = ?`, first.initialization.roomId);
      expect(records.reserve(crypto.randomUUID(), expiresAt, create())).toEqual({ status: 'rejected', reason: 'temporarily-unavailable' });
      expect(records.reserve(sessionId, expiresAt, input)).toEqual(first);
      expect(ctx.storage.sql.exec('SELECT COUNT(*) AS count FROM room_creations').one()).toEqual({ count: 1000 });
    });
  });
});
