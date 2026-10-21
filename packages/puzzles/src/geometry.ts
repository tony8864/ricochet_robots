import type { BlockedEdge, Coordinate } from '@robot-puzzle/game-engine';
import type { WallCorner } from './types';

function orderedEdge(first: Coordinate, second: Coordinate): BlockedEdge {
  return first.row < second.row || (first.row === second.row && first.column < second.column)
    ? { first, second }
    : { first: second, second: first };
}

export function cornerWalls(position: Coordinate, corner: WallCorner): readonly BlockedEdge[] {
  const { row, column } = position;
  const verticalNeighbor = {
    row: row + (corner.startsWith('top') ? -1 : 1),
    column,
  };
  const horizontalNeighbor = {
    row,
    column: column + (corner.endsWith('left') ? -1 : 1),
  };
  return [
    orderedEdge(position, verticalNeighbor),
    orderedEdge(position, horizontalNeighbor),
  ];
}
