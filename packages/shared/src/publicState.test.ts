import { describe, expect, expectTypeOf, test, vi } from 'vitest';
import {
  createMatch, prepareMatchRound, transitionMatch, type MatchState,
  type PreparingMatchState,
} from '@robot-puzzle/match';
import { puzzleCatalog, starterBoard } from '@robot-puzzle/puzzles';
import { prepareNextRound, RECOMMENDED_ROUND_SETUP_BUDGET } from '@robot-puzzle/puzzles/round-setup';
import type { BlockedEdge } from '@robot-puzzle/game-engine';
import {
  MAX_SERVER_MESSAGE_BYTES, parsePublicRoomState, projectLobbyState, projectMatchState,
  type LobbyProjectionInput, type MatchProjectionInput, type PreparationProjectionMetadata,
  type PublicMatch, type PublicRoomState, type PublicStateResult,
} from './index';
import { utf8Length } from './requestValidation';

const uuid = (number: number) => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
const roster = ['Maria', 'Alex', 'Teo', 'Ana', 'Nora', 'Eli'].map((nickname, index) => ({ seatId: uuid(index + 1), nickname }));
const metadata = { roomId: uuid(20), roomCode: 'ABC234', revision: 5, hostSeatId: roster[0].seatId };
const options = {
  candidateOrder: ['blue-star', ...starterBoard.targets.map((target) => target.id).filter((id) => id !== 'blue-star')],
  budget: RECOMMENDED_ROUND_SETUP_BUDGET,
};
function initial(players = roster): PreparingMatchState { return createMatch({ matchId: uuid(30), players, puzzle: starterBoard }); }
function input(match: MatchState): MatchProjectionInput {
  const base = { ...metadata, connections: Object.fromEntries(match.players.map((player) => [player.seatId, true])) };
  if (match.phase === 'preparing') return { ...base, match, preparation: { matchId: match.matchId, completedRounds: match.completedRounds, activity: 'idle' } };
  if (match.phase === 'demonstrating') return { ...base, match, attempt: {
    matchId: match.matchId, roundNumber: match.round.number, activeBidderIndex: match.activeBidderIndex,
    seatId: match.bidderQueue[match.activeBidderIndex].seatId, id: uuid(40 + match.activeBidderIndex), version: match.attempt.moves.length,
  } };
  return { ...base, match };
}
function value(result: PublicStateResult): PublicRoomState {
  if (!result.ok) throw new Error(result.error);
  return result.value;
}
function lobby(players = roster): LobbyProjectionInput {
  return { ...metadata, lobbyId: uuid(25), players: players.map((player) => ({ ...player, connected: true })), puzzle: starterBoard };
}
const projected = (match: MatchState) => value(projectMatchState(input(match)));
const clone = <T,>(source: T): T => JSON.parse(JSON.stringify(source));
const invalid = (source: unknown) => expect(parsePublicRoomState(source)).toEqual({ ok: false, error: 'invalid-snapshot' });
const thinking = prepareMatchRound(initial(), options).state;
if (thinking.phase !== 'thinking') throw new Error('Verified fixture required.');
const bidding = transitionMatch(thinking, {
  source: 'player', context: { actorSeatId: roster[0].seatId, hostSeatId: roster[0].seatId, nowMs: 1_000 },
  command: { type: 'bid.submit', value: Number.MAX_SAFE_INTEGER },
}).state;
if (bidding.phase !== 'bidding') throw new Error('Bidding fixture required.');
const demonstrating = transitionMatch(bidding, { source: 'controller', context: { nowMs: bidding.deadlineAtMs }, command: { type: 'time.advance' } }).state;
if (demonstrating.phase !== 'demonstrating') throw new Error('Demonstration fixture required.');

