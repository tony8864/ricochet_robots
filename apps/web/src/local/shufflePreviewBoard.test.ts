import { expect, test, vi } from 'vitest';
import { puzzleCatalog } from '@robot-puzzle/puzzles';
import { shufflePreviewBoard } from './shufflePreviewBoard';

test('host shuffle chooses every alternative catalog entry without repeating the current board', () => {
  const before = JSON.stringify(puzzleCatalog);
  for (const current of puzzleCatalog) {
    const alternatives = puzzleCatalog.filter((puzzle) => puzzle.id !== current.id);
    alternatives.forEach((puzzle, index) => {
      const result = shufflePreviewBoard(current, 'maria', 'maria', () => index / alternatives.length);
      expect(result).toBe(puzzle);
      expect(result).not.toBe(current);
      expect(result.targets).toHaveLength(17);
    });
  }
  expect(JSON.stringify(puzzleCatalog)).toBe(before);
});

test('non-host cannot shuffle even by calling the handler logic directly', () => {
  const random = vi.fn(() => 0);
  const current = puzzleCatalog[0];
  expect(shufflePreviewBoard(current, 'alex', 'maria', random)).toBe(current);
  expect(random).not.toHaveBeenCalled();
});

test('host identity is supplied separately from the viewed player; one shuffle samples once', () => {
  const random = vi.fn(() => 0.99);
  const current = puzzleCatalog[0];
  expect(shufflePreviewBoard(current, 'alex', 'alex', random)).not.toBe(current);
  expect(random).toHaveBeenCalledOnce();
});
