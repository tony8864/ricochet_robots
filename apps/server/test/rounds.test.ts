import { env, runInDurableObject } from 'cloudflare:test';
import { expect, test, vi } from 'vitest';
import { createMatch, prepareMatchRound, type ThinkingMatchState } from '@robot-puzzle/match';
import { starterBoard } from '@robot-puzzle/puzzles';
import * as setup from '@robot-puzzle/puzzles/round-setup';
import { projectLobbyState, type RoomRequest } from '@robot-puzzle/shared';
import { executeLobbyCommand, storedRoom } from '../src/lobbyCommands';
import { projectStoredMatch } from '../src/storedMatch';
import { runPreparationAlarm } from '../src/roomPreparation';
import type { StoredRoom } from '../src/roomMembership';

async function scenario(work: (storage: DurableObjectStorage, room: StoredRoom) => void | Promise<void>, final = false) {
  await runInDurableObject(env.ROOMS.get(env.ROOMS.idFromName(crypto.randomUUID())), async (_instance, ctx) => {
    const players = ['Host', 'Guest'].map((nickname) => ({ seatId: crypto.randomUUID(), nickname, connected: false }));
    const lobby = projectLobbyState({ roomId: crypto.randomUUID(), roomCode: 'ABC234', revision: 1,
      hostSeatId: players[0].seatId, lobbyId: crypto.randomUUID(), puzzle: starterBoard, players });
    if (!lobby.ok) throw new Error('Expected lobby');
    const initial = createMatch({ matchId: crypto.randomUUID(), players, puzzle: starterBoard });
    const prepared = prepareMatchRound(initial, { candidateOrder: starterBoard.targets.map((t) => t.id), budget: setup.RECOMMENDED_ROUND_SETUP_BUDGET }).state;
    if (prepared.phase !== 'thinking') throw new Error('Expected verified Thinking');
    // A valid isolated final-round fixture, not a claim to have played rounds 1–9.
    const state: ThinkingMatchState = final ? { ...prepared, completedRounds: 9,
      usedTargetIds: [...starterBoard.targets.filter((t) => t.id !== prepared.round.target.id).slice(0, 9).map((t) => t.id), prepared.round.target.id],
      round: { ...prepared.round, number: 10 } } : prepared;
    const match = { version: 2 as const, state };
    const room: StoredRoom = { initialization: '{}', members: { host: players[0].seatId, guest: players[1].seatId },
      match, state: projectStoredMatch(lobby.value, match) };
    ctx.storage.sql.exec('INSERT INTO room_state VALUES (1, ?)', JSON.stringify(room));
    try { await work(ctx.storage, room); } finally { await ctx.storage.deleteAlarm(); }
  });
}
function request(room: StoredRoom, command: RoomRequest['command']): RoomRequest {
  const match = room.match!.state;
  if (!('round' in match)) throw new Error('Expected round');
  return { version: 2, commandId: crypto.randomUUID(), roomId: room.state.roomId,
    context: { matchId: match.matchId, roundNumber: match.round.number }, command } as RoomRequest;
}
function execute(storage: DurableObjectStorage, room: StoredRoom, input: RoomRequest, guest = false) {
  return executeLobbyCommand(storage, guest ? 'guest' : 'host', room.state.players[guest ? 1 : 0].seatId, input, undefined, undefined, () => 1000)!;
}
function skip(storage: DurableObjectStorage, room: StoredRoom) {
  const input = request(room, { type: 'round.skip', confirmed: true });
  expect(execute(storage, room, input).outcome.status).toBe('accepted');
  return input;
}

test('Skip requires current host, exact context and confirmation; no score/position change', async () => {
  await scenario((storage, room) => {
    const input = request(room, { type: 'round.skip', confirmed: true });
    expect(execute(storage, room, input, true).outcome).toEqual({ status: 'rejected', reason: 'not-host' });
    expect(execute(storage, room, request(room, { type: 'round.skip', confirmed: false })).outcome).toEqual({ status: 'rejected', reason: 'confirmation-required' });
    expect(execute(storage, room, { ...input, commandId: crypto.randomUUID(), context: { matchId: crypto.randomUUID(), roundNumber: 1 } } as RoomRequest).outcome).toEqual({ status: 'rejected', reason: 'stale-context' });
    expect(storedRoom(storage)).toEqual(room);
    expect(execute(storage, room, input).outcome.status).toBe('accepted');
    expect(storedRoom(storage)!.match).toMatchObject({ version: 4, state: { phase: 'round-result', outcome: { kind: 'no-bid-skip' },
      officialRobots: room.match!.state.officialRobots, scores: room.match!.state.scores, usedTargetIds: room.match!.state.usedTargetIds } });
  });
});

test.each(['bid-first', 'skip-first'] as const)('serialized %s race never both skips and accepts a bid', async (order) => {
  await scenario((storage, room) => {
    const bid = request(room, { type: 'bid.submit', value: 3 });
    const skipped = request(room, { type: 'round.skip', confirmed: true });
    expect(execute(storage, room, order === 'bid-first' ? bid : skipped).outcome.status).toBe('accepted');
    expect(execute(storage, room, order === 'bid-first' ? skipped : bid).outcome.status).toBe('rejected');
    expect(storedRoom(storage)!.match!.state.phase).toBe(order === 'bid-first' ? 'bidding' : 'round-result');
  });
});