test('disconnect metadata is bounded, copied, offline-only and limited to Demonstrating', () => {
  const base = input(demonstrating);
  if (!('attempt' in base)) throw new Error('Expected attempt input');
  const disconnect = { disconnectId: uuid(90), disconnectedAtMs: 1000, skipAllowedAtMs: 61000, status: 'grace' as const };
  const source = { ...base, connections: { ...base.connections, [roster[0].seatId]: false }, disconnect };
  const room = value(projectMatchState(source));
  expect(room.status === 'playing' && room.match.phase === 'demonstrating' && room.match.disconnect).toEqual(disconnect);
  expect(room.status === 'playing' && room.match.phase === 'demonstrating' && room.match.disconnect).not.toBe(disconnect);
  if (room.status !== 'playing' || room.match.phase !== 'demonstrating') throw new Error('Expected demonstration');
  for (const malformed of [{ ...disconnect, status: 'ready' }, { ...disconnect, skipAllowedAtMs: 60999 },
    { ...disconnect, disconnectedAtMs: -1 }, { ...disconnect, disconnectId: 'not-an-id' }, { ...disconnect, privateHistory: [] }]) {
    invalid({ ...room, match: { ...room.match, disconnect: malformed } });
  }
  invalid({ ...room, players: room.players.map((p) => ({ ...p, connected: true })) });
  const thinkingRoom = projected(thinking);
  if (thinkingRoom.status !== 'playing') throw new Error('Expected match');
  invalid({ ...thinkingRoom, match: { ...thinkingRoom.match, disconnect } });
  expect(projectMatchState({ ...source, connections: base.connections }).ok).toBe(false);
});
const skipped = transitionMatch(thinking, { source: 'player', context: { actorSeatId: roster[0].seatId, hostSeatId: roster[0].seatId, nowMs: 1_000 }, command: { type: 'round.skip', confirmed: true } }).state;
const exhausted = transitionMatch(demonstrating, { source: 'player', context: { actorSeatId: roster[0].seatId, hostSeatId: roster[0].seatId, nowMs: 99_000 }, command: { type: 'attempt.giveUp' } }).state;
const proof = prepareNextRound({ ...options, puzzle: starterBoard, robots: thinking.officialRobots, usedTargetIds: [] });
if (proof.status !== 'selected') throw new Error('Private verified fixture required.');
let success: MatchState = demonstrating;
for (const step of proof.internalProof) success = transitionMatch(success, {
  source: 'player', context: { actorSeatId: roster[0].seatId, hostSeatId: roster[0].seatId, nowMs: 99_000 }, command: { type: 'attempt.move', ...step },
}).state;
if (success.phase !== 'round-result' || success.outcome.kind !== 'success') throw new Error('Real success required.');
let finished: MatchState = initial();
for (let round = 1; round <= 10; round++) {
  finished = prepareMatchRound(finished, { ...options, candidateOrder: starterBoard.targets.map((target) => target.id) }).state;
  if (finished.phase !== 'thinking') throw new Error('Expected next real round.');
  finished = transitionMatch(finished, { source: 'player', context: { actorSeatId: roster[0].seatId, hostSeatId: roster[0].seatId, nowMs: 1_000 }, command: { type: 'round.skip', confirmed: true } }).state;
  finished = transitionMatch(finished, { source: 'controller', context: { nowMs: 1_000 }, command: { type: 'round.advance' } }).state;
}

