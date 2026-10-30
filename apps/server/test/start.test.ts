import { env, SELF, runInDurableObject } from 'cloudflare:test';
import { expect, test, vi } from 'vitest';
import { puzzleCatalog } from '@robot-puzzle/puzzles';
import * as roundSetup from '@robot-puzzle/puzzles/round-setup';
import { parseServerMessage, type RoomEnteredMessage, type RoomRequest } from '@robot-puzzle/shared';
import { executeLobbyCommand, storedRoom } from '../src/lobbyCommands';
import { canonicalJson } from '../src/creations';

const origin = 'https://localhost:5173';
const stub = (id: string) => env.ROOMS.get(env.ROOMS.idFromName(id));
async function identity() {
  using result = await env.REGISTRY.get(env.REGISTRY.idFromName('registry-v1')).openSession(null);
  if (result.status !== 'ready' || !result.credential) throw new Error('Expected identity');
  return { sessionId: result.session.sessionId, cookie: `__Host-rr-session=${result.credential}` };
}
async function post(endpoint: string, command: object, cookie: string) {
  const response = await SELF.fetch(`${origin}${endpoint}`, { method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ version: 1, commandId: crypto.randomUUID(), command }) });
  expect(response.status).toBe(200);
  const result = parseServerMessage(await response.json());
  if (!result.ok || result.value.type !== 'room.entered') throw new Error('Expected membership');
  return result.value;
}
async function lobby(count = 2) {
  const host = await identity();
  let room = await post('/api/rooms', { type: 'room.create', nickname: 'Host' }, host.cookie);
  const guests = [];
  for (let index = 1; index < count; index++) {
    const guest = await identity();
    const joined = await post('/api/rooms/join', { type: 'room.join', nickname: `Guest ${index}`, roomCode: room.state.roomCode }, guest.cookie);
    guests.push({ ...guest, seatId: joined.seatId });
    room = { ...room, state: joined.state };
  }
  return { room, host, guests };
}
function start(room: RoomEnteredMessage): Extract<RoomRequest, { command: { type: 'room.start' } }> {
  if (room.state.status !== 'lobby') throw new Error('Expected lobby');
  return { version: 1, commandId: crypto.randomUUID(), roomId: room.roomId, context: { lobbyId: room.state.lobbyId },
    command: { type: 'room.start', boardId: room.state.puzzle.id } };
}

test.each([2, 6])('starts one %i-seat match without solver execution or loss of membership', async (count) => {
  const { room, host } = await lobby(count);
  const solver = vi.spyOn(roundSetup, 'prepareNextRound');
  try {
    await runInDurableObject(stub(room.roomId), (_instance, ctx) => {
      const before = storedRoom(ctx.storage)!;
      const id = vi.fn(() => crypto.randomUUID());
      const input = start(room);
      const first = executeLobbyCommand(ctx.storage, host.sessionId, room.seatId, input, undefined, id)!;
      expect(first.outcome).toEqual({ status: 'accepted' });
      const saved = storedRoom(ctx.storage)!;
      expect(saved.members).toEqual(before.members);
      expect(saved.initialization).toBe(before.initialization);
      expect(saved.state).toMatchObject({ roomId: room.roomId, roomCode: room.state.roomCode, hostSeatId: room.seatId,
        status: 'playing', revision: before.state.revision + 1, players: before.state.players,
        match: { phase: 'preparing', completedRounds: 0, usedTargetIds: [], officialRobots: room.state.puzzle.initialRobots,
          scores: Object.fromEntries(before.state.players.map((p) => [p.seatId, 0])), preparation: { status: 'working' } } });
      expect(saved.match).toMatchObject({ version: 1, state: { phase: 'preparing', preparation: { status: 'not-attempted' } } });
      expect(saved.state.puzzle).toEqual(room.state.puzzle);
      expect(saved.match!.state.puzzle).toEqual(room.state.puzzle);
      expect(JSON.stringify(saved.state)).not.toContain('not-attempted');
      const duplicate = executeLobbyCommand(ctx.storage, host.sessionId, room.seatId, input, undefined, id)!;
      expect(duplicate).toMatchObject({ duplicate: true, processedRevision: first.processedRevision, outcome: first.outcome });
      expect(id).toHaveBeenCalledTimes(1);
      expect(storedRoom(ctx.storage)).toEqual(saved);
      expect(executeLobbyCommand(ctx.storage, host.sessionId, room.seatId, { ...input, commandId: crypto.randomUUID() })!.outcome)
        .toEqual({ status: 'rejected', reason: 'wrong-phase' });
    });
    expect(solver).not.toHaveBeenCalled();
  } finally { solver.mockRestore(); }
});

