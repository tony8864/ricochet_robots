import { env, SELF, runInDurableObject, runDurableObjectAlarm } from 'cloudflare:test';
import { afterEach, expect, test, vi } from 'vitest';
import { parseServerMessage, type PublicRoomState, type RoomRequest, type ServerMessage } from '@robot-puzzle/shared';
import { starterBoard } from '@robot-puzzle/puzzles';
import { prepareNextRound, RECOMMENDED_ROUND_SETUP_BUDGET } from '@robot-puzzle/puzzles/round-setup';
import { DIRECTIONS, ROBOT_IDS, isTargetComplete, moveRobot, type RobotPositions } from '../../../packages/game-engine/src';
import { storedRoom } from '../src/lobbyCommands';
import { LiveLobby } from '../src/liveLobby';

const origin = 'https://localhost:5173';
const roomStub = (id: string) => env.ROOMS.get(env.ROOMS.idFromName(id));
const opened: Peer[] = [];
const roomIds: string[] = [];

class Peer {
  connectionId = '';
  sequence = 0;
  pongSequence = 0;
  state!: PublicRoomState;
  readonly closed: Promise<void>;
  private readonly replies = new Map<string, Extract<ServerMessage, { type: 'command.result' }>>();
  private readonly listeners = new Set<() => void>();
  constructor(readonly ws: WebSocket) {
    this.closed = new Promise((resolve) => ws.addEventListener('close', () => {
      if (ws.readyState === WebSocket.CLOSING) ws.close();
      resolve();
    }));
    ws.addEventListener('message', (event) => {
      const parsed = parseServerMessage(JSON.parse(String(event.data)));
      if (!parsed.ok) throw new Error('Invalid server message');
      const message = parsed.value;
      if (message.type === 'session.bound') this.connectionId = message.connectionId;
      if (message.type === 'connection.pong') this.pongSequence = message.sequence;
      expect(String(event.data)).not.toMatch(/internalProof|roundStartRobots|"moves"|credential|sessionId/);
      if (message.type === 'room.snapshot' || message.type === 'session.bound') {
        if (this.state) {
          expect(message.state.revision).toBeGreaterThanOrEqual(this.state.revision);
          if (message.state.revision === this.state.revision) expect(message.state).toEqual(this.state);
        }
        this.state = message.state;
      }
      if (message.type === 'command.result') this.replies.set(message.commandId, message);
      for (const listener of [...this.listeners]) listener();
    });
    ws.accept();
  }
  private waitFor<T>(read: () => T | undefined): Promise<T> {
    const current = read();
    if (current !== undefined) return Promise.resolve(current);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.listeners.delete(listener);
        reject(new Error(`No expected server reply; last state ${this.state?.status}/${this.state?.status !== 'lobby' ? this.state?.match.phase : ''}, revision ${this.state?.revision}`));
      }, 5000);
      const listener = () => { const value = read(); if (value !== undefined) { clearTimeout(timer); this.listeners.delete(listener); resolve(value); } };
      this.listeners.add(listener);
    });
  }
  revision(revision = 0) { return this.waitFor(() => this.state?.revision >= revision ? this.state : undefined); }
  async heartbeat(roomId: string) {
    const sequence = ++this.sequence;
    this.ws.send(JSON.stringify({ version: 2, type: 'connection.ping', roomId, connectionId: this.connectionId, sequence }));
    await this.waitFor(() => this.pongSequence === sequence ? true : undefined);
  }
  async send(input: RoomRequest) {
    this.replies.delete(input.commandId);
    this.ws.send(JSON.stringify(input));
    return this.waitFor(() => this.replies.get(input.commandId));
  }
}

afterEach(async () => {
  for (const peer of opened) { if (peer.ws.readyState === WebSocket.OPEN) peer.ws.close(1000); await peer.closed; }
  for (const id of roomIds) await runInDurableObject(roomStub(id), async (instance, ctx) => {
    await (instance as unknown as { live: LiveLobby }).live.idle();
    await ctx.storage.deleteAlarm();
  });
  opened.length = 0; roomIds.length = 0; vi.restoreAllMocks();
});

