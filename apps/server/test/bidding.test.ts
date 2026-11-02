import { env, runInDurableObject } from 'cloudflare:test';
import { expect, test } from 'vitest';
import { createMatch, prepareMatchRound } from '@robot-puzzle/match';
import { starterBoard } from '@robot-puzzle/puzzles';
import { RECOMMENDED_ROUND_SETUP_BUDGET } from '@robot-puzzle/puzzles/round-setup';
import { projectLobbyState, type RoomRequest } from '@robot-puzzle/shared';
import { executeLobbyCommand, expireBidding, storedRoom } from '../src/lobbyCommands';
import { projectStoredMatch } from '../src/storedMatch';
import type { StoredRoom } from '../src/roomMembership';

async function inRoom(work: (storage: DurableObjectStorage, room: StoredRoom) => void, count = 2) {
  await runInDurableObject(env.ROOMS.get(env.ROOMS.idFromName(crypto.randomUUID())), (_instance, ctx) => {
    const players = Array.from({ length: count }, (_, i) => ({ seatId: crypto.randomUUID(), nickname: `Player ${i}`, connected: false }));
    const lobby = projectLobbyState({ roomId: crypto.randomUUID(), roomCode: 'ABC234', revision: 1, hostSeatId: players[0].seatId,
      lobbyId: crypto.randomUUID(), puzzle: starterBoard, players });
    if (!lobby.ok) throw new Error('Expected lobby');
    const initial = createMatch({ matchId: crypto.randomUUID(), players, puzzle: starterBoard });
    const state = prepareMatchRound(initial, { candidateOrder: starterBoard.targets.map((t) => t.id), budget: RECOMMENDED_ROUND_SETUP_BUDGET }).state;
    if (state.phase !== 'thinking') throw new Error('Expected verified Thinking');
    const match = { version: 2 as const, state };
    const room: StoredRoom = { initialization: '{}', members: Object.fromEntries(players.map((p, i) => [`session-${i}`, p.seatId])),
      state: projectStoredMatch(lobby.value, match), match };
    ctx.storage.sql.exec('INSERT INTO room_state VALUES (1, ?)', JSON.stringify(room));
    work(ctx.storage, room);
  });
}
function request(room: StoredRoom, value: number, commandId = crypto.randomUUID()): Extract<RoomRequest, { command: { type: 'bid.submit' } }> {
  return { version: 2, roomId: room.state.roomId, commandId, context: { matchId: room.match!.state.matchId, roundNumber: 1 }, command: { type: 'bid.submit', value } };
}
function execute(storage: DurableObjectStorage, room: StoredRoom, seat: number, input: RoomRequest, now = 1000) {
  return executeLobbyCommand(storage, `session-${seat}`, room.state.players[seat].seatId, input, undefined, undefined, () => now)!;
}

test.each([2, 6])('%i players bid independently; reductions preserve first priority and the one deadline', async (count) => {
  await inRoom((storage, room) => {
    const first = request(room, 7);
    expect(execute(storage, room, 0, first).outcome.status).toBe('accepted');
    for (let i = 1; i < count; i++) expect(execute(storage, room, i, request(room, 7 + i), 1000).outcome.status).toBe('accepted');
    expect(execute(storage, room, 0, request(room, 7), 2000).outcome).toEqual({ status: 'no-op', reason: 'same-bid' });
    expect(execute(storage, room, 0, request(room, 8), 2000).outcome).toEqual({ status: 'rejected', reason: 'bid-increase' });
    expect(execute(storage, room, 1, request(room, 5), 3000).outcome.status).toBe('accepted');
    expect(execute(storage, room, 0, request(room, 5), 4000).outcome.status).toBe('accepted');
    const bidding = storedRoom(storage)!;
    expect(bidding.match).toMatchObject({ version: 3, state: { phase: 'bidding', deadlineAtMs: 61000 } });
    expect(expireBidding(storage, 60999)).toBe(false);
    expect(expireBidding(storage, 61000)).toBe(true);
    const demo = storedRoom(storage)!;
    if (demo.match?.state.phase !== 'demonstrating') throw new Error('Expected demonstration');
    expect(demo.match.state.bidderQueue.map((b) => b.seatId)).toEqual(room.state.players.map((p) => p.seatId));
    expect(demo.match.state.attempt.robots).toEqual(room.match!.state.officialRobots);
    expect(demo.match.state.attempt.moves).toEqual([]);
    expect(demo.match.state.scores).toEqual(room.match!.state.scores);
    expect(expireBidding(storage, 99999)).toBe(false);
    expect(storedRoom(storage)).toEqual(demo);
  }, count);
});

