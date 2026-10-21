import { expect, test } from 'vitest';
import {
  createAttempt,
  COLORED_TARGET_SYMBOLS,
  ROBOT_IDS,
  validateGameState,
  getAttemptMoveCount,
  isTargetComplete,
  moveAttemptRobot,
  resetAttempt,
  undoAttempt,
} from '@robot-puzzle/game-engine';
import { getPuzzleBoard, starterBoard } from '@robot-puzzle/puzzles';
import { DEMO_BID_LIMIT, DEMO_BOARD_ID, DEMO_GAME_STATE, DEMO_TARGETS } from './demoGameState';

test('the demonstration uses the catalog board, starts, and all 17 valid targets', () => {
  const selectedBoard = getPuzzleBoard(DEMO_BOARD_ID);
  expect(selectedBoard).toBeDefined();
  expect(DEMO_GAME_STATE.board).toBe(selectedBoard?.board);
  expect(DEMO_GAME_STATE.robots).toBe(selectedBoard?.initialRobots);
  expect(DEMO_TARGETS).toBe(selectedBoard?.targets);
  expect(DEMO_TARGETS).toHaveLength(17);
  expect(new Set(DEMO_TARGETS.map((target) => target.id)).size).toBe(17);
  expect(new Set(DEMO_TARGETS.map(({ position }) => `${position.row},${position.column}`)).size).toBe(17);
  for (const robotId of ROBOT_IDS) {
    expect(DEMO_TARGETS.filter((target) => target.kind === 'colored' && target.robotId === robotId)
      .map((target) => target.symbol)).toEqual([...COLORED_TARGET_SYMBOLS]);
  }
  expect(DEMO_TARGETS.filter((target) => target.kind === 'wildcard')).toHaveLength(1);
  expect(DEMO_TARGETS).toContain(DEMO_GAME_STATE.target);
  for (const target of DEMO_TARGETS) {
    expect(validateGameState({ ...DEMO_GAME_STATE, target }).valid).toBe(true);
  }
});

test('the starter board blue star has a known two-move solution with undo and reset', () => {
  const target = starterBoard.targets.find(({ id }) => id === 'blue-star');
  if (!target) throw new Error('The starter board blue star is missing.');

  const firstMove = moveAttemptRobot(
    starterBoard.board,
    createAttempt(starterBoard.initialRobots),
    'blue',
    'down',
  );
  expect(firstMove.moved).toBe(true);
  expect(firstMove.attempt.robots.blue).toEqual({ row: 14, column: 15 });
  expect(
    isTargetComplete(firstMove.attempt.robots, target),
  ).toBe(false);

  const secondMove = moveAttemptRobot(
    starterBoard.board,
    firstMove.attempt,
    'blue',
    'left',
  );
  expect(secondMove.moved).toBe(true);
  expect(secondMove.attempt.robots.blue).toEqual(
    target.position,
  );
  expect(
    isTargetComplete(secondMove.attempt.robots, target),
  ).toBe(true);
  expect(getAttemptMoveCount(secondMove.attempt)).toBeLessThanOrEqual(
    DEMO_BID_LIMIT,
  );

  const undone = undoAttempt(secondMove.attempt);
  expect(undone.robots).toEqual(firstMove.attempt.robots);
  expect(getAttemptMoveCount(undone)).toBe(1);
  const reset = resetAttempt(secondMove.attempt);
  expect(reset.robots).toEqual(starterBoard.initialRobots);
  expect(getAttemptMoveCount(reset)).toBe(0);
});
