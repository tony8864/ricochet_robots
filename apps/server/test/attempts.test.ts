import { env, runInDurableObject } from 'cloudflare:test';
import { expect, test } from 'vitest';
import { createMatch, acceptRoundPreparation, snapshotRoundPreparation, transitionMatch, type AttemptMatchCommand, type MatchState } from '@robot-puzzle/match';
import { starterBoard } from '@robot-puzzle/puzzles';
import { prepareNextRound, RECOMMENDED_ROUND_SETUP_BUDGET } from '@robot-puzzle/puzzles/round-setup';
import { projectLobbyState, type RoomRequest } from '@robot-puzzle/shared';
import { executeLobbyCommand, expireBidding, storedRoom } from '../src/lobbyCommands';
import { projectStoredMatch } from '../src/storedMatch';
import type { StoredRoom } from '../src/roomMembership';

async function scenario(work: (storage: DurableObjectStorage, room: StoredRoom, proof: readonly Extract<AttemptMatchCommand, { type: 'attempt.move' }>[]) => void,
  kind: 'colored' | 'wildcard' = 'colored', bid = 100, count = 2) {
  await runInDurableObject(env.ROOMS.get(env.ROOMS.idFromName(crypto.randomUUID())), (_instance, ctx) => {
    const players = Array.from({ length: count }, (_, i) => ({ seatId: crypto.randomUUID(), nickname: i ? `Guest ${i}` : 'Host', connected: false }));
    const sessions = players.map((_, i) => i === 0 ? 'host' : i === 1 ? 'guest' : `guest-${i}`);
    const lobby = projectLobbyState({ roomId: crypto.randomUUID(), roomCode: 'ABC234', revision: 1, hostSeatId: players[0].seatId,
      lobbyId: crypto.randomUUID(), puzzle: starterBoard, players });
    if (!lobby.ok) throw new Error('Expected lobby');
    const initial = createMatch({ matchId: crypto.randomUUID(), players, puzzle: starterBoard });
    const order = [...starterBoard.targets].sort((a, b) => Number(b.kind === kind) - Number(a.kind === kind)).map((t) => t.id);
    const request = snapshotRoundPreparation(initial, { candidateOrder: order, budget: RECOMMENDED_ROUND_SETUP_BUDGET });
    const selected = prepareNextRound(request.setup);
    if (selected.status !== 'selected' || selected.round.target.kind !== kind) throw new Error('Expected selected target');
    const state = acceptRoundPreparation(initial, request, selected).state;
    if (state.phase !== 'thinking') throw new Error('Expected Thinking');
    const match = { version: 2 as const, state };
    const room: StoredRoom = { initialization: '{}', members: Object.fromEntries(players.map((p, i) => [sessions[i], p.seatId])),
      state: projectStoredMatch(lobby.value, match), match };
    ctx.storage.sql.exec('INSERT INTO room_state VALUES (1, ?)', JSON.stringify(room));
    for (let seat = 0; seat < count; seat++) executeLobbyCommand(ctx.storage, sessions[seat], players[seat].seatId, {
      version: 1, roomId: room.state.roomId, commandId: crypto.randomUUID(), context: { matchId: state.matchId, roundNumber: 1 },
      command: { type: 'bid.submit', value: bid + seat },
    }, undefined, undefined, () => 1000);
    expireBidding(ctx.storage, 61000);
    work(ctx.storage, storedRoom(ctx.storage)!, selected.internalProof.map((step) => ({ type: 'attempt.move', ...step })));
  });
}
function input(room: StoredRoom, command: AttemptMatchCommand): RoomRequest {
  if (room.state.status !== 'playing' || room.state.match.phase !== 'demonstrating') throw new Error('Expected attempt');
  const match = room.state.match;
  return { version: 1, commandId: crypto.randomUUID(), roomId: room.state.roomId,
    context: { matchId: match.matchId, roundNumber: match.round.number, attemptId: match.attempt.id, attemptVersion: match.attempt.version }, command } as RoomRequest;
}
function act(storage: DurableObjectStorage, command: AttemptMatchCommand, seat = 0) {
  const room = storedRoom(storage)!;
  const request = input(room, command);
  return { request, result: execute(storage, room, request, seat) };
}
function execute(storage: DurableObjectStorage, room: StoredRoom, request: RoomRequest, seat = 0) {
  return executeLobbyCommand(storage, seat ? 'guest' : 'host', room.state.players[seat].seatId, request, undefined, undefined, () => 62000)!;
}
function metadata(room: StoredRoom) {
  if (room.state.status !== 'playing' || room.state.match.phase !== 'demonstrating') throw new Error('Expected attempt');
  return room.state.match.attempt;
}

