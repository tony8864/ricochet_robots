import { expect, test } from 'vitest';
import { createMatch } from '@robot-puzzle/match';
import { starterBoard } from '@robot-puzzle/puzzles';
import { parsePublicRoomState, parseServerMessage, projectMatchState } from './index';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const match = createMatch({ matchId: id(1), puzzle: starterBoard,
  players: [{ seatId: id(2), nickname: 'Host' }, { seatId: id(3), nickname: 'Guest' }] });
function failed() {
  const projected = projectMatchState({ roomId: id(4), roomCode: 'ABC234', revision: 2, hostSeatId: id(2),
    match, connections: { [id(2)]: true, [id(3)]: false },
    preparation: { matchId: match.matchId, completedRounds: 0, activity: 'failed', retry: { preparationId: id(5), availableAtMs: 5000 } },
  });
  if (!projected.ok || projected.value.status !== 'playing' || projected.value.match.phase !== 'preparing') throw new Error('Expected failed snapshot');
  return projected.value;
}

test('safe preparation retry metadata projects, owns and round-trips without private fields', () => {
  const state = failed();
  expect(state.match).toMatchObject({ preparation: { status: 'error', retry: { preparationId: id(5), availableAtMs: 5000 } } });
  expect(parsePublicRoomState(state)).toEqual({ ok: true, value: state });
  expect(parseServerMessage({ version: 2, type: 'room.snapshot', state, serverTimeMs: 100 }).ok).toBe(true);
  expect(JSON.stringify(state)).not.toMatch(/candidateOrder|internalProof|diagnostics|budget|request/);
});

test.each([
  { preparationId: 'invalid', availableAtMs: 5000 }, { preparationId: id(5), availableAtMs: -1 },
  { preparationId: id(5), availableAtMs: 1.5 }, { preparationId: id(5), availableAtMs: 5000, budget: 1 },
  { preparationId: id(5) },
])('rejects invalid or over-specified retry metadata %#', (retry) => {
  const state = failed();
  expect(parsePublicRoomState({ ...state, match: { ...state.match, preparation: { status: 'error', retry } } }).ok).toBe(false);
});

test.each(['working', 'unavailable'])('does not advertise Retry for %s', (status) => {
  const state = failed();
  expect(parsePublicRoomState({ ...state, match: { ...state.match, preparation: { status, retry: { preparationId: id(5), availableAtMs: 5000 } } } }).ok).toBe(false);
});