/** Test entropy controls only random inputs. Real server shuffle, selector and budgets remain intact. */
function entropyQueue() {
  const values: number[] = [];
  vi.spyOn(crypto, 'getRandomValues').mockImplementation(<T extends ArrayBufferView | null>(array: T): T => {
    if (!(array instanceof Uint32Array) || array.length !== 1 || !values.length) throw new Error('Unexpected test entropy request');
    array[0] = values.shift()!;
    return array;
  });
  return {
    creation() { values.push(0, 0, 0, 0, 0, 0, 0); }, // Six code characters, catalog index 0.
    preparation(vortex: boolean) {
      const order = starterBoard.targets.map((t) => t.id);
      const preferred = vortex ? starterBoard.targets.find((t) => t.kind === 'wildcard')!.id : 'red-star';
      const desired = [preferred, ...order.filter((id) => id !== preferred)];
      for (let i = order.length - 1; i > 0; i--) {
        const j = order.indexOf(desired[i]);
        values.push(j);
        [order[i], order[j]] = [order[j], order[i]];
      }
    },
    empty() { expect(values).toHaveLength(0); },
  };
}

test.each([[2, 'winner'], [6, 'tie'], [2, 'no-winner']] as const)(
  '%i authenticated players complete ten rounds, %s results and same-room rematch', async (count, outcome) => {
    let now = Date.now();
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const post = async (path: string, command: object, cookie?: string) => {
      const response = await SELF.fetch(`${origin}${path}`, { method: 'POST',
        headers: { Origin: origin, 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
        body: JSON.stringify({ version: 2, commandId: crypto.randomUUID(), command }) });
      expect(response.status).toBe(200);
      const parsed = parseServerMessage(await response.json());
      if (!parsed.ok) throw new Error('Invalid HTTP reply');
      return { response, message: parsed.value };
    };
    const cookies: string[] = [];
    for (let i = 0; i < count; i++) {
      const session = await post('/api/session', { type: 'session.open' });
      expect(session.message.type).toBe('session.ready');
      const cookie = session.response.headers.get('Set-Cookie')?.split(';')[0];
      if (!cookie) throw new Error('Missing anonymous cookie');
      cookies.push(cookie);
    }
    const entropy = entropyQueue();
    entropy.creation();
    const created = await post('/api/rooms', { type: 'room.create', nickname: 'Player 0' }, cookies[0]);
    if (created.message.type !== 'room.entered') throw new Error('Expected room');
    const entry = created.message;
    const roomId = entry.roomId;
    roomIds.push(roomId);
    expect(entry.state.puzzle.id).toBe(starterBoard.id);
    const seats = [entry.seatId];
    for (let i = 1; i < count; i++) {
      const joined = await post('/api/rooms/join', { type: 'room.join', nickname: `Player ${i}`, roomCode: entry.state.roomCode }, cookies[i]);
      if (joined.message.type !== 'room.entered') throw new Error('Expected join');
      seats.push(joined.message.seatId);
    }
    entropy.empty();
    const connect = async (cookie: string) => {
      const response = await SELF.fetch(`${origin}/api/rooms/${roomId}/socket`, { headers: { Origin: origin, Upgrade: 'websocket', Cookie: cookie } });
      expect(response.status).toBe(101);
      if (!response.webSocket) throw new Error('Expected socket');
      const peer = new Peer(response.webSocket); opened.push(peer); await peer.revision(); return peer;
    };
    let peers: Peer[] = [];
    for (const cookie of cookies) peers.push(await connect(cookie));
    let state = peers.at(-1)!.state;
    const synchronize = async (revision: number) => {
      const states = await Promise.all(peers.map((peer) => peer.revision(revision)));
      for (const other of states) expect(other).toEqual(states[0]);
      state = states[0];
      return state;
    };
    await synchronize(state.revision);
    const request = (command: RoomRequest['command']): RoomRequest => {
      let context: RoomRequest['context'] = {};
      if (command.type === 'room.start' || command.type === 'board.shuffle') {
        if (state.status !== 'lobby') throw new Error('Expected lobby'); context = { lobbyId: state.lobbyId };
      } else if (command.type !== 'state.request' && state.status !== 'lobby') {
        context = { matchId: state.match.matchId };
        if ('round' in state.match) context = { ...context, roundNumber: state.match.round.number };
        if (command.type.startsWith('attempt.') && state.match.phase === 'demonstrating') context = { ...context,
          roundNumber: state.match.round.number, attemptId: state.match.attempt.id, attemptVersion: state.match.attempt.version };
      }
      return { version: 2, commandId: crypto.randomUUID(), roomId, context, command } as RoomRequest;
    };
    const send = async (seat: number, input: RoomRequest) => {
      const result = await peers[seat].send(input);
      await synchronize(result.currentRevision);
      expect(state.roomId).toBe(roomId); expect(state.roomCode).toBe(entry.state.roomCode);
      expect(state.puzzle).toEqual(entry.state.puzzle);
      return result;
    };
    const act = async (seat: number, command: RoomRequest['command'], status = 'accepted') => {
      const before = state;
      const input = request(command); const result = await send(seat, input); expect(result.outcome.status).toBe(status);
      if (status !== 'accepted') expect(state).toEqual(before);
      if (before.status !== 'lobby' && state.status !== 'lobby') {
        const delta = Object.values(state.match.scores).reduce((a, b) => a + b, 0) - Object.values(before.match.scores).reduce((a, b) => a + b, 0);
        expect([0, 1]).toContain(delta);
        if (delta) expect(command.type).toBe('attempt.move');
      }
      return input;
    };
    const prepare = async () => {
      now++;
      expect(await runDurableObjectAlarm(roomStub(roomId))).toBe(true);
      const latest = await runInDurableObject(roomStub(roomId), (_instance, ctx) => storedRoom(ctx.storage)!.state);
      await synchronize(latest.revision);
      if (state.status !== 'playing' || state.match.phase !== 'thinking') throw new Error(`Preparation blocked: ${JSON.stringify(latest.status !== 'lobby' ? latest.match : latest.status)}`);
      entropy.empty();
    };
    const demo = () => {
      if (state.status !== 'playing' || state.match.phase !== 'demonstrating') throw new Error('Expected demonstration');
      return state.match;
    };
    const detour = (exclude?: string) => {
      const attempt = demo();
      const target = state.puzzle.targets.find((t) => t.id === attempt.round.targetId)!;
      for (const robotId of ROBOT_IDS) for (const direction of DIRECTIONS) {
        const move = moveRobot(state.puzzle.board, attempt.attempt.robots, robotId, direction);
        if (robotId !== exclude && move.moved && !isTargetComplete(move.robots, target)) return { type: 'attempt.move' as const, robotId, direction };
      }
      throw new Error('No safe detour');
    };
    const originalLobby = state.status === 'lobby' ? state.lobbyId : '';
    entropy.preparation(false);
    const started = await act(0, { type: 'room.start', boardId: state.puzzle.id });
    const matchId = state.status !== 'lobby' ? state.match.matchId : '';
    let official = state.puzzle.initialRobots;
    const scores = Object.fromEntries(seats.map((seat) => [seat, 0]));
    const targets = new Set<string>();
    let helperSolution = false;
    let vortexSolved = false;
    for (let round = 1; round <= 10; round++) {
      await prepare();
      state = await synchronize(peers[0].state.revision);
      if (state.status !== 'playing' || state.match.phase !== 'thinking') throw new Error('Expected Thinking');
      const thinking = state.match;
      expect(thinking.round.number).toBe(round);
      expect(thinking.round.startRobots).toEqual(official);
      expect(thinking.officialRobots).toEqual(official);
      expect(thinking.scores).toEqual(scores);
      expect(targets.has(thinking.round.targetId)).toBe(false); targets.add(thinking.round.targetId);
      expect(thinking.usedTargetIds).toHaveLength(round);
      expect(thinking.usedTargetIds).toEqual([...targets]);
      const beforeRound = official;
      const target = state.puzzle.targets.find((t) => t.id === thinking.round.targetId)!;
      const skipped = outcome === 'no-winner' ? round % 2 === 1 : [3, 6, 9].includes(round);
      const exhausted = outcome === 'no-winner' ? !skipped : [4, 7, 10].includes(round);
      if (skipped) await act(0, { type: 'round.skip', confirmed: true });
      else {
        const proof = prepareNextRound({ puzzle: state.puzzle, robots: official, usedTargetIds: [...targets].filter((id) => id !== target.id),
          candidateOrder: [target.id, ...state.puzzle.targets.filter((t) => t.id !== target.id).map((t) => t.id)], budget: RECOMMENDED_ROUND_SETUP_BUDGET });
        if (proof.status !== 'selected' || proof.round.target.id !== target.id) throw new Error('Private driver could not reproduce verified proof');
        const winner = round === 1 || (round === 8 && outcome === 'tie') ? 1 : 0;
        const values = seats.map((_, i) => i === winner ? proof.internalProof.length + (round === 1 ? 2 : 0) : proof.internalProof.length + 10 + i);
        if (round === 1 && !exhausted) values[0] = 2;
        for (let i = 0; i < count; i++) await act(i, { type: 'bid.submit', value: values[i] });
        state = await synchronize(peers[0].state.revision);
        if (state.status !== 'playing' || state.match.phase !== 'bidding') throw new Error('Expected bidding');
        const deadline = state.match.deadlineAtMs;
        while (now < deadline) {
          now = Math.min(now + 10000, deadline);
          await Promise.all(peers.map((peer) => peer.heartbeat(roomId)));
        }
        await runDurableObjectAlarm(roomStub(roomId));
        const latest = await runInDurableObject(roomStub(roomId), (_instance, ctx) => storedRoom(ctx.storage)!.state);
        state = await synchronize(latest.revision);
        expect(demo().round.startRobots).toEqual(beforeRound);
        if (round === 1 && !exhausted) {
          await act(0, { type: 'attempt.undo' }, 'no-op');
          const first = detour(); await act(0, first);
          const second = detour(first.robotId); await act(0, second);
          await act(0, second, 'no-op');
          await act(0, detour(), 'rejected');
          await act(0, { type: 'attempt.undo' }); expect(demo().attempt.moveCount).toBe(1);
          await act(0, { type: 'attempt.reset' }); expect(demo().attempt.robots).toEqual(beforeRound);
          const uncertain = await act(0, first);
          const saved = await runInDurableObject(roomStub(roomId), (_instance, ctx) => storedRoom(ctx.storage)!.match);
          for (const peer of peers) if (peer.ws.readyState === WebSocket.OPEN) peer.ws.close(1000);
          await Promise.all(peers.map((peer) => peer.closed));
          // Reconstruct the transport controller with real attachments/storage.
          // Separate T16.5 tests exercise full runtime shutdown/recreation.
          await runInDurableObject(roomStub(roomId), async (instance, ctx) => {
            await (instance as unknown as { live: LiveLobby }).live.idle();
            const nativeEnv = (instance as unknown as { env: Env }).env;
            const restored = new LiveLobby(ctx, nativeEnv);
            await restored.publish(false);
            Reflect.set(instance, 'live', restored);
          });
          peers = []; for (const cookie of cookies) peers.push(await connect(cookie));
          await synchronize(peers.at(-1)!.state.revision);
          expect(await runInDurableObject(roomStub(roomId), (_instance, ctx) => storedRoom(ctx.storage)!.match)).toEqual(saved);
          expect(await send(0, uncertain)).toMatchObject({ duplicate: true, outcome: { status: 'accepted' } });
          await act(0, { type: 'attempt.giveUp' });
          expect(demo().attempt.robots).toEqual(beforeRound); expect(demo().attempt.moveCount).toBe(0);
        }
        if (exhausted) {
          while (state.status === 'playing' && state.match.phase === 'demonstrating') {
            const seat = seats.indexOf(demo().bidderQueue[demo().activeBidderIndex].seatId);
            await act(seat, detour());
            await act(seat, { type: 'attempt.giveUp' });
            if (state.status === 'playing' && state.match.phase === 'demonstrating') expect(demo().attempt.robots).toEqual(beforeRound);
          }
        } else {
          let expected: RobotPositions = beforeRound;
          let moveCount = 0;
          for (const move of proof.internalProof) {
            expected = moveRobot(state.puzzle.board, expected, move.robotId, move.direction).robots;
            moveCount++;
            const input = await act(winner, { type: 'attempt.move', ...move });
            if (state.status === 'playing' && state.match.phase === 'demonstrating') {
              expect(demo().attempt.robots).toEqual(expected);
              expect(demo().attempt.moveCount).toBe(moveCount);
              expect(demo().officialRobots).toEqual(beforeRound);
            } else expect(await send(winner, input)).toMatchObject({ duplicate: true, outcome: { status: 'accepted' } });
          }
          official = expected; scores[seats[winner]]++;
          const completed: PublicRoomState = peers[0].state;
          expect(completed).toMatchObject({ match: { outcome: { kind: 'success', winnerSeatId: seats[winner], winningBid: values[winner], moveCount } } });
          if (target.kind === 'wildcard') vortexSolved = true;
          if (round === 1) {
            expect(official.red).not.toEqual(beforeRound.red); expect(official.blue).not.toEqual(beforeRound.blue); helperSolution = true;
          }
        }
      }
      state = await synchronize(peers[0].state.revision);
      if (state.status !== 'playing' || state.match.phase !== 'round-result') throw new Error('Expected result');
      expect(state.match.completedRounds).toBe(round);
      expect(state.match.officialRobots).toEqual(official);
      expect(state.match.scores).toEqual(scores);
      expect(state.match.outcome.kind).toBe(skipped ? 'no-bid-skip' : exhausted ? 'all-bidders-gave-up' : 'success');
      await act(1, { type: 'round.continue' }, 'rejected');
      if (round < 10) entropy.preparation(round + 1 === 5);
      const continuation = await act(0, { type: 'round.continue' });
      expect(await send(0, continuation)).toMatchObject({ duplicate: true, outcome: { status: 'accepted' } });
    }
    state = await synchronize(peers[0].state.revision);
    if (state.status !== 'finished') throw new Error('Expected Finished');
    expect(state.match.completedRounds).toBe(10); expect(targets.size).toBe(10);
    expect(state.match.usedTargetIds).toHaveLength(10); expect(state.match.scores).toEqual(scores);
    if (outcome === 'no-winner') expect(Object.values(scores).every((v) => v === 0)).toBe(true);
    else { expect(helperSolution).toBe(true); expect(vortexSolved).toBe(true); expect(scores[seats[0]]).toBe(outcome === 'tie' ? 2 : 3); expect(scores[seats[1]]).toBe(outcome === 'tie' ? 2 : 1); }
    expect(await runDurableObjectAlarm(roomStub(roomId))).toBe(true); // Remaining obligation is session expiry, never round 11.
    await act(0, { type: 'state.request' }, 'no-op'); expect(state.status).toBe('finished');
    const returned = await act(0, { type: 'match.returnToLobby' });
    expect(await send(0, returned)).toMatchObject({ duplicate: true });
    expect(await send(0, started)).toMatchObject({ duplicate: true });
    state = await synchronize(peers[0].state.revision);
    if (state.status !== 'lobby') throw new Error('Expected returned lobby');
    expect(state.lobbyId).not.toBe(originalLobby); expect(state.players.map((p) => p.seatId)).toEqual(seats);
    expect(state.hostSeatId).toBe(seats[0]); expect(state.puzzle.id).toBe(starterBoard.id);
    entropy.preparation(false);
    await act(0, { type: 'room.start', boardId: state.puzzle.id });
    state = await synchronize(peers[0].state.revision);
    if (state.status !== 'playing' || state.match.phase !== 'preparing') throw new Error('Expected new match');
    expect(state.match.matchId).not.toBe(matchId); expect(state.match.scores).toEqual(Object.fromEntries(seats.map((id) => [id, 0])));
    expect(state.match.completedRounds).toBe(0); expect(state.match.usedTargetIds).toEqual([]); entropy.empty();
  }, 60000,
);
