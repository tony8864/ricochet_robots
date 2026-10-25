import { validateCatalog } from '@robot-puzzle/puzzles';
import type { CreateMatchInput } from './commands';
import { copyPuzzle, copyRobots } from './data';
import type { PreparingMatchState } from './model';

function nonemptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/** Pure construction only; target selection is an explicit separate operation. */
export function createMatch(input: CreateMatchInput): PreparingMatchState {
  if (!input || typeof input !== 'object' || !nonemptyString(input.matchId)) {
    throw new TypeError('Match creation requires a non-empty matchId.');
  }
  if (!Array.isArray(input.players) || input.players.length < 2 || input.players.length > 6) {
    throw new TypeError('A match requires 2–6 players.');
  }
  const seen = new Set<string>();
  for (const player of input.players) {
    if (!player || !nonemptyString(player.seatId) || !nonemptyString(player.nickname)) {
      throw new TypeError('Every player requires a non-empty seatId and nickname.');
    }
    if (seen.has(player.seatId)) throw new TypeError(`Duplicate match seatId "${player.seatId}".`);
    seen.add(player.seatId);
  }
  const catalog = validateCatalog([input.puzzle]);
  if (!catalog.valid) {
    throw new TypeError('Invalid match board: ' + catalog.issues.map((issue) => `${issue.path}: ${issue.message}`).join('; '));
  }
  const puzzle = copyPuzzle(input.puzzle);
  const players = input.players.map(({ seatId, nickname }) => ({ seatId, nickname }));
  return {
    phase: 'preparing', matchId: input.matchId, players,
    scores: Object.fromEntries(players.map((player) => [player.seatId, 0])),
    puzzle, officialRobots: copyRobots(puzzle.initialRobots), usedTargetIds: [],
    completedRounds: 0, preparation: { status: 'not-attempted' },
  };
}
