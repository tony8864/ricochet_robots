import { env, runInDurableObject } from 'cloudflare:test';
import { expect, test, vi } from 'vitest';
import { createMatch, prepareMatchRound, transitionMatch } from '@robot-puzzle/match';
import { starterBoard } from '@robot-puzzle/puzzles';
import { RECOMMENDED_ROUND_SETUP_BUDGET } from '@robot-puzzle/puzzles/round-setup';
import { projectLobbyState, type RoomRequest } from '@robot-puzzle/shared';
import { executeLobbyCommand, expireBidding, readLobbyReceipt, saveRoom, storedRoom } from '../src/lobbyCommands';
import { projectStoredMatch, type StoredMatch } from '../src/storedMatch';
import { MembershipStore, type StoredRoom } from '../src/roomMembership';
import { commitPreparationResult, queuedPreparation, runPreparationAlarm } from '../src/roomPreparation';
import { expireEmptyRoom, flushRoomTerminal, terminalDue, terminalRoom, TERMINAL_RETENTION_MS } from '../src/roomTerminal';
import { CreationStore, initializeCreations } from '../src/creations';
import { initializeSessions } from '../src/sessions';
import { PresenceStore } from '../src/presence';
import { EMPTY_ROOM_TIMEOUT_MS, emptyRoomTimeout } from '../src/emptyRoomPolicy';

type Phase = 'lobby' | 'preparing' | 'thinking' | 'bidding' | 'demonstrating' | 'round-result' | 'finished';
function seed(storage: DurableObjectStorage, phase: Phase): StoredRoom {
  const players = ['Host', 'Guest'].map((nickname) => ({ seatId: crypto.randomUUID(), nickname, connected: false }));
  const projected = projectLobbyState({ roomId: crypto.randomUUID(), roomCode: 'ABC234', revision: 1,
    hostSeatId: players[0].seatId, lobbyId: crypto.randomUUID(), puzzle: starterBoard, players });
  if (!projected.ok) throw new Error('Expected lobby');
  let room: StoredRoom = { initialization: '{}', members: { host: players[0].seatId, guest: players[1].seatId }, state: projected.value };
  if (phase !== 'lobby') {
    const initial = createMatch({ matchId: crypto.randomUUID(), puzzle: starterBoard, players });
    let match: StoredMatch = queuedPreparation(initial, 1000);
    if (phase !== 'preparing') {
      let state = prepareMatchRound(initial, { candidateOrder: starterBoard.targets.map((t) => t.id), budget: RECOMMENDED_ROUND_SETUP_BUDGET }).state;
      if (state.phase !== 'thinking') throw new Error('Expected verified thinking');
      match = { version: 2, state };
      if (phase !== 'thinking') {
        for (const [i, value] of [7, 5].entries()) state = transitionMatch(state, { source: 'player', context: { actorSeatId: players[i].seatId,
          hostSeatId: players[0].seatId, nowMs: 1000 }, command: { type: 'bid.submit', value } }).state;
        if (state.phase !== 'bidding') throw new Error('Expected bidding');
        match = { version: 3, state };
      }
    }
    room = { ...room, match, state: projectStoredMatch(room.state, match) };
  }
  storage.sql.exec('INSERT INTO room_state VALUES (1, ?)', JSON.stringify(room));
  if (['demonstrating', 'round-result', 'finished'].includes(phase)) expireBidding(storage, 61000);
  if (phase === 'round-result' || phase === 'finished') {
    for (let i = 0; i < 2; i++) {
      room = storedRoom(storage)!;
      if (room.state.status !== 'playing' || room.state.match.phase !== 'demonstrating') throw new Error('Expected attempt');
      const m = room.state.match; const seat = m.bidderQueue[m.activeBidderIndex].seatId;
      executeLobbyCommand(storage, seat === players[0].seatId ? 'host' : 'guest', seat, { version: 2, roomId: room.state.roomId,
        commandId: crypto.randomUUID(), context: { matchId: m.matchId, roundNumber: m.round.number, attemptId: m.attempt.id, attemptVersion: m.attempt.version },
        command: { type: 'attempt.giveUp' } }, undefined, undefined, () => 62000);
    }
  }
  if (phase === 'finished') {
    room = storedRoom(storage)!;
    const m = room.match!.state;
    if (m.phase !== 'round-result') throw new Error('Expected result');
    const final = { ...m, round: { ...m.round, number: 10 as const }, completedRounds: 10 as const,
      usedTargetIds: [...starterBoard.targets.filter((t) => t.id !== m.round.target.id).slice(0, 9).map((t) => t.id), m.round.target.id] };
    const match: StoredMatch = { version: 4, state: final };
    saveRoom(storage, { ...room, match, state: projectStoredMatch(room.state, match) });
    executeLobbyCommand(storage, 'host', room.state.hostSeatId, { version: 2, roomId: room.state.roomId, commandId: crypto.randomUUID(),
      context: { matchId: m.matchId, roundNumber: 10 }, command: { type: 'round.continue' } }, undefined, undefined, () => 63000);
  }
  return storedRoom(storage)!;
}
const end = (r: StoredRoom, confirmed = true): RoomRequest => ({ version: 2, roomId: r.state.roomId, commandId: crypto.randomUUID(),
  context: r.state.status === 'lobby' ? { lobbyId: r.state.lobbyId } : { matchId: r.state.match.matchId }, command: { type: 'room.end', confirmed } });
