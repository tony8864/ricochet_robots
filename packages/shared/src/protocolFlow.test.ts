import { expect, test } from 'vitest';
import { DIRECTIONS, ROBOT_IDS, isTargetComplete, moveRobot } from '@robot-puzzle/game-engine';
import { createMatch, prepareMatchRound, transitionMatch, type MatchState, type PlayerMatchCommand } from '@robot-puzzle/match';
import { puzzleCatalog, starterBoard } from '@robot-puzzle/puzzles';
import { prepareNextRound, RECOMMENDED_ROUND_SETUP_BUDGET } from '@robot-puzzle/puzzles/round-setup';
import {
  parseClientRequestJson, parsePublicServerMessage, parseServerMessageJson, projectLobbyState,
  projectMatchState, type MatchProjectionInput, type PublicRoomState, type PublicStateResult,
} from './index';

const uuid = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
function unwrap(result: PublicStateResult): PublicRoomState {
  if (!result.ok) throw new Error(result.error);
  return result.value;
}

/** Contract harness only: no sockets, authentication, room handler or retry store. */
test.each([2, 6])('%i-player lifecycle round-trips real T11 states through request/reply contracts', (count) => {
  const players = ['Maria', 'Alex', 'Teo', 'Ana', 'Nora', 'Eli'].slice(0, count)
    .map((nickname, index) => ({ seatId: uuid(index + 1), nickname }));
  const host = players[0].seatId;
  const roomId = uuid(20);
  let serial = 100;
  let revision = 0;
  let nowMs = 1_000;
  let version = 0;
  const connections = Object.fromEntries(players.map((player) => [player.seatId, true]));
  const room = () => ({ roomId, roomCode: 'ABC234', revision, hostSeatId: host });
  const client = (request: unknown) => {
    const parsed = parseClientRequestJson(JSON.stringify(request));
    if (!parsed.ok) throw new Error(parsed.error);
    return parsed.value;
  };
  const server = (message: unknown) => {
    const text = JSON.stringify(message);
    expect(text).not.toMatch(/"(?:credential|internalProof|diagnostics|moves)"/);
    const parsed = parseServerMessageJson(text);
    if (!parsed.ok) throw new Error(parsed.error);
    return parsed.value;
  };
  const bootstrap = (command: unknown) => client({ version: 1, commandId: uuid(serial++), command });
  const preMatch = (command: unknown) => client({ version: 1, commandId: uuid(serial++), roomId, context: { lobbyId: uuid(21) }, command });
  const open = bootstrap({ type: 'session.open' });
  server({ version: 1, type: 'session.ready', commandId: open.commandId, serverTimeMs: nowMs });
  const create = bootstrap({ type: 'room.create', nickname: players[0].nickname });
  const preview = puzzleCatalog.find((board) => board.id !== starterBoard.id)!;
  let state = unwrap(projectLobbyState({ ...room(), lobbyId: uuid(21), puzzle: preview,
    players: [{ ...players[0], connected: true }],
  }));
  server({ version: 1, type: 'room.entered', commandId: create.commandId, roomId, seatId: host,
    membership: 'created', serverTimeMs: nowMs, state });
  for (let index = 1; index < count; index++) {
    const join = bootstrap({ type: 'room.join', nickname: players[index].nickname, roomCode: ' abc234 ' });
    expect(join.command).toMatchObject({ roomCode: 'ABC234' });
    revision++;
    state = unwrap(projectLobbyState({ ...room(), lobbyId: uuid(21), puzzle: preview,
      players: players.slice(0, index + 1).map((player) => ({ ...player, connected: true })),
    }));
    server({ version: 1, type: 'room.entered', commandId: join.commandId, roomId, seatId: players[index].seatId,
      membership: 'joined', serverTimeMs: nowMs, state });
  }
  preMatch({ type: 'board.shuffle' }); // Fixture chooses the board; no room shuffle implementation.
  revision++;
  state = unwrap(projectLobbyState({ ...room(), lobbyId: uuid(21), puzzle: starterBoard,
    players: players.map((player) => ({ ...player, connected: true })),
  }));
  expect(parsePublicServerMessage({ version: 1, type: 'room.snapshot', serverTimeMs: nowMs, state }).ok).toBe(true);
  preMatch({ type: 'room.start', boardId: starterBoard.id });
  let match: MatchState = createMatch({ matchId: uuid(30), players, puzzle: starterBoard });
  const currentMatch = (): MatchState => match;
  revision++;
  const attemptId = () => {
    if (match.phase !== 'demonstrating') throw new Error('Expected attempt.');
    return uuid(1_000 + match.round.number * 10 + match.activeBidderIndex);
  };
  function snapshot(): PublicRoomState {
    const common = { ...room(), connections };
    let source: MatchProjectionInput;
    if (match.phase === 'preparing') source = { ...common, match, preparation: {
      matchId: match.matchId, completedRounds: match.completedRounds, activity: 'idle',
    } };
    else if (match.phase === 'demonstrating') source = { ...common, match, attempt: {
      matchId: match.matchId, roundNumber: match.round.number, activeBidderIndex: match.activeBidderIndex,
      seatId: match.bidderQueue[match.activeBidderIndex].seatId, id: attemptId(), version,
    } };
    else source = { ...common, match };
    const state = unwrap(projectMatchState(source));
    server({ version: 1, type: 'room.snapshot', serverTimeMs: nowMs, state });
    return state;
  }
  function apply(command: PlayerMatchCommand, actor = host, expected: 'accepted' | 'no-op' | 'rejected' = 'accepted') {
    if (!('round' in match)) throw new Error('Expected active round.');
    const context = command.type.startsWith('attempt.')
      ? { matchId: match.matchId, roundNumber: match.round.number, attemptId: attemptId(), attemptVersion: version }
      : { matchId: match.matchId, roundNumber: match.round.number };
    const request = client({ version: 1, commandId: uuid(serial++), roomId, context, command });
    const before = match;
    const parsed = request.command;
    switch (parsed.type) {
      case 'bid.submit': case 'round.skip': case 'attempt.move': case 'attempt.undo': case 'attempt.reset': case 'attempt.giveUp': {
        // Actor/time are explicitly supplied by this fixture, never taken from JSON.
        const result = transitionMatch(match, { source: 'player', command: parsed, context: { actorSeatId: actor, hostSeatId: host, nowMs } });
        match = result.state;
        expect(result.outcome.status).toBe(expected);
        if (match !== before) revision++;
        if (before.phase === 'demonstrating' && match.phase === 'demonstrating' && before.activeBidderIndex === match.activeBidderIndex) {
          if (match !== before) version++;
        } else version = 0;
        server({ version: 1, type: 'command.result', commandId: request.commandId, roomId, outcome: result.outcome,
          processedRevision: revision, currentRevision: revision, duplicate: false, serverTimeMs: nowMs });
        snapshot();
        return request;
      }
      default: throw new Error('Expected model player command.');
    }
  }
  const options = { candidateOrder: starterBoard.targets.map((target) => target.id), budget: RECOMMENDED_ROUND_SETUP_BUDGET };
  snapshot();
  let previousRequest: ReturnType<typeof client> | undefined;
  for (let number = 1; number <= 10; number++) {
    match = prepareMatchRound(match, options).state;
    revision++;
    if (match.phase !== 'thinking') throw new Error('Expected real verified target.');
    expect(match.round.number).toBe(number);
    snapshot();
    if (previousRequest) {
      // A stale context remains syntactically valid: future room handlers must reject it.
      expect(client(previousRequest)).toEqual(previousRequest);
      expect('context' in previousRequest && 'roundNumber' in previousRequest.context && previousRequest.context.roundNumber).not.toBe(number);
    }
    if (number === 1 || number > 4) {
      if (number === 1) apply({ type: 'round.skip', confirmed: true }, players[1].seatId, 'rejected');
      apply({ type: 'round.skip', confirmed: true });
    } else {
      const winner = number === 4 ? players[1].seatId : host;
      const other = winner === host ? players[1].seatId : host;
      apply({ type: 'bid.submit', value: 501 }, winner);
      apply({ type: 'bid.submit', value: 503 }, other); // competing higher bids are valid
      apply({ type: 'bid.submit', value: 500 }, other);
      apply({ type: 'bid.submit', value: 500 }, winner); // original submission priority survives reductions
      const open = currentMatch();
      if (open.phase !== 'bidding') throw new Error('Expected bidding.');
      nowMs = open.deadlineAtMs;
      match = transitionMatch(match, { source: 'controller', command: { type: 'time.advance' }, context: { nowMs } }).state;
      revision++;
      version = 0;
      if (match.phase !== 'demonstrating') throw new Error('Expected demonstration.');
      expect(match.bidderQueue[0].seatId).toBe(winner);
      snapshot();
      apply({ type: 'attempt.undo' }, other, 'rejected'); // watcher/inactive host cannot control
      if (number === 2) {
        const start = match.officialRobots;
        let harmless: Extract<PlayerMatchCommand, { type: 'attempt.move' }> | undefined;
        for (const robotId of ROBOT_IDS) for (const direction of DIRECTIONS) {
          const moved = moveRobot(match.puzzle.board, match.attempt.robots, robotId, direction);
          if (moved.moved && !isTargetComplete(moved.robots, match.round.target)) harmless ??= { type: 'attempt.move', robotId, direction };
        }
        if (!harmless) throw new Error('Expected harmless legal move.');
        apply(harmless, winner);
        apply(harmless, winner, 'no-op');
        apply({ type: 'attempt.undo' }, winner);
        apply(harmless, winner);
        apply({ type: 'attempt.reset' }, winner);
        previousRequest = apply(harmless, winner);
        apply({ type: 'attempt.giveUp' }, winner);
        if (match.phase !== 'demonstrating') throw new Error('Expected next bidder.');
        expect(match.attempt.robots).toEqual(start);
        expect(match.attempt.moves).toEqual([]);
        apply({ type: 'attempt.giveUp' }, other);
      } else {
        const targetId = match.round.target.id;
        const verified = prepareNextRound({ ...options, puzzle: match.puzzle, robots: match.officialRobots,
          usedTargetIds: match.usedTargetIds.filter((id) => id !== targetId),
          candidateOrder: [targetId, ...options.candidateOrder.filter((id) => id !== targetId)],
        });
        if (verified.status !== 'selected') throw new Error('Expected private verified witness.');
        expect(verified.round.target).toEqual(match.round.target);
        expect(verified.internalProof.length).toBeLessThanOrEqual(500);
        for (const step of verified.internalProof) previousRequest = apply({ type: 'attempt.move', ...step }, winner);
      }
    }
    const resultMatch = currentMatch();
    if (resultMatch.phase !== 'round-result') throw new Error('Expected round completion.');
    expect(resultMatch.completedRounds).toBe(number);
    const continueRequest = client({ version: 1, commandId: uuid(serial++), roomId,
      context: { matchId: resultMatch.matchId, roundNumber: number }, command: { type: 'round.continue' } });
    expect(continueRequest.command.type).toBe('round.continue');
    // Trusted fixture controller translates host Continue; not a generic network handler.
    match = transitionMatch(match, { source: 'controller', command: { type: 'round.advance' }, context: { nowMs } }).state;
    revision++;
    snapshot();
  }
  if (match.phase !== 'finished') throw new Error('Expected Finished.');
  expect(match.scores[host]).toBe(1);
  expect(match.scores[players[1].seatId]).toBe(1); // positive shared first place
  expect(match.usedTargetIds).toHaveLength(10);
  expect(match.puzzle.id).toBe(starterBoard.id);
  const resume = bootstrap({ type: 'session.resume', roomId });
  state = snapshot();
  server({ version: 1, type: 'room.entered', commandId: resume.commandId, roomId, seatId: players[1].seatId,
    membership: 'resumed', serverTimeMs: nowMs, state });
  server({ version: 1, type: 'session.bound', roomId, seatId: host, serverTimeMs: nowMs, state });
  client({ version: 1, commandId: uuid(serial++), roomId, context: { matchId: match.matchId }, command: { type: 'match.returnToLobby' } });
  revision++;
  state = unwrap(projectLobbyState({ ...room(), lobbyId: uuid(22), puzzle: match.puzzle,
    players: players.map((player) => ({ ...player, connected: true })),
  }));
  server({ version: 1, type: 'room.snapshot', serverTimeMs: nowMs, state });
  expect(state).not.toHaveProperty('match');
  expect(state.players.map((player) => player.seatId)).toEqual(players.map((player) => player.seatId));
});
