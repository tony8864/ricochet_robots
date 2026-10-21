import { cellIndex, replaceRobotCell, robotCell } from './state';
import type { TransitionFactory } from './search';

// Same order as engine DIRECTIONS: up, right, down, left.
const DELTAS = [-16, 1, 16, -1] as const;

/** Static wall stops are computed once per search; only robot stops vary. */
export const createIndexedTransition: TransitionFactory = (board) => {
  const blocked = new Set(board.blockedCells.map(cellIndex));
  const walls = new Set(board.walls.map(({ first, second }) => cellIndex(first) * 256 + cellIndex(second)));
  const stops = new Uint8Array(256 * 4);
  for (let cell = 0; cell < 256; cell++) {
    for (let direction = 0; direction < 4; direction++) {
      let end = cell;
      if (!blocked.has(cell)) {
        while (true) {
          const next = end + DELTAS[direction];
          if (
            next < 0 || next >= 256 ||
            ((direction === 1 || direction === 3) && (next >>> 4) !== (end >>> 4)) ||
            blocked.has(next) || walls.has(Math.min(end, next) * 256 + Math.max(end, next))
          ) break;
          end = next;
        }
      }
      stops[cell * 4 + direction] = end;
    }
  }
  return (state, robot, direction) => {
    const start = robotCell(state, robot);
    let end = stops[start * 4 + direction];
    if (start === end) return state;
    const horizontal = direction === 1 || direction === 3;
    const increasing = direction === 1 || direction === 2;
    for (let other = 0; other < 4; other++) {
      if (other === robot) continue;
      const obstacle = robotCell(state, other);
      const aligned = horizontal
        ? (obstacle >>> 4) === (start >>> 4)
        : (obstacle & 15) === (start & 15);
      if (aligned && (increasing
        ? obstacle > start && obstacle <= end
        : obstacle < start && obstacle >= end)) {
        end = obstacle - DELTAS[direction];
      }
    }
    return replaceRobotCell(state, robot, end);
  };
};
