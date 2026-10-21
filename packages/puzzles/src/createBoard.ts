import { CENTER_BLOCKED_CELLS, type Target } from '@robot-puzzle/game-engine';
import { cornerWalls } from './geometry';
import type { BoardDefinition, PuzzleBoard } from './types';
import { validateCatalog } from './validation';

/**
 * Build a fixed board from checked-in placements. No randomness or solver.
 * Throws with board ID and issue paths when the resulting board is invalid.
 */
export function createBoard(definition: BoardDefinition): PuzzleBoard {
  const targets = definition.targets.map((placement): Target => {
    const position = { row: placement.row, column: placement.column };
    if (placement.symbol === 'vortex') {
      return { id: 'wildcard-vortex', kind: 'wildcard', symbol: 'vortex', position };
    }
    return {
      id: `${placement.robotId}-${placement.symbol}`,
      kind: 'colored',
      robotId: placement.robotId,
      symbol: placement.symbol,
      position,
    };
  });

  const board: PuzzleBoard = {
    id: definition.id,
    name: definition.name,
    board: {
      blockedCells: CENTER_BLOCKED_CELLS,
      walls: [
        ...definition.targets.flatMap(({ row, column, corner }) =>
          cornerWalls({ row, column }, corner)),
        ...(definition.additionalWalls ?? []),
      ],
    },
    initialRobots: definition.initialRobots,
    targets,
  };

  const result = validateCatalog([board]);
  if (!result.valid) {
    const details = result.issues.map((issue) => `${issue.path}: ${issue.message}`).join('\n');
    throw new Error(`Invalid board "${definition.id}":\n${details}`);
  }
  return board;
}
