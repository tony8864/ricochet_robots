import type { Page } from '@playwright/test';
import type { PublicRoomState } from '../../../packages/shared/src';
import { DIRECTIONS, ROBOT_IDS, isTargetComplete, moveRobot, type RobotPositions } from '../../../packages/game-engine/src';
import { solvePuzzle, type SolverMove } from '../../../packages/puzzles/src/solver';
import { RECOMMENDED_ROUND_SETUP_BUDGET } from '../../../packages/puzzles/src/roundSetup';
import { expect } from './fixtures';

export type PlayingRoom = Extract<PublicRoomState, { status: 'playing' }>;

/** Private Node-side driver: no proof is put in a browser, server response or log. */
export function planRound(room: PlayingRoom) {
  if (room.match.phase !== 'thinking') throw new Error('Expected Thinking for route verification');
  const round = room.match.round;
  const start = round.startRobots;
  const target = room.puzzle.targets.find((item) => item.id === round.targetId)!;
  const budget = RECOMMENDED_ROUND_SETUP_BUDGET;
  const base = solvePuzzle({ board: room.puzzle.board, robots: start, target }, budget.perCandidate);
  if (base.status !== 'solved') throw new Error(`Private route verification blocked: ${room.puzzle.id}/${target.id}`);
  const replay = (moves: readonly SolverMove[]) => {
    let robots = start; const accepted: SolverMove[] = [];
    for (const move of moves) {
      const result = moveRobot(room.puzzle.board, robots, move.robotId, move.direction);
      if (!result.moved) continue;
      robots = result.robots; accepted.push(move);
      if (isTargetComplete(robots, target)) return { robots, moves: accepted };
    }
    return null;
  };
  const changed = (robots: RobotPositions) => ROBOT_IDS.filter((id) =>
    robots[id].row !== start[id].row || robots[id].column !== start[id].column).length;
  const prefixes: Array<{ moves: SolverMove[]; robots: RobotPositions }> = [];
  for (const robotId of ROBOT_IDS) for (const direction of DIRECTIONS) {
    const first = moveRobot(room.puzzle.board, start, robotId, direction);
    if (!first.moved || isTargetComplete(first.robots, target)) continue;
    for (const secondId of ROBOT_IDS) for (const secondDirection of DIRECTIONS) {
      if (secondId === robotId) continue;
      const second = moveRobot(room.puzzle.board, first.robots, secondId, secondDirection);
      if (!second.moved || isTargetComplete(second.robots, target)) continue;
      const moves = [{ robotId, direction }, { robotId: secondId, direction: secondDirection }];
      prefixes.push({ moves, robots: second.robots });
      const result = replay([...moves, ...base.moves]);
      if (result && changed(result.robots) >= 2) return { start, detour: moves, solution: result.moves, final: result.robots };
    }
  }
  // Rare obstruction fallback is bounded by the existing total expansion policy.
  let remaining = budget.maxTotalExpandedStates - base.stats.expandedStates;
  for (const prefix of prefixes) {
    if (remaining <= 0) break;
    const result = solvePuzzle({ board: room.puzzle.board, robots: prefix.robots, target },
      { ...budget.perCandidate, maxExpandedStates: Math.min(remaining, budget.perCandidate.maxExpandedStates) });
    remaining -= result.stats.expandedStates;
    if (result.status !== 'solved') continue;
    const checked = replay([...prefix.moves, ...result.moves]);
    if (checked && changed(checked.robots) >= 2) return { start, detour: prefix.moves, solution: checked.moves, final: checked.robots };
  }
  throw new Error(`No bounded multi-robot browser route: ${room.puzzle.id}/${target.id}`);
}

export async function expectRobots(pages: readonly Page[], robots: RobotPositions) {
  for (const page of pages) for (const id of ROBOT_IDS) {
    await expect(page.locator(`.game-board__robot--${id}`)).toHaveAttribute('transform',
      `translate(${robots[id].column + 0.5} ${robots[id].row + 0.5})`);
  }
}

export async function clickMove(page: Page, move: SolverMove) {
  await page.getByRole('button', { name: `Select ${move.robotId} robot`, exact: true }).click();
  const direction = page.getByRole('button', { name: `Move selected robot ${move.direction}`, exact: true });
  await expect(direction).toBeEnabled(); await direction.click();
  // Wait for authoritative acknowledgment, including no-ops, before another tap.
  await expect(page.getByRole('button', { name: 'Give up', exact: true })).toBeEnabled();
}

export async function placeBid(page: Page, value: number) {
  await page.getByRole('textbox', { name: 'YOUR BID', exact: true }).fill(String(value));
  await page.getByRole('button', { name: 'Place Bid', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: `Your accepted bid: ${value} moves.` })).toBeVisible();
}
