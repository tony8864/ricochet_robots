import { DIRECTIONS, moveRobot, ROBOT_IDS } from '@robot-puzzle/game-engine';
import { decodeRobots, encodeRobots } from './state';
import type { TransitionFactory } from './search';

/** Reference implementation retained for regression tests and benchmarks. */
export const createEngineTransition: TransitionFactory = (board) => (state, robot, direction) => {
  const result = moveRobot(board, decodeRobots(state), ROBOT_IDS[robot], DIRECTIONS[direction]);
  return result.moved ? encodeRobots(result.robots) : state;
};