describe('public phase contract and ownership', () => {
  test.each([initial(), thinking, bidding, demonstrating, skipped, exhausted, success, finished].map((match) => [match.phase + ('outcome' in match ? match.outcome.kind : ''), match] as const))('%s projects real model state and round-trips', (_, match) => {
    const before = JSON.stringify(match);
    const output = projected(match);
    expect(output.status).toBe(match.phase === 'finished' ? 'finished' : 'playing');
    if (output.status === 'lobby') throw new Error('Expected match output.');
    expect(output.match.phase).toBe(match.phase);
    expect(output.match.scores).toEqual(match.scores);
    expect(output.match.officialRobots).toEqual(match.officialRobots);
    expect(output.match.usedTargetIds).toEqual(match.usedTargetIds);
    expect(parsePublicRoomState(clone(output))).toEqual({ ok: true, value: output });
    expect(output.match.officialRobots).not.toBe(match.officialRobots);
    expect(output.puzzle.board.walls[0].first).not.toBe(match.puzzle.board.walls[0].first);
    expect(output.players[0]).not.toBe(match.players[0]);
    expect(JSON.stringify(match)).toBe(before);
    expect(output.match).not.toHaveProperty('players');
    expect(output.match).not.toHaveProperty('puzzle');
    if (match.phase !== 'demonstrating') expect(output.match).not.toHaveProperty('attempt');
    if (match.phase !== 'bidding') expect(output.match).not.toHaveProperty('deadlineAtMs');
  });
  test.each([1, 2, 6])('lobby accepts %i seats and no active match fields', (count) => {
    const source = lobby(roster.slice(0, count));
    const output = value(projectLobbyState(source));
    expect(output.status).toBe('lobby');
    expect(output.players).toHaveLength(count);
    expect(output).not.toHaveProperty('match');
    expect(output).not.toHaveProperty('scores');
    expect(output).not.toHaveProperty('you');
    expect(parsePublicRoomState(output)).toEqual({ ok: true, value: output });
  });
  test('two-player model projects without a six-seat assumption', () => {
    expect(projected(initial(roster.slice(0, 2))).players).toHaveLength(2);
  });
  test('phase type narrows public fields', () => {
    type Done = Extract<PublicMatch, { phase: 'finished' }>;
    expectTypeOf<Done['completedRounds']>().toEqualTypeOf<10>();
    expectTypeOf<Done>().not.toHaveProperty('round');
    type Demo = Extract<PublicMatch, { phase: 'demonstrating' }>;
    expectTypeOf<Demo['attempt']['moveCount']>().toEqualTypeOf<number>();
    expectTypeOf<Demo['attempt']>().not.toHaveProperty('moves');
  });
  test('success commits and all-zero finish preserve scores without a second winner table', () => {
    const result = projected(success);
    if (result.status === 'lobby' || result.match.phase !== 'round-result') throw new Error('Expected result.');
    expect(result.match.scores[roster[0].seatId]).toBe(1);
    const output = projected(finished);
    if (output.status !== 'finished') throw new Error('Expected finish.');
    expect(Object.values(output.match.scores)).toEqual([0, 0, 0, 0, 0, 0]);
    expect(output.match).not.toHaveProperty('winnerSeatId');
    expect(output.match).not.toHaveProperty('standings');
  });
});

describe('source context and safe preparation mapping', () => {
  const contexts: readonly [PreparationProjectionMetadata['activity'], 'not-attempted' | 'deferred' | 'unavailable', string][] = [
    ['idle', 'not-attempted', 'working'], ['idle', 'deferred', 'deferred'], ['idle', 'unavailable', 'unavailable'],
    ['pending', 'deferred', 'working'], ['pending', 'unavailable', 'working'], ['failed', 'not-attempted', 'error'], ['failed', 'deferred', 'error'],
  ];
  test.each(contexts)('%s + %s maps to %s without diagnostics', (activity, status, expected) => {
    const match = { ...initial(), preparation: { status, diagnostics: { internalProof: 'SECRET' } } } as PreparingMatchState;
    const source = input(match);
    if (!('preparation' in source)) throw new Error('Expected prep metadata.');
    const output = value(projectMatchState({ ...source, preparation: { ...source.preparation, activity } }));
    expect(output).toMatchObject({ match: { preparation: { status: expected } } });
    expect(JSON.stringify(output)).not.toContain('SECRET');
    expect(JSON.stringify(output)).not.toContain('diagnostics');
  });
  test.each(['matchId', 'roundNumber', 'activeBidderIndex', 'seatId'] as const)('rejects mismatched attempt metadata %s', (field) => {
    const source = input(demonstrating);
    if (!('attempt' in source)) throw new Error('Expected attempt metadata.');
    const attempt = { ...source.attempt, [field]: typeof source.attempt[field] === 'number' ? 99 : uuid(999) };
    expect(projectMatchState({ ...source, attempt } as MatchProjectionInput)).toEqual({ ok: false, error: 'invalid-projection' });
  });
  test('requires valid context, connections and preparation/attempt metadata', () => {
    const prep = input(initial());
    if (!('preparation' in prep)) throw new Error('Expected prep.');
    expect(projectMatchState({ ...prep, preparation: { ...prep.preparation, matchId: uuid(999) } }).ok).toBe(false);
    expect(projectMatchState({ ...prep, preparation: { ...prep.preparation, completedRounds: 1 } }).ok).toBe(false);
    expect(projectMatchState({ ...prep, connections: {} }).ok).toBe(false);
    expect(projectMatchState({ ...prep, connections: { ...prep.connections, [uuid(999)]: true } }).ok).toBe(false);
    const demo = input(demonstrating);
    expect(projectMatchState({ ...demo, attempt: undefined } as unknown as MatchProjectionInput).ok).toBe(false);
    expect(projectMatchState({ ...prep, preparation: undefined } as unknown as MatchProjectionInput).ok).toBe(false);
  });
  test('rejects inconsistent internal round target or attempt start', () => {
    const altered = { ...thinking, round: { ...thinking.round, target: { ...thinking.round.target, position: { row: 0, column: 0 } } } };
    expect(projectMatchState(input(altered)).ok).toBe(false);
    const demo = { ...demonstrating, attempt: { ...demonstrating.attempt, roundStartRobots: { ...demonstrating.officialRobots, red: { row: 1, column: 1 } } } };
    expect(projectMatchState(input(demo)).ok).toBe(false);
  });
});

