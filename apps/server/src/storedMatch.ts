import type { PreparingMatchState } from '@robot-puzzle/match';
import { projectMatchState, type PublicRoomState } from '@robot-puzzle/shared';
import { canonicalJson } from './creations';

export interface StoredMatch {
  readonly version: 1;
  readonly state: PreparingMatchState;
}

/** T14.8 stores initial Preparing only. Later phases must explicitly extend this codec. */
export function validateStoredMatch(room: PublicRoomState, value: unknown): StoredMatch | undefined {
  if (room.status === 'lobby') {
    if (value !== undefined) throw new Error('Lobby contains unexpected match data');
    return undefined;
  }
  if (room.status !== 'playing' || room.match.phase !== 'preparing') throw new Error('Unsupported persisted match phase');
  const expected: PreparingMatchState = {
    phase: 'preparing', matchId: room.match.matchId,
    players: room.players.map(({ seatId, nickname }) => ({ seatId, nickname })),
    scores: Object.fromEntries(room.players.map((player) => [player.seatId, 0])),
    puzzle: room.puzzle, officialRobots: room.puzzle.initialRobots,
    usedTargetIds: [], completedRounds: 0, preparation: { status: 'not-attempted' },
  };
  // Validation only: do not call createMatch, replace a match or reset robots on restore/replay.
  if (value === undefined || canonicalJson(value) !== canonicalJson({ version: 1, state: expected })) {
    throw new Error('Invalid private match record');
  }
  const projected = projectMatchState({ ...room, match: expected,
    connections: Object.fromEntries(room.players.map((player) => [player.seatId, player.connected])),
    preparation: { matchId: expected.matchId, completedRounds: 0, activity: 'idle' } });
  if (!projected.ok || canonicalJson(projected.value) !== canonicalJson(room)) {
    throw new Error('Persisted match/public state mismatch');
  }
  return value as StoredMatch; // Exact structure/content was checked above against validated public data.
}
