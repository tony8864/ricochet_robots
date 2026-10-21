import { constellationBoard } from './boards/constellationBoard';
import { crossroadsBoard } from './boards/crossroadsBoard';
import { pinwheelBoard } from './boards/pinwheelBoard';
import { starterBoard } from './boards/starterBoard';
import { switchbackBoard } from './boards/switchbackBoard';
import type { PuzzleBoard } from './types';

// To register a board, import its file above and add it to this list.
export const puzzleCatalog: readonly PuzzleBoard[] = [
  starterBoard,
  crossroadsBoard,
  switchbackBoard,
  pinwheelBoard,
  constellationBoard,
];

export function getPuzzleBoard(id: string): PuzzleBoard | undefined {
  return puzzleCatalog.find((entry) => entry.id === id);
}