test.each([61000, 61001])('bid at %i is rejected while overdue expiry is durably retained', async (now) => {
  await inRoom((storage, room) => {
    execute(storage, room, 0, request(room, 4));
    const result = execute(storage, room, 1, request(room, 3), now);
    expect(result.outcome).toEqual({ status: 'rejected', reason: 'bidding-closed' });
    expect(result.changed).toBe(true);
    const after = storedRoom(storage)!;
    expect(after.match!.state.phase).toBe('demonstrating');
    expect(after.state.revision).toBe(result.processedRevision);
  });
});

test('last-millisecond bid is accepted; duplicate old bid at expiry returns original outcome without resetting time', async () => {
  await inRoom((storage, room) => {
    const first = request(room, 7);
    const original = execute(storage, room, 0, first);
    expect(execute(storage, room, 1, request(room, 3), 60999).outcome.status).toBe('accepted');
    expect(execute(storage, room, 0, first, 61000)).toMatchObject({ duplicate: true, changed: true,
      outcome: original.outcome, processedRevision: original.processedRevision });
    const after = storedRoom(storage)!;
    expect(execute(storage, room, 0, first, 61001).duplicate).toBe(true);
    expect(storedRoom(storage)).toEqual(after);
    expect(execute(storage, room, 0, { ...first, command: { type: 'bid.submit', value: 1 } }, 61002).outcome)
      .toEqual({ status: 'rejected', reason: 'command-id-conflict' });
  });
});

test('stale round/seat inputs cannot bid; a rejected contextual action still commits due expiry', async () => {
  await inRoom((storage, room) => {
    const stale: RoomRequest = { ...request(room, 4), context: { matchId: crypto.randomUUID(), roundNumber: 1 } };
    expect(execute(storage, room, 0, stale).outcome).toEqual({ status: 'rejected', reason: 'stale-context' });
    expect(() => executeLobbyCommand(storage, 'outsider', room.state.hostSeatId, request(room, 1))).toThrow();
    execute(storage, room, 0, request(room, 4));
    expect(execute(storage, room, 1, { ...stale, commandId: crypto.randomUUID() }, 61000).outcome)
      .toEqual({ status: 'rejected', reason: 'stale-context' });
    expect(storedRoom(storage)!.match!.state.phase).toBe('demonstrating');
  });
});

test('failed replay insertion rolls back bid/deadline/revision; same request can then succeed once', async () => {
  await inRoom((storage, room) => {
    const input = request(room, 6);
    storage.sql.exec("CREATE TRIGGER fail_bid BEFORE INSERT ON membership_replays BEGIN SELECT RAISE(ABORT, 'injected'); END");
    try { expect(() => execute(storage, room, 0, input)).toThrow(); }
    finally { storage.sql.exec('DROP TRIGGER fail_bid'); }
    expect(storedRoom(storage)).toEqual(room);
    expect(execute(storage, room, 0, input).outcome.status).toBe('accepted');
    expect(execute(storage, room, 0, input).duplicate).toBe(true);
  });
});

test('a state read normalizes a missed deadline without waiting for the alarm or changing an attempt twice', async () => {
  await inRoom((storage, room) => {
    execute(storage, room, 0, request(room, 6));
    const read: RoomRequest = { version: 2, commandId: crypto.randomUUID(), roomId: room.state.roomId, context: {}, command: { type: 'state.request' } };
    expect(execute(storage, room, 0, read, 61000)).toMatchObject({ changed: true, outcome: { status: 'no-op', reason: 'snapshot-requested' } });
    const after = storedRoom(storage)!;
    expect(after.match!.state.phase).toBe('demonstrating');
    expect(execute(storage, room, 0, read, 62000).duplicate).toBe(true);
    expect(storedRoom(storage)).toEqual(after);
  });
});

test.each(['deadline', 'bid-order', 'attempt-id', 'history', 'extra'] as const)('corrupt %s private bidding/attempt data fails closed', async (kind) => {
  await inRoom((storage, room) => {
    execute(storage, room, 0, request(room, 6));
    if (kind !== 'deadline' && kind !== 'bid-order') expireBidding(storage, 61000);
    const original = storage.sql.exec<{ value: string }>('SELECT value FROM room_state').one().value;
    const bad = JSON.parse(original);
    if (kind === 'deadline') bad.match.state.deadlineAtMs++;
    if (kind === 'bid-order') bad.match.state.bids[0].firstAcceptedOrder++;
    if (kind === 'attempt-id') bad.match.attempt.id = crypto.randomUUID();
    if (kind === 'history') bad.match.state.attempt.moves.push({ robotId: 'red', direction: 'right' });
    if (kind === 'extra') bad.match.internalProof = [];
    storage.sql.exec('UPDATE room_state SET value = ?', JSON.stringify(bad));
    expect(() => storedRoom(storage)).toThrow();
    storage.sql.exec('UPDATE room_state SET value = ?', original);
    expect(storedRoom(storage)).toBeTruthy();
  });
});
