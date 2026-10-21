import { expect, test } from 'vitest';
import { DIRECTIONS, moveRobot, ROBOT_IDS, type RobotPositions } from '@robot-puzzle/game-engine';
import { puzzleCatalog } from '../catalog';
import { helperFixture, impossibleFixture } from './fixtures';
import { createIndexedTransition } from './indexedTransitions';
import { cellIndex, decodeRobots, encodeRobots } from './state';

const cases = [
  ...puzzleCatalog.map((entry) => ({ id: entry.id, board: entry.board, robots: entry.initialRobots })),
  { id: 'helper', ...helperFixture }, { id: 'impossible', ...impossibleFixture },
];

test.each(cases)('$id indexed transitions agree with the engine', ({ board, robots }) => {
  const transition = createIndexedTransition(board);
  const check = (positions: RobotPositions) => {
    const state = encodeRobots(positions);
    for (let robot = 0; robot < 4; robot++) {
      for (let direction = 0; direction < 4; direction++) {
        const expected = moveRobot(board, positions, ROBOT_IDS[robot], DIRECTIONS[direction]);
        expect(decodeRobots(transition(state, robot, direction))).toEqual(expected.robots);
      }
    }
  };
  // Visit every legal cell with deterministic, distinct companion placements.
  // This includes cells next to both sides of walls, center, and boundaries.
  const blocked = new Set(board.blockedCells.map(cellIndex));
  const cells = Array.from({ length: 256 }, (_, i) => i).filter((i) => !blocked.has(i));
  for (let i = 0; i < cells.length; i++) {
    const position = (offset: number) => {
      const cell = cells[(i + offset) % cells.length];
      return { row: cell >>> 4, column: cell & 15 };
    };
    check({ red: position(0), blue: position(1), green: position(2), yellow: position(3) });
  }
  // Also exercise reachable, less clustered states and moving helper blockers.
  let current = robots;
  let seed = 42;
  for (let i = 0; i < 80; i++) {
    check(current);
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const move = seed >>> 28;
    current = moveRobot(board, current, ROBOT_IDS[move >>> 2], DIRECTIONS[move & 3]).robots;
  }
});
