import { expect, test } from 'vitest';
import { MATCH_ROUND_COUNT } from '@robot-puzzle/match';
import { starterBoard } from '@robot-puzzle/puzzles';
import { LOCAL_PLAYERS } from './config';
import { createLobbyMatchStarter, localRoundOptions } from './startLobbyMatch';
import type { LocalMatchController } from './controller';
import { shufflePreviewBoard } from './shufflePreviewBoard';

function setup() {
  const jobs: (() => void)[] = [];
  const session = createLobbyMatchStarter({ players: LOCAL_PLAYERS, hostSeatId: 'maria', now: () => 1_000, schedulePreparation: (work) => jobs.push(work) });
  const controller = session.start(starterBoard, 'maria')!;
  jobs.shift()!();
  return { session, controller, jobs };
}
function finish(controller: LocalMatchController, jobs: (() => void)[]) {
  for (let number = 1; number <= MATCH_ROUND_COUNT; number++) {
    controller.sendPlayer({ type: 'round.skip', confirmed: true });
    const result = controller.getSnapshot().match;
    expect(controller.continueRound(result, localRoundOptions(result.puzzle))).toBe(true);
    if (number < MATCH_ROUND_COUNT) jobs.shift()!();
  }
  expect(controller.getSnapshot().match.phase).toBe('finished');
}

test('return to lobby requires finished current match and current host, and is idempotent', () => {
  const { session, controller, jobs } = setup();
  expect(session.returnToLobby(controller)).toBe(false);
  finish(controller, jobs);
  const finished = controller.getSnapshot().match;
  controller.actAs('alex');
  expect(session.returnToLobby(controller)).toBe(false);
  expect(session.start(starterBoard, 'maria')).toBeNull();
  controller.actAs('maria');
  expect(session.returnToLobby(controller)).toBe(true);
  expect(session.returnToLobby(controller)).toBe(false);
  expect(jobs).toHaveLength(0); // Return does not start a match or search.
  expect(controller.getSnapshot().match).toBe(finished);
});

test('new lobby allows shuffle before fresh explicit start, preserving roster/host and resetting match data', () => {
  const { session, controller, jobs } = setup();
  finish(controller, jobs);
  const previous = controller.getSnapshot().match;
  expect(session.returnToLobby(controller)).toBe(true);
  const shuffled = shufflePreviewBoard(previous.puzzle, 'maria', 'maria', () => 0);
  expect(shuffled.id).not.toBe(previous.puzzle.id);
  expect(session.start(shuffled, 'alex')).toBeNull();
  const next = session.start(shuffled, 'maria')!;
  expect(next).not.toBe(controller);
  expect(next.getSnapshot()).toMatchObject({ hostSeatId: 'maria', actingSeatId: 'maria', match: {
    phase: 'preparing', players: previous.players, scores: { maria: 0, alex: 0, teo: 0 },
    completedRounds: 0, usedTargetIds: [], officialRobots: shuffled.initialRobots,
  } });
  expect(next.getSnapshot().match.matchId).not.toBe(previous.matchId);
  expect(next.getSnapshot().match.puzzle.id).toBe(shuffled.id);
  expect(session.returnToLobby(controller)).toBe(false); // Stale old results cannot unlock a new match.
  expect(session.start(starterBoard, 'maria')).toBeNull();
  jobs.shift()!();
  expect(next.getSnapshot().match).toMatchObject({ phase: 'thinking', round: { number: 1 } });
});