test('Continue queues exactly one durable job without searching; both earlier actions replay safely', async () => {
  await scenario((storage, room) => {
    const skipped = skip(storage, room);
    const result = storedRoom(storage)!;
    const input = request(result, { type: 'round.continue' });
    expect(execute(storage, result, input, true).outcome).toEqual({ status: 'rejected', reason: 'not-host' });
    const search = vi.spyOn(setup, 'prepareNextRound');
    try { expect(execute(storage, result, input).outcome.status).toBe('accepted'); expect(search).not.toHaveBeenCalled(); }
    finally { search.mockRestore(); }
    const preparing = storedRoom(storage)!;
    expect(preparing.match).toMatchObject({ version: 2, state: { phase: 'preparing', completedRounds: 1, scores: room.match!.state.scores,
      officialRobots: room.match!.state.officialRobots, usedTargetIds: room.match!.state.usedTargetIds }, job: { status: 'queued' } });
    expect(execute(storage, result, input)).toMatchObject({ duplicate: true, outcome: { status: 'accepted' } });
    expect(execute(storage, room, skipped)).toMatchObject({ duplicate: true, outcome: { status: 'accepted' } });
    expect(storedRoom(storage)).toEqual(preparing);
    expect(execute(storage, result, { ...input, commandId: crypto.randomUUID() }).outcome.status).toBe('rejected');
  });
});

test('failed Continue transaction preserves stable result and leaves no partial job or replay', async () => {
  await scenario((storage, room) => {
    skip(storage, room);
    const result = storedRoom(storage)!;
    const input = request(result, { type: 'round.continue' });
    storage.sql.exec("CREATE TRIGGER fail_continue BEFORE INSERT ON membership_replays BEGIN SELECT RAISE(ABORT, 'injected'); END");
    try { expect(() => execute(storage, result, input)).toThrow(); }
    finally { storage.sql.exec('DROP TRIGGER fail_continue'); }
    expect(storedRoom(storage)).toEqual(result);
    expect(execute(storage, result, input).outcome.status).toBe('accepted');
    expect(execute(storage, result, input).duplicate).toBe(true);
  });
});

test('next preparation failure stays Preparing with unchanged robots/scores and never restores result', async () => {
  await scenario(async (storage, room) => {
    skip(storage, room);
    const result = storedRoom(storage)!;
    execute(storage, result, request(result, { type: 'round.continue' }));
    const preparing = storedRoom(storage)!;
    if (preparing.match?.version !== 2 || !preparing.match.job) throw new Error('Expected job');
    await runPreparationAlarm(storage, preparing.match.job.dueAtMs, () => { throw new Error('private failure'); });
    expect(storedRoom(storage)!.match).toMatchObject({ state: { phase: 'preparing', officialRobots: result.match!.state.officialRobots,
      scores: result.match!.state.scores, usedTargetIds: result.match!.state.usedTargetIds }, job: { status: 'error' } });
  });
});

test('round 10 Continue enters durable Finished, never queues/searches round 11 or scores again', async () => {
  await scenario((storage, room) => {
    skip(storage, room);
    const result = storedRoom(storage)!;
    const input = request(result, { type: 'round.continue' });
    const search = vi.spyOn(setup, 'prepareNextRound');
    try { expect(execute(storage, result, input).outcome.status).toBe('accepted'); expect(search).not.toHaveBeenCalled(); }
    finally { search.mockRestore(); }
    const finished = storedRoom(storage)!;
    expect(finished).toMatchObject({ state: { status: 'finished' }, match: { version: 5, state: { phase: 'finished', completedRounds: 10,
      officialRobots: result.match!.state.officialRobots, scores: result.match!.state.scores, usedTargetIds: result.match!.state.usedTargetIds } } });
    expect(finished.match).not.toHaveProperty('job');
    expect(execute(storage, result, input).duplicate).toBe(true);
    expect(storedRoom(storage)).toEqual(finished);
    const original = storage.sql.exec<{ value: string }>('SELECT value FROM room_state').one().value;
    const bad = JSON.parse(original); bad.match.state.extra = 'invalid';
    storage.sql.exec('UPDATE room_state SET value = ?', JSON.stringify(bad));
    expect(() => storedRoom(storage)).toThrow();
    storage.sql.exec('UPDATE room_state SET value = ?', original);
  }, true);
});

function finish(storage: DurableObjectStorage, room: StoredRoom) {
  const skipped = skip(storage, room);
  const result = storedRoom(storage)!;
  const continuation = request(result, { type: 'round.continue' });
  expect(execute(storage, result, continuation).outcome.status).toBe('accepted');
  return { finished: storedRoom(storage)!, skipped, continuation };
}
function rematch(room: StoredRoom): RoomRequest {
  return { version: 2, commandId: crypto.randomUUID(), roomId: room.state.roomId,
    context: { matchId: room.match!.state.matchId }, command: { type: 'match.returnToLobby' } };
}

