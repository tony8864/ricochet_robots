import { puzzleCatalog, type PuzzleBoard } from '@robot-puzzle/puzzles';

/** Local setup guard, not network authentication; catalog layouts are never modified. */
export function shufflePreviewBoard(
  current: PuzzleBoard,
  actorSeatId: string,
  hostSeatId: string,
  random: () => number = Math.random,
): PuzzleBoard {
  if (actorSeatId !== hostSeatId) return current;
  const alternatives = puzzleCatalog.filter((puzzle) => puzzle.id !== current.id);
  if (alternatives.length === 0) return current;
  const sample = random();
  if (!Number.isFinite(sample) || sample < 0 || sample >= 1) {
    throw new RangeError('Shuffle randomness must be between zero (inclusive) and one (exclusive).');
  }
  return alternatives[Math.floor(sample * alternatives.length)];
}
