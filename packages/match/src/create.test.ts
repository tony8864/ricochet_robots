import { expect, test } from 'vitest';
import { starterBoard } from '@robot-puzzle/puzzles';
import { createMatch, type CreateMatchInput } from './index';

const input: CreateMatchInput = {
  matchId: 'match-1', players: [{ seatId: 'maria', nickname: 'Maria' }, { seatId: 'alex', nickname: 'Alex' }], puzzle: starterBoard,
};

test('creates a match in Preparing with zero scores, no revealed target, and all initial positions', () => {
  const state = createMatch(input);
  expect(state).toEqual({
    phase: 'preparing', matchId: input.matchId, players: input.players, scores: { maria: 0, alex: 0 },
    puzzle: starterBoard, officialRobots: starterBoard.initialRobots, usedTargetIds: [], completedRounds: 0,
    preparation: { status: 'not-attempted' },
  });
  expect(state).not.toHaveProperty('round');
  expect(state).not.toHaveProperty('attempt');
  expect(state).not.toHaveProperty('hostSeatId');
  expect(state).not.toHaveProperty('deadlineAtMs');
});

test.each([2, 3, 4, 5, 6])('supports a fixed roster of %i players', (size) => {
  const players = Array.from({ length: size }, (_, id) => ({ seatId: `seat-${id}`, nickname: 'Same display name' }));
  const state = createMatch({ ...input, players });
  expect(state.players).toHaveLength(size);
  expect(Object.values(state.scores)).toEqual(Array(size).fill(0));
});

test.each([0, 1, 7])('rejects a roster of %i players', (size) => {
  const players = Array.from({ length: size }, (_, id) => ({ seatId: `seat-${id}`, nickname: 'Player' }));
  expect(() => createMatch({ ...input, players })).toThrow(/2–6/);
});

test.each([
  null, {}, { ...input, matchId: '' }, { ...input, matchId: '   ' },
  { ...input, players: null }, { ...input, players: [null, input.players[0]] },
  { ...input, players: [{ seatId: 'maria', nickname: '' }, input.players[1]] },
  { ...input, players: [{ seatId: ' ', nickname: 'Maria' }, input.players[1]] },
  { ...input, players: [input.players[0], input.players[0]] },
])('rejects invalid identity/roster data %#', (invalid) => {
  expect(() => createMatch(invalid as unknown as CreateMatchInput)).toThrow(TypeError);
});

test.each([
  null,
  { ...starterBoard, targets: [] },
  { ...starterBoard, board: { ...starterBoard.board, blockedCells: [] } },
  { ...starterBoard, initialRobots: { ...starterBoard.initialRobots, red: starterBoard.initialRobots.blue } },
])('validates catalog geometry, targets, and initial positions %#', (puzzle) => {
  expect(() => createMatch({ ...input, puzzle } as unknown as CreateMatchInput)).toThrow(/Invalid match board/);
});

test('owns copied input data and strips metadata rather than storing caller fields', () => {
  const mutable = JSON.parse(JSON.stringify(input));
  mutable.players[0].sessionCredential = 'not-match-data';
  mutable.puzzle.targets[0].internalProof = ['not-match-data'];
  mutable.puzzle.initialRobots.red.internalProof = ['not-match-data'];
  const state = createMatch(mutable);
  expect(state.players[0]).not.toHaveProperty('sessionCredential');
  expect(state.puzzle.targets[0]).not.toHaveProperty('internalProof');
  expect(state.officialRobots.red).not.toHaveProperty('internalProof');
  mutable.players[0].nickname = 'Changed';
  mutable.puzzle.targets[0].position.row = 0;
  mutable.puzzle.board.walls[0].first.row = 0;
  mutable.puzzle.initialRobots.red.column = 4;
  expect(state.players).toEqual(input.players);
  expect(state.puzzle).toEqual(starterBoard);
  expect(state.officialRobots).toEqual(starterBoard.initialRobots);
  expect(state.officialRobots).not.toBe(state.puzzle.initialRobots);
  expect(state.officialRobots.red).not.toBe(state.puzzle.initialRobots.red);
});

test('creates safe own score entries for arbitrary valid seat IDs', () => {
  const state = createMatch({ ...input, players: [{ seatId: '__proto__', nickname: 'A' }, { seatId: 'constructor', nickname: 'B' }] });
  expect(Object.keys(state.scores)).toEqual(['__proto__', 'constructor']);
  expect(state.scores['__proto__']).toBe(0);
  expect(state.scores['constructor']).toBe(0);
});