test('only active bidder acts; context is exact, revisions are not movement preconditions', async () => {
  await scenario((storage, room, proof) => {
    expect(execute(storage, room, input(room, proof[0]), 1).outcome).toEqual({ status: 'rejected', reason: 'not-active-bidder' });
    const request = input(room, proof[0]);
    if (!('attemptId' in request.context)) throw new Error('Expected context');
    for (const context of [{ ...request.context, matchId: crypto.randomUUID() }, { ...request.context, roundNumber: 2 as const },
      { ...request.context, attemptId: crypto.randomUUID() }, { ...request.context, attemptVersion: 1 }]) {
      expect(execute(storage, room, { ...request, commandId: crypto.randomUUID(), context } as RoomRequest).outcome)
        .toEqual({ status: 'rejected', reason: 'stale-context' });
    }
    expect(() => executeLobbyCommand(storage, 'outsider', room.state.hostSeatId, request)).toThrow();
    expect(execute(storage, room, request).outcome.status).toBe('accepted');
    expect(execute(storage, room, { ...request, commandId: crypto.randomUUID() }).outcome).toEqual({ status: 'rejected', reason: 'stale-context' });
  });
});

test.each([2, 6])('%i frozen bidders retain permissions independently of host/online status', async (count) => {
  await scenario((storage, room, proof) => {
    for (const [session, seatId] of Object.entries(room.members).slice(1)) {
      expect(executeLobbyCommand(storage, session, seatId, input(room, proof[0]), undefined, undefined, () => 62000)!.outcome)
        .toEqual({ status: 'rejected', reason: 'not-active-bidder' });
    }
    act(storage, { type: 'attempt.giveUp' });
    const next = storedRoom(storage)!;
    expect(next.match!.state).toMatchObject({ phase: 'demonstrating', activeBidderIndex: 1, bidderQueue: expect.any(Array) });
    expect(act(storage, proof[0], 0).result.outcome).toEqual({ status: 'rejected', reason: 'not-active-bidder' });
    expect(storedRoom(storage)).toEqual(next);
  }, 'colored', 100, count);
});

test('accepted, rejected and no-op replays retain original outcomes across corrections, rollover and result', async () => {
  await scenario((storage, room, proof) => {
    const empty = act(storage, { type: 'attempt.undo' });
    const rejected = act(storage, proof[0], 1);
    const moved = act(storage, proof[0]);
    const blocked = act(storage, proof[0]);
    act(storage, { type: 'attempt.undo' });
    act(storage, proof[0]);
    act(storage, { type: 'attempt.reset' });
    const originals = [[empty, 0], [rejected, 1], [moved, 0], [blocked, 0]] as const;
    const checkReplays = () => {
      const before = storedRoom(storage)!;
      for (const [original, seat] of originals) expect(execute(storage, room, original.request, seat)).toMatchObject({
        duplicate: true, processedRevision: original.result.processedRevision, outcome: original.result.outcome,
      });
      expect(execute(storage, room, { ...moved.request, command: { type: 'attempt.reset' } } as RoomRequest).outcome)
        .toEqual({ status: 'rejected', reason: 'command-id-conflict' });
      expect(execute(storage, room, moved.request).outcome).toEqual(moved.result.outcome);
      expect(storedRoom(storage)).toEqual(before);
    };
    checkReplays();
    act(storage, { type: 'attempt.giveUp' }); checkReplays();
    act(storage, { type: 'attempt.giveUp' }, 1); checkReplays();
  });
});