const scenario = (work: (storage: DurableObjectStorage) => void | Promise<void>) => runInDurableObject(
  env.ROOMS.get(env.ROOMS.idFromName(crypto.randomUUID())), async (_instance, ctx) => {
    try { await work(ctx.storage); } finally { await ctx.storage.deleteAlarm(); }
  });

test('30-minute policy is fixed outside local mode; the optional short local setting is bounded', () => {
  expect(emptyRoomTimeout({ APP_ENV: 'local' })).toBe(1800000);
  expect(emptyRoomTimeout({ APP_ENV: 'production', LOCAL_EMPTY_ROOM_TIMEOUT_SECONDS: '60' })).toBe(1800000);
  expect(emptyRoomTimeout({ APP_ENV: 'local', LOCAL_EMPTY_ROOM_TIMEOUT_SECONDS: '60' })).toBe(60000);
  for (const value of ['0', '-1', '1801', '1.5', 'abc', 60]) expect(() => emptyRoomTimeout({ APP_ENV: 'local', LOCAL_EMPTY_ROOM_TIMEOUT_SECONDS: value })).toThrow();
});

test.each<Phase>(['lobby', 'preparing', 'thinking', 'bidding', 'demonstrating', 'round-result', 'finished'])('continuous emptiness expires %s exactly once without scores, movement or automatic forfeit', async (phase) => {
  await scenario((storage) => {
    const room = seed(storage, phase); const p = new PresenceStore(storage); const start = 100000;
    p.reconcile(new Set(), start); const deadline = start + EMPTY_ROOM_TIMEOUT_MS;
    expect(p.nextEmptyDeadline()).toBe(deadline);
    p.reconcile(new Set(), deadline - 1); expect(terminalRoom(storage)).toBeNull();
    const before = storedRoom(storage)!;
    expect(p.reconcile(new Set(), deadline)).toBe(true);
    const ended = storedRoom(storage)!;
    expect(terminalRoom(storage)).toMatchObject({ reason: 'expired', closedAtMs: deadline, lastRevision: ended.state.revision });
    expect(ended.state).toEqual({ ...before.state, revision: before.state.revision + 1 });
    expect(ended.match).toEqual(before.match);
    expect(p.reconcile(new Set(), deadline + 1)).toBe(false); expect(storedRoom(storage)).toEqual(ended);
    const result = executeLobbyCommand(storage, 'host', room.state.hostSeatId, end(room), undefined, undefined, () => deadline + 1);
    expect(result?.outcome).toEqual({ status: 'rejected', reason: 'room-expired' });
  });
});