test('New Match requires Finished/current host/match, preserves seats/code/board/replays, and does not start', async () => {
  await scenario((storage, room) => {
    expect(execute(storage, room, rematch(room)).outcome).toEqual({ status: 'rejected', reason: 'wrong-phase' });
    const { finished, continuation } = finish(storage, room);
    const input = rematch(finished);
    expect(execute(storage, finished, input, true).outcome).toEqual({ status: 'rejected', reason: 'not-host' });
    expect(execute(storage, finished, { ...input, commandId: crypto.randomUUID(), context: { matchId: crypto.randomUUID() } } as RoomRequest).outcome)
      .toEqual({ status: 'rejected', reason: 'stale-context' });
    const beforeCount = storage.sql.exec<{ count: number }>('SELECT COUNT(*) AS count FROM membership_replays').one().count;
    const search = vi.spyOn(setup, 'prepareNextRound');
    try { expect(execute(storage, finished, input).outcome.status).toBe('accepted'); expect(search).not.toHaveBeenCalled(); }
    finally { search.mockRestore(); }
    const lobby = storedRoom(storage)!;
    expect(lobby.state).toMatchObject({ status: 'lobby', roomId: finished.state.roomId, roomCode: finished.state.roomCode,
      hostSeatId: finished.state.hostSeatId, players: finished.state.players, puzzle: finished.state.puzzle, revision: finished.state.revision + 1 });
    expect(lobby.members).toEqual(finished.members);
    expect(lobby.initialization).toBe(finished.initialization);
    expect(lobby).not.toHaveProperty('match');
    expect(lobby.state).not.toHaveProperty('match');
    expect(storage.sql.exec<{ count: number }>('SELECT COUNT(*) AS count FROM membership_replays').one().count).toBe(beforeCount + 1);
    expect(execute(storage, finished, input)).toMatchObject({ duplicate: true, outcome: { status: 'accepted' } });
    expect(execute(storage, room, continuation)).toMatchObject({ duplicate: true, outcome: { status: 'accepted' } });
    expect(storedRoom(storage)).toEqual(lobby);
    expect(execute(storage, finished, { ...input, command: { type: 'state.request' }, context: {} } as RoomRequest).outcome)
      .toEqual({ status: 'rejected', reason: 'command-id-conflict' });
    expect(storedRoom(storage)).toEqual(lobby);
  }, true);
});

test('New Match transaction failure preserves Finished and original request can recover exactly once', async () => {
  await scenario((storage, room) => {
    const { finished } = finish(storage, room);
    const input = rematch(finished);
    storage.sql.exec("CREATE TRIGGER fail_rematch BEFORE INSERT ON membership_replays BEGIN SELECT RAISE(ABORT, 'injected'); END");
    try { expect(() => execute(storage, finished, input)).toThrow(); }
    finally { storage.sql.exec('DROP TRIGGER fail_rematch'); }
    expect(storedRoom(storage)).toEqual(finished);
    expect(execute(storage, finished, input).outcome.status).toBe('accepted');
    expect(execute(storage, finished, input).duplicate).toBe(true);
  }, true);
});

test('fresh lobby context rejects old actions; explicit Start creates new match with clean scores/history', async () => {
  await scenario((storage, room) => {
    const { finished, skipped, continuation } = finish(storage, room);
    const returned = rematch(finished);
    execute(storage, finished, returned);
    const lobby = storedRoom(storage)!;
    if (lobby.state.status !== 'lobby') throw new Error('Expected lobby');
    const firstLobbyId = lobby.state.lobbyId;
    const staleStart: RoomRequest = { version: 2, commandId: crypto.randomUUID(), roomId: lobby.state.roomId,
      context: { lobbyId: crypto.randomUUID() }, command: { type: 'room.start', boardId: lobby.state.puzzle.id } };
    expect(execute(storage, lobby, staleStart).outcome).toEqual({ status: 'rejected', reason: 'stale-context' });
    for (const old of [skipped, continuation]) expect(execute(storage, lobby, { ...old, commandId: crypto.randomUUID() }).outcome.status).toBe('rejected');
    const start: RoomRequest = { ...staleStart, commandId: crypto.randomUUID(), context: { lobbyId: firstLobbyId } } as RoomRequest;
    expect(execute(storage, lobby, start).outcome.status).toBe('accepted');
    const next = storedRoom(storage)!;
    expect(next.match!.state.matchId).not.toBe(finished.match!.state.matchId);
    expect(next.match!.state).toMatchObject({ phase: 'preparing', completedRounds: 0, usedTargetIds: [],
      scores: Object.fromEntries(next.state.players.map((p) => [p.seatId, 0])), officialRobots: next.state.puzzle.initialRobots });
    expect(execute(storage, finished, returned).duplicate).toBe(true);
    expect(storedRoom(storage)).toEqual(next);
  }, true);
});
