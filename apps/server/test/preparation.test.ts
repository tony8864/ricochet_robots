import { env, runInDurableObject } from 'cloudflare:test';
import { expect, test, vi } from 'vitest';
import { createMatch, snapshotRoundPreparation } from '@robot-puzzle/match';
import { starterBoard } from '@robot-puzzle/puzzles';
import { prepareNextRound, RECOMMENDED_ROUND_SETUP_BUDGET, type RoundSetupInput, type RoundSetupResult } from '@robot-puzzle/puzzles/round-setup';
import { projectLobbyState, type RoomRequest } from '@robot-puzzle/shared';
import { isolatedRobotsBoard } from '../../../packages/puzzles/src/roundSetup/fixtures';
import { executeLobbyCommand, saveRoom, storedRoom } from '../src/lobbyCommands';
import { queuedPreparation, runPreparationAlarm, commitPreparationResult, ensurePreparationJob } from '../src/roomPreparation';
import { projectStoredMatch, type StoredMatch } from '../src/storedMatch';
import { PREPARATION_COOLDOWN_MS, PREPARATION_RECOVERY_MS } from '../src/preparationJob';
import type { StoredRoom } from '../src/roomMembership';

async function inRoom(work: (storage: DurableObjectStorage, room: StoredRoom) => Promise<void> | void) {
  const stub = env.ROOMS.get(env.ROOMS.idFromName(crypto.randomUUID()));
  await runInDurableObject(stub, async (_instance, ctx) => {
    const players = [{ seatId: crypto.randomUUID(), nickname: 'Host', connected: false }, { seatId: crypto.randomUUID(), nickname: 'Guest', connected: false }];
    const state = projectLobbyState({ roomId: crypto.randomUUID(), roomCode: 'ABC234', revision: 1,
      hostSeatId: players[0].seatId, lobbyId: crypto.randomUUID(), puzzle: starterBoard, players });
    if (!state.ok) throw new Error('Expected lobby');
    const room: StoredRoom = { initialization: '{}', members: { host: players[0].seatId, guest: players[1].seatId }, state: state.value };
    ctx.storage.sql.exec('INSERT INTO room_state VALUES (1, ?)', JSON.stringify(room));
    try { await work(ctx.storage, room); } finally { await ctx.storage.deleteAlarm(); }
  });
}
function start(storage: DurableObjectStorage, room: StoredRoom, now = 1000) {
  if (room.state.status !== 'lobby') throw new Error('Expected lobby');
  const command: RoomRequest = { version: 1, commandId: crypto.randomUUID(), roomId: room.state.roomId,
    context: { lobbyId: room.state.lobbyId }, command: { type: 'room.start', boardId: room.state.puzzle.id } };
  const accepted = executeLobbyCommand(storage, 'host', room.state.hostSeatId, command, undefined, undefined, () => now)!;
  expect(accepted.outcome.status).toBe('accepted');
  return storedRoom(storage)!;
}
function job(room: StoredRoom) {
  if (room.match?.version !== 2 || !room.match.job) throw new Error('Expected job');
  return room.match.job;
}
function retry(room: StoredRoom): RoomRequest {
  return { version: 1, commandId: crypto.randomUUID(), roomId: room.state.roomId,
    context: { matchId: room.match!.state.matchId, preparationId: job(room).id }, command: { type: 'preparation.retry' } };
}
/** Controlled exhaustion result: no expensive work needed for error-path tests. */
function deferred(input: RoundSetupInput): RoundSetupResult {
  const eligible = input.candidateOrder.filter((id) => !input.usedTargetIds.includes(id));
  return { status: 'deferred', reason: 'total-expansion-limit', diagnostics: {
    totalTargets: 17, usedTargetCount: input.usedTargetIds.length, alreadyCompleteTargetCount: 0,
    eligibleTargetCount: eligible.length, untestedTargetCount: eligible.length - 4, totalExpandedStates: 200000,
    candidates: eligible.slice(0, 4).map((targetId) => ({ targetId, status: 'unknown', reason: 'expansion-limit',
      limits: { maxExpandedStates: 50000, maxStoredStates: 150000 },
      stats: { expandedStates: 50000, attemptedMoves: 800000, generatedStates: 200000, peakStoredStates: 150000, searchArrayBytes: 1350000 },
    })),
  } };
}