describe('strict public structure and cross-field validation', () => {
  test.each([null, undefined, [], {}, 0, true, new Date(), () => 0])('rejects non-state %#', invalid);
  const states = [value(projectLobbyState(lobby())), ...[initial(), thinking, bidding, demonstrating, skipped, success, finished].map(projected)];
  test.each(states.map((state) => [state.status === 'lobby' ? 'lobby' : state.match.phase, state] as const))('%s rejects missing and unknown variant fields', (_, state) => {
    for (const name of Object.keys(state)) {
      const altered = { ...state } as Record<string, unknown>;
      delete altered[name]; invalid(altered);
    }
    invalid({ ...state, cookie: 'SECRET' });
    if (state.status !== 'lobby') {
      for (const name of Object.keys(state.match)) {
        const altered = { ...state.match } as Record<string, unknown>;
        delete altered[name]; invalid({ ...state, match: altered });
      }
      invalid({ ...state, match: { ...state.match, cookie: 'SECRET' } });
      invalid({ ...state, lobbyId: uuid(25) });
    } else invalid({ ...state, match: {} });
  });

  test('rejects corrupt roster, geometry, target, text and identity data', () => {
    const state = value(projectLobbyState(lobby()));
    const alterations: unknown[] = [
      { ...state, hostSeatId: uuid(999) }, { ...state, roomId: 'bad' }, { ...state, roomCode: 'abc234' },
      { ...state, revision: -1 }, { ...state, revision: Number.MAX_SAFE_INTEGER + 1 },
      { ...state, players: [] }, { ...state, players: Array(7).fill(state.players[0]) },
      { ...state, players: [state.players[0], state.players[0]] },
      { ...state, players: [{ ...state.players[0], nickname: ' Maria ' }] },
      { ...state, players: [{ ...state.players[0], connected: 1 }] },
      { ...state, players: [{ ...state.players[0], privateToken: 'SECRET' }] },
      { ...state, puzzle: { ...state.puzzle, name: 'x'.repeat(81) } },
      { ...state, puzzle: { ...state.puzzle, name: 'bad\nname' } },
      { ...state, puzzle: { ...state.puzzle, id: 'UPPER' } },
      { ...state, puzzle: { ...state.puzzle, targets: state.puzzle.targets.slice(1) } },
      { ...state, puzzle: { ...state.puzzle, targets: Array(17).fill(state.puzzle.targets[0]) } },
      { ...state, puzzle: { ...state.puzzle, initialRobots: { ...state.puzzle.initialRobots, blue: state.puzzle.initialRobots.red } } },
      { ...state, puzzle: { ...state.puzzle, initialRobots: { ...state.puzzle.initialRobots, red: { row: 7, column: 7 } } } },
      { ...state, puzzle: { ...state.puzzle, board: { ...state.puzzle.board, walls: [] } } }, // target angles missing
      { ...state, puzzle: { ...state.puzzle, board: { ...state.puzzle.board, walls: Array(481).fill(state.puzzle.board.walls[0]) } } },
      { ...state, puzzle: { ...state.puzzle, board: { ...state.puzzle.board, blockedCells: [] } } },
    ];
    alterations.forEach(invalid);
    for (const path of ['row', 'column']) {
      const altered = clone(state);
      (altered.puzzle.targets[0].position as unknown as Record<string, unknown>)[path] = 16;
      invalid(altered);
    }
  });

  test('rejects bad scores, used targets, phase counts and deadline fields', () => {
    const state = projected(thinking);
    if (state.status === 'lobby') throw new Error('Expected match.');
    const bad = [
      { ...state.match, scores: {} }, { ...state.match, scores: { ...state.match.scores, [uuid(999)]: 0 } },
      { ...state.match, scores: { ...state.match.scores, [roster[0].seatId]: 1 } },
      { ...state.match, completedRounds: 10 }, { ...state.match, usedTargetIds: [] },
      { ...state.match, usedTargetIds: ['nonexistent'] }, { ...state.match, usedTargetIds: Array(11).fill('blue-star') },
      { ...state.match, deadlineAtMs: 123 }, { ...state.match, attempt: {} },
    ];
    bad.forEach((match) => invalid({ ...state, match }));
    invalid({ ...state, status: 'finished' });
    const done = projected(finished);
    invalid({ ...done, status: 'playing' });
  });

  test('checks nested round, bids, queue, positions and attempt invariants', () => {
    const state = projected(demonstrating);
    if (state.status === 'lobby' || state.match.phase !== 'demonstrating') throw new Error('Expected attempt.');
    const match = state.match;
    const bad = [
      { ...match, activeBidderIndex: 1 }, { ...match, bidderQueue: [] },
      { ...match, bidderQueue: [match.bidderQueue[0], match.bidderQueue[0]] },
      { ...match, bidderQueue: [{ ...match.bidderQueue[0], value: 0 }] },
      { ...match, bidderQueue: [{ ...match.bidderQueue[0], firstAcceptedOrder: 6 }] },
      { ...match, round: { ...match.round, targetId: 'red-square' } },
      { ...match, round: { ...match.round, number: 2 } },
      { ...match, round: { ...match.round, startRobots: { ...match.officialRobots, red: { row: 1, column: 1 } } } },
      { ...match, attempt: { ...match.attempt, id: 'bad' } },
      { ...match, attempt: { ...match.attempt, version: -1 } },
      { ...match, attempt: { ...match.attempt, moveCount: Number.MAX_SAFE_INTEGER + 1 } },
      { ...match, attempt: { ...match.attempt, moveCount: 1, version: 0 } },
      { ...match, attempt: { ...match.attempt, moves: [] } },
      { ...match, attempt: { ...match.attempt, robots: { ...match.attempt.robots, red: { row: 1, column: 1 } } } }, // zero count must match start
    ];
    bad.forEach((item) => invalid({ ...state, match: item }));
    const second = { seatId: roster[1].seatId, value: 1, firstAcceptedOrder: 1 };
    invalid({ ...state, match: { ...match, bidderQueue: [match.bidderQueue[0], second] } }); // descending values
    const tied = { ...match.bidderQueue[0], value: 1 };
    invalid({ ...state, match: { ...match, bidderQueue: [second, tied] } }); // reversed tie priority
    const bidState = projected(bidding);
    if (bidState.status === 'lobby' || bidState.match.phase !== 'bidding') throw new Error('Expected bids.');
    invalid({ ...bidState, match: { ...bidState.match, deadlineAtMs: Infinity } });
    expect(parsePublicRoomState({ ...bidState, match: { ...bidState.match, deadlineAtMs: 0 } }).ok).toBe(true); // no client clock check
  });

  test('a success requires the actual final target position and coherent outcome fields', () => {
    const state = projected(success);
    if (state.status === 'lobby' || state.match.phase !== 'round-result' || state.match.outcome.kind !== 'success') throw new Error('Expected success.');
    const outcome = state.match.outcome;
    invalid({ ...state, match: { ...state.match, officialRobots: thinking.officialRobots } });
    invalid({ ...state, match: { ...state.match, outcome: { ...outcome, winnerSeatId: uuid(999) } } });
    invalid({ ...state, match: { ...state.match, outcome: { ...outcome, moveCount: 0 } } });
    invalid({ ...state, match: { ...state.match, outcome: { ...outcome, winningBid: 1, moveCount: 2 } } });
    invalid({ ...state, match: { ...state.match, outcome: { kind: 'no-bid-skip', winningBid: 1 } } });
  });

  test('supports positive ties and stable roster order without declaring arbitrary winners', () => {
    const state = projected(finished);
    if (state.status !== 'finished') throw new Error('Expected finished.');
    const tied = { ...state, match: { ...state.match, scores: { ...state.match.scores, [roster[0].seatId]: 2, [roster[1].seatId]: 2 } } };
    expect(parsePublicRoomState(tied).ok).toBe(true);
    expect(tied.players.map((player) => player.seatId)).toEqual(roster.map((player) => player.seatId));
  });

  test('wildcard success accepts any robot, while a colored target requires its matching robot', () => {
    const state = clone(projected(success));
    if (state.status === 'lobby' || state.match.phase !== 'round-result') throw new Error('Expected result.');
    const vortex = state.puzzle.targets.find((target) => target.kind === 'wildcard')!;
    const wildcardState = { ...state, match: { ...state.match, round: { ...state.match.round, targetId: vortex.id },
      usedTargetIds: [vortex.id], officialRobots: { ...thinking.officialRobots, red: vortex.position } } };
    expect(parsePublicRoomState(wildcardState).ok).toBe(true);
    const colored = state.puzzle.targets.find((target) => target.kind === 'colored' && target.robotId === 'blue')!;
    const wrongRobotState = { ...state, match: { ...state.match, round: { ...state.match.round, targetId: colored.id },
      usedTargetIds: [colored.id], officialRobots: { ...thinking.officialRobots, red: colored.position } } };
    invalid(wrongRobotState);
  });
});