test.each([
  ['undo', 'state'], ['undo', 'replay'], ['reset', 'state'], ['reset', 'replay'],
  ['rollover', 'state'], ['rollover', 'replay'], ['exhaustion', 'state'], ['exhaustion', 'replay'],
] as const)('%s failure at %s write rolls back the entire transition and can retry exactly once', async (kind, boundary) => {
  await scenario((storage, room, proof) => {
    act(storage, proof[0]);
    const seat = kind === 'exhaustion' ? 1 : 0;
    if (seat) act(storage, { type: 'attempt.giveUp' });
    const before = storedRoom(storage)!;
    const command: AttemptMatchCommand = kind === 'undo' ? { type: 'attempt.undo' } : kind === 'reset' ? { type: 'attempt.reset' } : { type: 'attempt.giveUp' };
    const request = input(before, command);
    storage.sql.exec(boundary === 'state'
      ? "CREATE TRIGGER fail_correction BEFORE UPDATE ON room_state BEGIN SELECT RAISE(ABORT, 'injected'); END"
      : "CREATE TRIGGER fail_correction BEFORE INSERT ON membership_replays BEGIN SELECT RAISE(ABORT, 'injected'); END");
    try { expect(() => execute(storage, room, request, seat)).toThrow(); }
    finally { storage.sql.exec('DROP TRIGGER fail_correction'); }
    expect(storedRoom(storage)).toEqual(before);
    expect(execute(storage, room, request, seat).outcome.status).toBe('accepted');
    const accepted = storedRoom(storage)!;
    expect(execute(storage, room, request, seat)).toMatchObject({ duplicate: true, outcome: { status: 'accepted' } });
    expect(storedRoom(storage)).toEqual(accepted);
  });
});

test('corrections are free; versions never rewind, no-ops do not change revisions', async () => {
  await scenario((storage, room, proof) => {
    for (const type of ['attempt.undo', 'attempt.reset'] as const) {
      expect(act(storage, { type }).result.outcome.status).toBe('no-op');
      expect(storedRoom(storage)).toEqual(room);
    }
    expect(act(storage, proof[0]).result.outcome.status).toBe('accepted');
    const moved = storedRoom(storage)!;
    expect(metadata(moved)).toMatchObject({ id: metadata(room).id, version: 1, moveCount: 1 });
    expect(act(storage, proof[0]).result.outcome).toEqual({ status: 'no-op', reason: 'blocked-move' });
    expect(storedRoom(storage)).toEqual(moved);
    expect(act(storage, { type: 'attempt.undo' }).result.outcome.status).toBe('accepted');
    expect(metadata(storedRoom(storage)!)).toMatchObject({ version: 2, moveCount: 0, robots: metadata(room).robots });
    act(storage, proof[0]);
    act(storage, { type: 'attempt.reset' });
    expect(metadata(storedRoom(storage)!)).toMatchObject({ id: metadata(room).id, version: 4, moveCount: 0 });
  });
});

test('bid limit rejects without failing, and undo remains usable', async () => {
  await scenario((storage, _room, proof) => {
    expect(proof.length).toBeGreaterThan(1);
    act(storage, proof[0]);
    expect(act(storage, proof[1]).result.outcome).toEqual({ status: 'rejected', reason: 'bid-limit' });
    expect(metadata(storedRoom(storage)!)).toMatchObject({ version: 1, moveCount: 1 });
    expect(act(storage, { type: 'attempt.undo' }).result.outcome.status).toBe('accepted');
  }, 'colored', 1);
});