test.each([-1, 0, 1])('authenticated binding at empty deadline %+i ms cancels only when strictly early', async (offset) => {
  await scenario((storage) => {
    const room = seed(storage, 'lobby'); const p = new PresenceStore(storage); p.reconcile(new Set(), 100000);
    const deadline = p.nextEmptyDeadline()!; const id = crypto.randomUUID();
    expect(p.add(id, 'host', room.state.hostSeatId, 0, 86400000, deadline + offset)).toBe(offset < 0);
    if (offset < 0) {
      expect(p.nextEmptyDeadline()).toBeUndefined(); p.reconcile(new Set([id]), deadline + 1);
      expect(terminalRoom(storage)).toBeNull();
    } else {
      expect(terminalRoom(storage)?.reason).toBe('expired');
      expect(storage.sql.exec('SELECT * FROM connection_leases').toArray()).toEqual([]);
    }
  });
});

test('one responsive tab survives idle play; only the final tab starts emptiness, and a new period gets its own deadline', async () => {
  await scenario((storage) => {
    const room = seed(storage, 'lobby'); const p = new PresenceStore(storage); const a = crypto.randomUUID(); const b = crypto.randomUUID();
    p.reconcile(new Set(), 100000);
    p.add(a, 'host', room.state.hostSeatId, 0, 86400000, 100001); p.add(b, 'host', room.state.hostSeatId, 0, 86400000, 100002);
    p.reconcile(new Set([a, b]), 100002); p.reconcile(new Set([b]), 101000); expect(p.nextEmptyDeadline()).toBeUndefined();
    let now = 101000;
    for (let i = 0; i < 100; i++) { now += 20000; expect(p.renew(b, now)).toBe(true); p.reconcile(new Set([b]), now); }
    expect(terminalRoom(storage)).toBeNull(); expect(p.nextEmptyDeadline()).toBeUndefined();
    p.reconcile(new Set(), now + 1); const deadline = now + 1 + EMPTY_ROOM_TIMEOUT_MS;
    expect(p.nextEmptyDeadline()).toBe(deadline); expect(p.renew(b, now + 2)).toBe(false);
    p.reconcile(new Set(), now + 100); expect(p.nextEmptyDeadline()).toBe(deadline);
    const c = crypto.randomUUID(); expect(p.add(c, 'host', room.state.hostSeatId, 0, 86400000, deadline - 1)).toBe(true);
    p.reconcile(new Set([c]), deadline + 1); expect(terminalRoom(storage)).toBeNull();
    p.reconcile(new Set(), deadline + 2); expect(p.nextEmptyDeadline()).toBe(deadline + 2 + EMPTY_ROOM_TIMEOUT_MS);
  });
});

test('late detection uses the effective final lease/identity deadline, never a fresh thirty minutes from wake', async () => {
  await scenario((storage) => {
    const room = seed(storage, 'lobby'); const p = new PresenceStore(storage); const id = crypto.randomUUID();
    p.add(id, 'host', room.state.hostSeatId, 0, 86400000, 100000); p.reconcile(new Set([id]), 100000);
    p.reconcile(new Set([id]), 100000 + 30000 + EMPTY_ROOM_TIMEOUT_MS + 1000);
    expect(terminalRoom(storage)).toMatchObject({ reason: 'expired', closedAtMs: 130000 + EMPTY_ROOM_TIMEOUT_MS });
  });
});