describe('privacy, boundedness and payload size', () => {
  test('projection strips fake secrets recursively instead of serializing the internal model', () => {
    const source = clone(input(demonstrating));
    const poisoned = source as unknown as Record<string, unknown>;
    poisoned.credential = 'SECRET';
    const match = source.match as unknown as Record<string, unknown>;
    match.privateToken = 'SECRET';
    Object.assign(source.match.players[0], { credentialHash: 'SECRET' });
    Object.assign(source.match.puzzle, { internalProof: 'SECRET' });
    Object.assign(source.match.puzzle.board, { diagnostic: 'SECRET' });
    Object.assign(source.match.puzzle.board.walls[0], { secret: 'SECRET' });
    Object.assign(source.match.puzzle.board.walls[0].first, { secret: 'SECRET' });
    Object.assign(source.match.puzzle.targets[0], { solution: 'SECRET' });
    Object.assign(source.match.puzzle.targets[0].position, { secret: 'SECRET' });
    if (source.match.phase !== 'demonstrating') throw new Error('Expected demo.');
    Object.assign(source.match.round, { solverProof: 'SECRET' });
    Object.assign(source.match.round.target, { solverProof: 'SECRET' });
    Object.assign(source.match.round.startRobots.red, { secret: 'SECRET' });
    Object.assign(source.match.attempt, { diagnostics: 'SECRET' });
    Object.assign(source.match.attempt.robots.red, { secret: 'SECRET' });
    Object.assign(source.match.bidderQueue[0], { credential: 'SECRET' });
    const output = value(projectMatchState(source));
    expect(JSON.stringify(output)).not.toContain('SECRET');
    expect(JSON.stringify(output)).not.toContain('moves');
    expect(output).toEqual(projected(demonstrating));
    expect(JSON.stringify(source)).toContain('SECRET');
  });

  test('unknown public nested fields, accessors, sparse arrays, and prototype data are rejected safely', () => {
    const state = value(projectLobbyState(lobby()));
    const getter = vi.fn(() => { throw new Error('SECRET'); });
    const changed = clone(state);
    Object.defineProperty(changed.players[0], 'nickname', { enumerable: true, get: getter });
    invalid(changed);
    expect(getter).not.toHaveBeenCalled();
    const fieldsToPoison = [
      (copy: PublicRoomState) => copy.puzzle.board.walls[0].first,
      (copy: PublicRoomState) => copy.puzzle.targets[0],
      (copy: PublicRoomState) => copy.puzzle.initialRobots.red,
    ];
    for (const select of fieldsToPoison) { const copy = clone(state); Object.assign(select(copy), { secret: 'SECRET' }); invalid(copy); }
    invalid({ ...state, players: new Array(2) });
    invalid({ ...state, players: Object.assign([...state.players], { secret: 'SECRET' }) });
    invalid(Object.create(state));
    invalid(new Proxy({}, { getPrototypeOf() { throw new Error('SECRET'); } }));
    expect(JSON.stringify(parsePublicRoomState({ ...state, credential: 'SECRET' }))).not.toContain('SECRET');
  });

  test.each(puzzleCatalog.map((puzzle) => [puzzle.id, puzzle] as const))('%s six-player snapshot fits with membership-envelope overhead and maximum bid', (_, puzzle) => {
    const publicState = value(projectLobbyState({ ...lobby(), puzzle }));
    const encoded = JSON.stringify({ version: 2, type: 'room.entered', commandId: uuid(100), roomId: metadata.roomId, seatId: roster[0].seatId, membership: 'joined', serverTimeMs: Number.MAX_SAFE_INTEGER, state: publicState });
    expect(utf8Length(encoded)).toBeLessThan(MAX_SERVER_MESSAGE_BYTES);
    expect(parsePublicRoomState(JSON.parse(encoded).state).ok).toBe(true);
    // Longest accepted bid stays a scalar; no history payload grows with it.
    const demo = projected(demonstrating);
    expect(utf8Length(JSON.stringify({ version: 2, type: 'room.snapshot', serverTimeMs: Number.MAX_SAFE_INTEGER, state: demo }))).toBeLessThan(MAX_SERVER_MESSAGE_BYTES);
  });

  test('maximum-length Unicode names and identifiers remain well below the envelope cap', () => {
    const source = lobby();
    const targets = source.puzzle.targets.map((target, index) => ({ ...target, id: `${index}-` + 'x'.repeat(60) }));
    // All legal adjacent non-central edges: the densest possible valid 16×16 geometry.
    // This is a size/structure fixture only, not a claimed solvable game board.
    const walls: BlockedEdge[] = [];
    const blocked = (row: number, column: number) => (row === 7 || row === 8) && (column === 7 || column === 8);
    for (let row = 0; row < 16; row++) for (let column = 0; column < 16; column++) {
      if (blocked(row, column)) continue;
      if (column < 15 && !blocked(row, column + 1)) walls.push({ first: { row, column }, second: { row, column: column + 1 } });
      if (row < 15 && !blocked(row + 1, column)) walls.push({ first: { row, column }, second: { row: row + 1, column } });
    }
    expect(walls).toHaveLength(468);
    const output = value(projectLobbyState({ ...source, revision: Number.MAX_SAFE_INTEGER,
      players: source.players.map((player) => ({ ...player, nickname: '😀'.repeat(24) })),
      puzzle: { ...source.puzzle, board: { ...source.puzzle.board, walls }, id: 'b'.repeat(64), name: '😀'.repeat(80), targets },
    }));
    expect(utf8Length(JSON.stringify({ version: 2, type: 'room.snapshot', serverTimeMs: Number.MAX_SAFE_INTEGER, state: output }))).toBeLessThan(MAX_SERVER_MESSAGE_BYTES);
  });

  test('zero-count resets can retain a higher attempt version without inventing history', () => {
    const source = input(demonstrating);
    if (!('attempt' in source)) throw new Error('Expected demo.');
    const state = value(projectMatchState({ ...source, attempt: { ...source.attempt, version: 20 } }));
    expect(state).toMatchObject({ match: { attempt: { version: 20, moveCount: 0 } } });
  });
});