test('all four moved robots restore on Reset and Give Up; old accepted moves stay deduplicated', async () => {
  await scenario((storage, room) => {
    const moveEveryRobot = () => {
      for (const robotId of ['red', 'blue', 'green', 'yellow'] as const) {
        const state = storedRoom(storage)!.match!.state;
        const command = (['up', 'right', 'down', 'left'] as const).map((direction) => ({ type: 'attempt.move' as const, robotId, direction }))
          .find((command) => {
            const next = transitionMatch(state, { source: 'player', context: { actorSeatId: room.state.hostSeatId, hostSeatId: room.state.hostSeatId, nowMs: 62000 }, command });
            return next.outcome.status === 'accepted' && next.state.phase === 'demonstrating';
          });
        if (!command) throw new Error('Expected legal nonwinning move');
        expect(act(storage, command).result.outcome.status).toBe('accepted');
      }
    };
    moveEveryRobot();
    const moved = storedRoom(storage)!;
    for (const robotId of ['red', 'blue', 'green', 'yellow'] as const) expect(metadata(moved).robots[robotId]).not.toEqual(metadata(room).robots[robotId]);
    const reset = act(storage, { type: 'attempt.reset' });
    expect(metadata(storedRoom(storage)!)).toMatchObject({ robots: metadata(room).robots, version: 5 });
    moveEveryRobot();
    const before = storedRoom(storage)!;
    expect(execute(storage, room, reset.request)).toMatchObject({ duplicate: true, outcome: { status: 'accepted' } });
    expect(storedRoom(storage)).toEqual(before);
    act(storage, { type: 'attempt.giveUp' });
    expect(metadata(storedRoom(storage)!)).toMatchObject({ robots: metadata(room).robots, version: 0, moveCount: 0 });
  });
});

test('failed ordinary move write rolls back history and version, then exact retry applies once', async () => {
  await scenario((storage, room, proof) => {
    const request = input(room, proof[0]);
    storage.sql.exec("CREATE TRIGGER fail_move BEFORE INSERT ON membership_replays BEGIN SELECT RAISE(ABORT, 'injected'); END");
    try { expect(() => execute(storage, room, request)).toThrow(); }
    finally { storage.sql.exec('DROP TRIGGER fail_move'); }
    expect(storedRoom(storage)).toEqual(room);
    expect(execute(storage, room, request).outcome.status).toBe('accepted');
    expect(execute(storage, room, request).duplicate).toBe(true);
    expect(metadata(storedRoom(storage)!)).toMatchObject({ version: 1, moveCount: 1 });
  });
});

test('Give Up restores all robots, creates fresh attempt, exact retries never skip another bidder', async () => {
  await scenario((storage, room, proof) => {
    act(storage, proof[0]);
    const gaveUp = act(storage, { type: 'attempt.giveUp' });
    const next = storedRoom(storage)!;
    expect(metadata(next)).toMatchObject({ version: 0, moveCount: 0, robots: metadata(room).robots });
    expect(metadata(next).id).not.toBe(metadata(room).id);
    expect(execute(storage, room, gaveUp.request)).toMatchObject({ duplicate: true, outcome: { status: 'accepted' } });
    expect(storedRoom(storage)).toEqual(next);
    expect(act(storage, proof[0], 0).result.outcome).toEqual({ status: 'rejected', reason: 'not-active-bidder' });
    expect(act(storage, { type: 'attempt.giveUp' }, 1).result.outcome.status).toBe('accepted');
    const result = storedRoom(storage)!;
    expect(result.match).toMatchObject({ version: 4, state: { phase: 'round-result', outcome: { kind: 'all-bidders-gave-up' },
      officialRobots: room.match!.state.officialRobots, scores: room.match!.state.scores, completedRounds: 1 } });
    expect(execute(storage, room, gaveUp.request).duplicate).toBe(true);
    expect(storedRoom(storage)).toEqual(result);
  });
});