test('HTTP resume, repeated reads and a changed local setting do not renew or shorten an existing empty period', async () => {
  await scenario((storage) => {
    const room = seed(storage, 'lobby'); const p = new PresenceStore(storage); p.reconcile(new Set(), 100000);
    const deadline = p.nextEmptyDeadline()!;
    const member = new MembershipStore(storage, { now: () => deadline - 1, uuid: () => crypto.randomUUID() });
    const request = { version: 2 as const, commandId: crypto.randomUUID(), command: { type: 'session.resume' as const, roomId: room.state.roomId } };
    expect(member.enter({ sessionId: 'host', issuedAt: 0, expiresAt: 86400000 }, request).status).toBe('entered');
    new PresenceStore(storage, 60000).reconcile(new Set(), deadline - 1); expect(p.nextEmptyDeadline()).toBe(deadline);
    const late = new MembershipStore(storage, { now: () => deadline, uuid: () => crypto.randomUUID() });
    expect(late.enter({ sessionId: 'host', issuedAt: 0, expiresAt: 86400000 }, { ...request, commandId: crypto.randomUUID() })).toEqual({ status: 'rejected', reason: 'room-expired' });
  });
});

test.each([false, true])('v1 presence migration preserves reliable emptiness, but unknown timing starts at migration (known=%s)', async (known) => {
  await scenario((storage) => {
    seed(storage, 'lobby'); storage.sql.exec('DROP TABLE room_presence');
    storage.sql.exec('CREATE TABLE room_presence (singleton INTEGER PRIMARY KEY, empty_since INTEGER)');
    storage.sql.exec('UPDATE presence_metadata SET version = 1');
    if (known) storage.sql.exec('INSERT INTO room_presence VALUES (1, 100000)');
    const now = 100000 + EMPTY_ROOM_TIMEOUT_MS + 1000; const p = new PresenceStore(storage); p.initialize();
    p.reconcile(new Set(), now);
    if (known) expect(terminalRoom(storage)?.closedAtMs).toBe(100000 + EMPTY_ROOM_TIMEOUT_MS);
    else { expect(terminalRoom(storage)).toBeNull(); expect(p.nextEmptyDeadline()).toBe(now + EMPTY_ROOM_TIMEOUT_MS); p.initialize(); p.reconcile(new Set(), now + 1); expect(p.nextEmptyDeadline()).toBe(now + EMPTY_ROOM_TIMEOUT_MS); }
  });
});

test('expiry tombstone and final revision roll back atomically on write failure without restarting the deadline', async () => {
  await scenario((storage) => {
    seed(storage, 'lobby'); const p = new PresenceStore(storage); p.reconcile(new Set(), 100000);
    const deadline = p.nextEmptyDeadline()!; const before = storedRoom(storage)!;
    storage.sql.exec("CREATE TRIGGER reject_expiry BEFORE INSERT ON room_terminal BEGIN SELECT RAISE(ABORT, 'test failure'); END");
    expect(() => expireEmptyRoom(storage, before, deadline)).toThrow();
    expect(terminalRoom(storage)).toBeNull(); expect(storedRoom(storage)).toEqual(before); expect(p.nextEmptyDeadline()).toBe(deadline);
    storage.sql.exec('DROP TRIGGER reject_expiry'); expect(expireEmptyRoom(storage, before, deadline + 1)).toBe(true);
    expect(terminalRoom(storage)?.closedAtMs).toBe(deadline);
  });
});

test('a command discovering expiry rejects and commits the tombstone without trying to save an open room', async () => {
  await scenario((storage) => {
    const room = seed(storage, 'thinking'); const p = new PresenceStore(storage); p.reconcile(new Set(), 100000);
    const deadline = p.nextEmptyDeadline()!;
    const result = executeLobbyCommand(storage, 'host', room.state.hostSeatId, end(room), undefined, undefined, () => deadline);
    expect(result?.outcome).toEqual({ status: 'rejected', reason: 'room-expired' });
    expect(terminalRoom(storage)).toMatchObject({ reason: 'expired', closedAtMs: deadline });
    expect(storedRoom(storage)!.state.revision).toBe(room.state.revision + 1);
  });
});