test('Start persists one job without search; real due search reveals once with no sockets', async () => {
  await inRoom(async (storage, room) => {
    const started = start(storage, room);
    const search = vi.fn(prepareNextRound);
    expect(await runPreparationAlarm(storage, 1000, search)).toBe(false);
    expect(search).not.toHaveBeenCalled();
    expect(await runPreparationAlarm(storage, 1001, search)).toBe(true);
    const ready = storedRoom(storage)!;
    expect(ready.match!.state.phase).toBe('thinking');
    expect(ready.match!.state.officialRobots).toEqual(started.match!.state.officialRobots);
    expect(ready.match!.state.usedTargetIds).toHaveLength(1);
    expect(JSON.stringify(ready.state)).not.toMatch(/internalProof|candidateOrder|diagnostics|request/);
    expect(await runPreparationAlarm(storage, 50000, search)).toBe(false);
    expect(search).toHaveBeenCalledTimes(1);
    expect(storedRoom(storage)).toEqual(ready);
  });
});

test.each(['deferred', 'error'] as const)('%s preserves official state and permits one host retry after cooldown', async (kind) => {
  await inRoom(async (storage, room) => {
    const started = start(storage, room);
    await runPreparationAlarm(storage, 1001, kind === 'deferred' ? deferred : () => { throw new Error('private solver secret'); });
    const failed = storedRoom(storage)!;
    expect(job(failed).status).toBe(kind);
    for (const key of ['officialRobots', 'scores', 'completedRounds', 'usedTargetIds'] as const) expect(failed.match!.state[key]).toEqual(started.match!.state[key]);
    expect(JSON.stringify(failed.state)).not.toContain('private solver secret');
    const input = retry(failed);
    const host = room.state.hostSeatId;
    expect(executeLobbyCommand(storage, 'guest', room.members.guest, input, undefined, undefined, () => 9000)!.outcome).toEqual({ status: 'rejected', reason: 'not-host' });
    const early = executeLobbyCommand(storage, 'host', host, input, undefined, undefined, () => 6000)!;
    expect(early.outcome).toEqual({ status: 'rejected', reason: 'preparation-cooldown' });
    // Exact rejected retry remains rejected even after time passes.
    expect(executeLobbyCommand(storage, 'host', host, input, undefined, undefined, () => 9000)!.duplicate).toBe(true);
    const fresh = retry(failed);
    expect(executeLobbyCommand(storage, 'host', host, fresh, undefined, undefined, () => 6001)!.outcome.status).toBe('accepted');
    const queued = storedRoom(storage)!;
    expect(job(queued).id).not.toBe(job(failed).id);
    expect(executeLobbyCommand(storage, 'host', host, fresh)!.duplicate).toBe(true);
    expect(storedRoom(storage)).toEqual(queued);
    expect(executeLobbyCommand(storage, 'host', host, retry(queued))!.outcome).toEqual({ status: 'rejected', reason: 'wrong-phase' });
    expect(executeLobbyCommand(storage, 'host', host, { ...fresh, context: {}, command: { type: 'state.request' } })!.outcome)
      .toEqual({ status: 'rejected', reason: 'command-id-conflict' });
    expect(executeLobbyCommand(storage, 'host', host, { ...fresh, commandId: crypto.randomUUID() })!.outcome).toEqual({ status: 'rejected', reason: 'stale-context' });
    expect(commitPreparationResult(storage, job(failed).id, prepareNextRound(job(failed).request.setup), 9000)).toBe(false);
    expect(storedRoom(storage)).toEqual(queued);
  });
});

test('retry replay failure rolls back job replacement and public revision atomically', async () => {
  await inRoom(async (storage, room) => {
    start(storage, room);
    await runPreparationAlarm(storage, 1001, () => { throw new Error('injected search failure'); });
    const before = storedRoom(storage)!;
    const input = retry(before);
    storage.sql.exec("CREATE TRIGGER fail_retry BEFORE INSERT ON membership_replays BEGIN SELECT RAISE(ABORT, 'injected'); END");
    try { expect(() => executeLobbyCommand(storage, 'host', room.state.hostSeatId, input, undefined, undefined, () => 7000)).toThrow(); }
    finally { storage.sql.exec('DROP TRIGGER fail_retry'); }
    expect(storedRoom(storage)).toEqual(before);
    expect(executeLobbyCommand(storage, 'host', room.state.hostSeatId, input, undefined, undefined, () => 7000)!.outcome.status).toBe('accepted');
  });
});

test('unavailable is not retryable and does not consume a target', async () => {
  await inRoom(async (storage, room) => {
    const match = createMatch({ matchId: crypto.randomUUID(), players: room.state.players, puzzle: isolatedRobotsBoard });
    const next = queuedPreparation(match, 1000);
    saveRoom(storage, { ...room, match: next, state: projectStoredMatch(room.state, next) });
    await runPreparationAlarm(storage, 1001);
    const blocked = storedRoom(storage)!;
    expect(job(blocked).status).toBe('unavailable');
    expect(blocked.match!.state.usedTargetIds).toEqual([]);
    expect(executeLobbyCommand(storage, 'host', room.state.hostSeatId, retry(blocked), undefined, undefined, () => 10000)!.outcome).toEqual({ status: 'rejected', reason: 'wrong-phase' });
    expect(blocked.state).toMatchObject({ match: { preparation: { status: 'unavailable' } } });
  });
});