test('rejects one player, non-host, stale lobby and changed board without creating a private match', async () => {
  const single = await lobby(1);
  await runInDurableObject(stub(single.room.roomId), (_instance, ctx) => {
    expect(executeLobbyCommand(ctx.storage, single.host.sessionId, single.room.seatId, start(single.room))!.outcome)
      .toEqual({ status: 'rejected', reason: 'not-enough-players' });
    expect(storedRoom(ctx.storage)!.match).toBeUndefined();
  });
  const { room, host, guests } = await lobby();
  await runInDurableObject(stub(room.roomId), (_instance, ctx) => {
    const input = start(room);
    expect(executeLobbyCommand(ctx.storage, guests[0].sessionId, guests[0].seatId, input)!.outcome)
      .toEqual({ status: 'rejected', reason: 'not-host' });
    expect(executeLobbyCommand(ctx.storage, host.sessionId, room.seatId, {
      ...start(room), context: { lobbyId: crypto.randomUUID() },
    })!.outcome).toEqual({ status: 'rejected', reason: 'stale-context' });
    expect(executeLobbyCommand(ctx.storage, host.sessionId, room.seatId, {
      ...start(room), command: { type: 'room.start', boardId: puzzleCatalog.find((p) => p.id !== room.state.puzzle.id)!.id },
    })!.outcome).toEqual({ status: 'rejected', reason: 'preview-changed' });
    expect(storedRoom(ctx.storage)!.match).toBeUndefined();
    expect(storedRoom(ctx.storage)!.state).toEqual(room.state);
  });
});

test('Start ID conflicts cannot replace the accepted match or replay outcome', async () => {
  const { room, host } = await lobby();
  await runInDurableObject(stub(room.roomId), (_instance, ctx) => {
    const input = start(room);
    executeLobbyCommand(ctx.storage, host.sessionId, room.seatId, input);
    const saved = storedRoom(ctx.storage)!;
    const conflict = { ...input, command: { type: 'board.shuffle' } } as const;
    expect(executeLobbyCommand(ctx.storage, host.sessionId, room.seatId, conflict)!.outcome)
      .toEqual({ status: 'rejected', reason: 'command-id-conflict' });
    expect(executeLobbyCommand(ctx.storage, host.sessionId, room.seatId, input)!.duplicate).toBe(true);
    expect(storedRoom(ctx.storage)).toEqual(saved);
  });
});

test('replay insertion failure rolls back private match, public state and revision, then exact retry succeeds', async () => {
  const { room, host } = await lobby();
  await runInDurableObject(stub(room.roomId), (_instance, ctx) => {
    const before = storedRoom(ctx.storage)!;
    const input = start(room);
    ctx.storage.sql.exec("CREATE TRIGGER fail_start_replay BEFORE INSERT ON membership_replays BEGIN SELECT RAISE(ABORT, 'injected failure'); END");
    try { expect(() => executeLobbyCommand(ctx.storage, host.sessionId, room.seatId, input)).toThrow(); }
    finally { ctx.storage.sql.exec('DROP TRIGGER fail_start_replay'); }
    expect(storedRoom(ctx.storage)).toEqual(before);
    expect(ctx.storage.sql.exec('SELECT COUNT(*) AS count FROM membership_replays WHERE command_id = ?', input.commandId).one().count).toBe(0);
    expect(executeLobbyCommand(ctx.storage, host.sessionId, room.seatId, input)!.outcome).toEqual({ status: 'accepted' });
  });
});

test.each(['missing', 'version', 'private-robots', 'public-scores', 'future-phase'])('corrupt %s stored match fails closed rather than reinitializing', async (kind) => {
  const { room, host } = await lobby();
  await runInDurableObject(stub(room.roomId), (_instance, ctx) => {
    executeLobbyCommand(ctx.storage, host.sessionId, room.seatId, start(room));
    const original = ctx.storage.sql.exec<{ value: string }>('SELECT value FROM room_state').one().value;
    const saved = JSON.parse(original);
    if (kind === 'missing') delete saved.match;
    if (kind === 'version') saved.match.version = 2;
    if (kind === 'private-robots') saved.match.state.officialRobots.red.column = (saved.match.state.officialRobots.red.column + 1) % 16;
    if (kind === 'public-scores') saved.state.match.scores[room.seatId] = 1;
    if (kind === 'future-phase') saved.match.state.phase = 'thinking';
    ctx.storage.sql.exec('UPDATE room_state SET value = ?', JSON.stringify(saved));
    try { expect(() => storedRoom(ctx.storage)).toThrow(); }
    finally { ctx.storage.sql.exec('UPDATE room_state SET value = ?', original); }
    expect(canonicalJson(storedRoom(ctx.storage))).toBe(canonicalJson(JSON.parse(original)));
  });
});