test('preparation expiry is rechecked after awaited alarm setup, before search or accepting its result', async () => {
  await scenario(async (storage) => {
    seed(storage, 'preparing'); const p = new PresenceStore(storage); p.reconcile(new Set(), 100000);
    const deadline = p.nextEmptyDeadline()!; const search = vi.fn();
    expect(await runPreparationAlarm(storage, deadline - 1, search, () => deadline)).toBe(false);
    expect(search).not.toHaveBeenCalled(); expect(terminalRoom(storage)).toMatchObject({ reason: 'expired', closedAtMs: deadline });
  });
});

test.each<Phase>(['lobby', 'preparing', 'thinking', 'bidding', 'demonstrating', 'round-result', 'finished'])('host End is terminal in %s, without points/results/reset or resurrection', async (phase) => {
  await scenario(async (storage) => {
    const before = seed(storage, phase); const command = end(before);
    const now = phase === 'bidding' ? 60000 : 64000;
    const call = (r = command, host = true) => executeLobbyCommand(storage, host ? 'host' : 'guest', before.state.players[host ? 0 : 1].seatId, r, undefined, undefined, () => now)!;
    expect(call(end(before), false).outcome).toEqual({ status: 'rejected', reason: 'not-host' });
    expect(call(end(before, false)).outcome).toEqual({ status: 'rejected', reason: 'confirmation-required' });
    const stale = { ...command, commandId: crypto.randomUUID(), context: { matchId: crypto.randomUUID() } } as RoomRequest;
    expect(call(stale).outcome).toEqual({ status: 'rejected', reason: 'stale-context' });
    expect(terminalRoom(storage)).toBeNull();
    const result = call(); expect(result.outcome.status).toBe('accepted');
    const ended = storedRoom(storage)!;
    expect(ended.state).toEqual({ ...before.state, revision: before.state.revision + 1 });
    expect(ended.match).toEqual(before.match);
    expect(terminalRoom(storage)).toMatchObject({ reason: 'host-ended', lastRevision: ended.state.revision, closedAtMs: now });
    expect(call()).toMatchObject({ duplicate: true, outcome: { status: 'accepted' } });
    expect(call(end(before)).outcome).toEqual({ status: 'rejected', reason: 'room-closed' });
    expect(readLobbyReceipt(storage, 'host', command)).toMatchObject({ duplicate: true, outcome: { status: 'accepted' } });
    expect(readLobbyReceipt(storage, 'guest', command).outcome).toEqual({ status: 'rejected', reason: 'retry-not-found' });
    expect(expireBidding(storage, 999999)).toBe(false);
    const search = vi.fn(); expect(await runPreparationAlarm(storage, 999999, search)).toBe(false); expect(search).not.toHaveBeenCalled();
    expect(commitPreparationResult(storage, 'stale-job', null, 999999)).toBe(false);
    const membership = new MembershipStore(storage, { now: () => 64001, uuid: () => crypto.randomUUID() });
    expect(membership.enter({ sessionId: 'guest', issuedAt: 1, expiresAt: 1000000 }, { version: 2, commandId: crypto.randomUUID(), command: { type: 'session.resume', roomId: before.state.roomId } }))
      .toEqual({ status: 'rejected', reason: 'room-closed' });
    expect(() => saveRoom(storage, before)).toThrow('closed');
    expect(storedRoom(storage)).toEqual(ended);
  });
});

test('closure revision/tombstone/receipt roll back together if persistence fails', async () => {
  await scenario((storage) => {
    const room = seed(storage, 'thinking'); const request = end(room);
    storage.sql.exec(`CREATE TRIGGER reject_end BEFORE INSERT ON membership_replays WHEN NEW.command_id = '${request.commandId}' BEGIN SELECT RAISE(ABORT, 'test failure'); END`);
    expect(() => executeLobbyCommand(storage, 'host', room.state.hostSeatId, request, undefined, undefined, () => 64000)).toThrow();
    expect(terminalRoom(storage)).toBeNull(); expect(storedRoom(storage)).toEqual(room);
  });
});