test('interrupted running job becomes error without repeating search', async () => {
  await inRoom(async (storage, room) => {
    const started = start(storage, room);
    const match = started.match!;
    if (match.version !== 2) throw new Error('Expected v2');
    saveRoom(storage, { ...started, match: { ...match, job: { ...job(started), status: 'running', dueAtMs: 1001 + PREPARATION_RECOVERY_MS } } });
    const search = vi.fn(prepareNextRound);
    await runPreparationAlarm(storage, 1001 + PREPARATION_RECOVERY_MS, search);
    expect(job(storedRoom(storage)!).status).toBe('error');
    expect(search).not.toHaveBeenCalled();
  });
});

test('invalid proof is never revealed; result commit rollback leaves recoverable running marker', async () => {
  await inRoom(async (storage, room) => {
    const started = start(storage, room);
    await runPreparationAlarm(storage, 1001, (input) => {
      const result = prepareNextRound(input);
      if (result.status !== 'selected') throw new Error('Expected selected');
      return { ...result, internalProof: [] };
    });
    expect(job(storedRoom(storage)!).status).toBe('error');
    const input = retry(storedRoom(storage)!);
    executeLobbyCommand(storage, 'host', room.state.hostSeatId, input, undefined, undefined, () => 7000);
    await expect(runPreparationAlarm(storage, 7001, (setup) => {
      storage.sql.exec("CREATE TRIGGER fail_preparation BEFORE UPDATE ON room_state BEGIN SELECT RAISE(ABORT, 'injected'); END");
      return prepareNextRound(setup);
    })).rejects.toThrow();
    storage.sql.exec('DROP TRIGGER fail_preparation');
    expect(job(storedRoom(storage)!).status).toBe('running');
    expect(storedRoom(storage)!.match!.state.usedTargetIds).toEqual(started.match!.state.usedTargetIds);
    const search = vi.fn(prepareNextRound);
    await runPreparationAlarm(storage, 7001 + PREPARATION_RECOVERY_MS, search);
    expect(search).not.toHaveBeenCalled();
    expect(job(storedRoom(storage)!).status).toBe('error');
  });
});

test('legacy initial Preparing migrates once and request snapshot uses actual carry-forward positions', async () => {
  await inRoom((storage, room) => {
    const initial = createMatch({ matchId: crypto.randomUUID(), players: room.state.players, puzzle: starterBoard });
    const legacy: StoredMatch = { version: 1, state: initial };
    saveRoom(storage, { ...room, match: legacy, state: projectStoredMatch(room.state, legacy) });
    expect(ensurePreparationJob(storage, 1000)).toBe(true);
    const migrated = storedRoom(storage)!;
    expect(ensurePreparationJob(storage, 2000)).toBe(false);
    expect(storedRoom(storage)).toEqual(migrated);
    expect(migrated.match!.state.matchId).toBe(initial.matchId);
    const carried = { ...initial, officialRobots: { ...initial.officialRobots, red: { row: 0, column: 2 } },
      usedTargetIds: ['red-star'], completedRounds: 1 as const };
    const next = queuedPreparation(carried, 3000);
    saveRoom(storage, { ...migrated, match: next, state: projectStoredMatch(migrated.state, next) });
    expect(job(storedRoom(storage)!).request).toEqual(snapshotRoundPreparation(carried, {
      candidateOrder: job(storedRoom(storage)!).request.setup.candidateOrder, budget: RECOMMENDED_ROUND_SETUP_BUDGET,
    }));
  });
});

test.each(['order', 'budget', 'context', 'extra', 'status'] as const)('corrupt private job %s fails closed', async (kind) => {
  await inRoom((storage, room) => {
    start(storage, room);
    const original = storage.sql.exec<{ value: string }>('SELECT value FROM room_state').one().value;
    const bad = JSON.parse(original);
    if (kind === 'order') bad.match.job.request.setup.candidateOrder.pop();
    if (kind === 'budget') bad.match.job.request.setup.budget.maxTotalExpandedStates++;
    if (kind === 'context') bad.match.job.request.matchId = crypto.randomUUID();
    if (kind === 'extra') bad.match.job.internalProof = [];
    if (kind === 'status') bad.match.job.status = 'made-up';
    storage.sql.exec('UPDATE room_state SET value = ?', JSON.stringify(bad));
    expect(() => storedRoom(storage)).toThrow();
    storage.sql.exec('UPDATE room_state SET value = ?', original);
    expect(job(storedRoom(storage)!).retryAtMs).toBe(1000 + PREPARATION_COOLDOWN_MS);
  });
});