test.each(['colored', 'wildcard'] as const)('%s success atomically scores once and carries every final robot', async (kind) => {
  await scenario((storage, room, proof) => {
    let expected: MatchState = room.match!.state;
    let last: ReturnType<typeof act> | undefined;
    for (const command of proof) {
      expected = transitionMatch(expected, { source: 'player', context: { actorSeatId: room.state.hostSeatId, hostSeatId: room.state.hostSeatId, nowMs: 62000 }, command }).state;
      last = act(storage, command);
      expect(last.result.outcome.status).toBe('accepted');
    }
    const result = storedRoom(storage)!;
    expect(result.match).toEqual({ version: 4, state: expected });
    expect(expected).toMatchObject({ phase: 'round-result', scores: { [room.state.hostSeatId]: 1 },
      outcome: { kind: 'success', moveCount: proof.length, winningBid: 100 } });
    expect(JSON.stringify(result.state)).not.toMatch(/"moves"|internalProof|roundStartRobots|session/);
    expect(execute(storage, room, last!.request)).toMatchObject({ duplicate: true, outcome: { status: 'accepted' } });
    expect(execute(storage, room, { ...last!.request, commandId: crypto.randomUUID() }).outcome).toEqual({ status: 'rejected', reason: 'wrong-phase' });
    expect(execute(storage, room, { ...last!.request, command: { type: 'attempt.giveUp' } } as RoomRequest).outcome).toEqual({ status: 'rejected', reason: 'command-id-conflict' });
    expect(storedRoom(storage)).toEqual(result);
    const continueRequest: RoomRequest = { version: 1, commandId: crypto.randomUUID(), roomId: room.state.roomId,
      context: { matchId: expected.matchId, roundNumber: 1 }, command: { type: 'round.continue' } };
    expect(execute(storage, room, continueRequest).outcome.status).toBe('accepted');
    const preparing = storedRoom(storage)!;
    expect(preparing.match).toMatchObject({ state: { phase: 'preparing', officialRobots: expected.officialRobots, scores: expected.scores },
      job: { request: { setup: { robots: expected.officialRobots, usedTargetIds: expected.usedTargetIds } } } });
  }, kind);
});

test('failed replay write rolls back attempt version/history and round completion together', async () => {
  await scenario((storage, _room, proof) => {
    for (const command of proof.slice(0, -1)) act(storage, command);
    const before = storedRoom(storage)!;
    const request = input(before, proof.at(-1)!);
    storage.sql.exec("CREATE TRIGGER fail_attempt BEFORE INSERT ON membership_replays BEGIN SELECT RAISE(ABORT, 'injected'); END");
    try { expect(() => execute(storage, before, request)).toThrow(); }
    finally { storage.sql.exec('DROP TRIGGER fail_attempt'); }
    expect(storedRoom(storage)).toEqual(before);
    expect(execute(storage, before, request).outcome.status).toBe('accepted');
    expect(execute(storage, before, request).duplicate).toBe(true);
  });
});

test.each(['from', 'to', 'direction', 'extra', 'version', 'robots', 'roundStart'] as const)('corrupt live history/metadata %s fails closed', async (kind) => {
  await scenario((storage, _room, proof) => {
    act(storage, proof[0]);
    const original = storage.sql.exec<{ value: string }>('SELECT value FROM room_state').one().value;
    const bad = JSON.parse(original);
    const attempt = bad.match.state.attempt;
    if (kind === 'from') attempt.moves[0].from.row++;
    if (kind === 'to') attempt.moves[0].to.column++;
    if (kind === 'direction') attempt.moves[0].direction = 'north';
    if (kind === 'extra') attempt.moves[0].internalProof = [];
    if (kind === 'version') bad.match.attempt.version--;
    if (kind === 'robots') attempt.robots.red.column++;
    if (kind === 'roundStart') attempt.roundStartRobots.red.row++;
    storage.sql.exec('UPDATE room_state SET value = ?', JSON.stringify(bad));
    expect(() => storedRoom(storage)).toThrow();
    storage.sql.exec('UPDATE room_state SET value = ?', original);
    expect(storedRoom(storage)).toBeTruthy();
  });
});