test('directory tombstones defeat creation publication/replay and code reuse even after initialization payload redaction', async () => {
  await scenario((storage) => {
    initializeSessions(storage); initializeCreations(storage); let now = 1000;
    const deps = { now: () => now, uuid: () => crypto.randomUUID(), code: () => 'ABC234', puzzle: () => starterBoard };
    const store = new CreationStore(storage, deps);
    const request = { version: 2 as const, commandId: crypto.randomUUID(), command: { type: 'room.create' as const, nickname: 'Private nickname' } };
    const reservation = store.reserve('host', 1000000, request);
    if ('reason' in reservation) throw new Error('Expected reservation');
    const p = { version: 1 as const, closureId: crypto.randomUUID(), roomId: reservation.initialization.roomId, roomCode: 'ABC234',
      reason: 'host-ended' as const, closedAtMs: now, lastRevision: 2, cleanupAtMs: now + TERMINAL_RETENTION_MS,
      directorySynced: false, purged: false, nextRetryAtMs: now };
    store.closeDirectory(p, false); store.closeDirectory(p, false);
    expect(store.lookup('ABC234')).toEqual({ status: 'closed' }); expect(store.pending()).toEqual([]);
    expect(() => store.publish(reservation.initialization)).toThrow('closed');
    expect(store.reserve('host', 1000000, request)).toEqual({ status: 'rejected', reason: 'room-closed' });
    expect(() => store.closeDirectory(p, true)).toThrow('Retention');
    now = p.cleanupAtMs; store.closeDirectory(p, true);
    expect(storage.sql.exec('SELECT * FROM room_creations').toArray()).toEqual([]);
    expect(store.lookupRoom(p.roomId)).toEqual({ status: 'closed' });
    expect(store.reserve('other', now + 1000000, { ...request, commandId: crypto.randomUUID() })).toEqual({ status: 'rejected', reason: 'temporarily-unavailable' });
  });
});

test('outbox retries in five seconds; private cleanup waits for retention and Registry redaction acknowledgment', async () => {
  await scenario(async (storage) => {
    const room = seed(storage, 'demonstrating'); executeLobbyCommand(storage, 'host', room.state.hostSeatId, end(room), undefined, undefined, () => 64000);
    const close = vi.fn(async (_p: unknown, _redact: boolean) => {});
    const fake = { REGISTRY: { idFromName: () => 'registry', get: () => ({ closeRoomDirectory: close }) } } as unknown as Env;
    close.mockRejectedValueOnce(new Error('directory unavailable'));
    await flushRoomTerminal(storage, fake, 64000); expect(terminalRoom(storage)?.nextRetryAtMs).toBe(69000);
    await flushRoomTerminal(storage, fake, 68999); expect(close).toHaveBeenCalledTimes(1);
    await flushRoomTerminal(storage, fake, 69000); expect(terminalRoom(storage)?.directorySynced).toBe(true);
    const cleanup = 64000 + TERMINAL_RETENTION_MS;
    expect(terminalDue(terminalRoom(storage)!)).toBe(cleanup);
    await flushRoomTerminal(storage, fake, cleanup - 1); expect(storedRoom(storage)).not.toBeNull();
    close.mockRejectedValueOnce(new Error('redaction unavailable'));
    await flushRoomTerminal(storage, fake, cleanup); expect(storedRoom(storage)).not.toBeNull();
    await flushRoomTerminal(storage, fake, cleanup + 5000);
    expect(storedRoom(storage)).toBeNull(); expect(terminalRoom(storage)).toMatchObject({ purged: true, directorySynced: true });
    expect(storage.sql.exec('SELECT * FROM membership_replays').toArray()).toEqual([]);
    expect(terminalDue(terminalRoom(storage)!)).toBeNull();
    expect(close.mock.calls.at(-1)![1]).toBe(true);
  });
});
