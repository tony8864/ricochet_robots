import { expect, test } from 'vitest';
import {
  createAttempt,
  getAttemptMoveCount,
  isTargetComplete,
  moveAttemptRobot,
} from '@robot-puzzle/game-engine';
import { DEMO_BID_LIMIT, DEMO_GAME_STATE } from './demoGameState';

test('the temporary demo target has a solution within its bid limit', () => {
  const firstMove = moveAttemptRobot(
    DEMO_GAME_STATE.board,
    createAttempt(DEMO_GAME_STATE.robots),
    'blue',
    'left',
  );
  expect(firstMove.moved).toBe(true);
  expect(firstMove.attempt.robots.blue).toEqual({ row: 4, column: 9 });
  expect(
    isTargetComplete(firstMove.attempt.robots, DEMO_GAME_STATE.target),
  ).toBe(false);

  const secondMove = moveAttemptRobot(
    DEMO_GAME_STATE.board,
    firstMove.attempt,
    'blue',
    'up',
  );
  expect(secondMove.moved).toBe(true);
  expect(secondMove.attempt.robots.blue).toEqual(
    DEMO_GAME_STATE.target.position,
  );
  expect(
    isTargetComplete(secondMove.attempt.robots, DEMO_GAME_STATE.target),
  ).toBe(true);
  expect(getAttemptMoveCount(secondMove.attempt)).toBeLessThanOrEqual(
    DEMO_BID_LIMIT,
  );
});
