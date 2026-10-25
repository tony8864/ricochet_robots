import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test } from 'vitest';
import { createMatch, prepareMatchRound, MATCH_ROUND_COUNT } from '@robot-puzzle/match';
import { starterBoard } from '@robot-puzzle/puzzles';
import { prepareNextRound } from '@robot-puzzle/puzzles/round-setup';
import { App } from '../App';
import { LOCAL_PLAYERS } from './config';
import { createLocalMatchController } from './controller';
import { createDevelopmentController } from './developmentScenario';
import { localRoundOptions } from './startLobbyMatch';

function fixture(schedule?: (work: () => void) => void) {
  const initial = createMatch({ matchId: 'continue-test', players: LOCAL_PLAYERS, puzzle: starterBoard });
  return createLocalMatchController({
    match: prepareMatchRound(initial, localRoundOptions(starterBoard)).state,
    actingSeatId: 'maria', hostSeatId: 'maria', now: () => 1_000, schedulePreparation: schedule,
  });
}

test('only current host can continue; duplicate/stale requests cannot prepare or advance twice', () => {
  const jobs: (() => void)[] = [];
  const controller = fixture((work) => jobs.push(work));
  const options = localRoundOptions(starterBoard);
  expect(controller.continueRound(controller.getSnapshot().match, options)).toBe(false);
  controller.sendPlayer({ type: 'round.skip', confirmed: true });
  const result = controller.getSnapshot().match;
  controller.actAs('alex');
  expect(controller.continueRound(result, options)).toBe(false);
  expect(controller.getSnapshot().match).toBe(result);
  controller.actAs('maria');
  expect(controller.continueRound(result, options)).toBe(true);
  expect(controller.continueRound(result, options)).toBe(false);
  expect(jobs).toHaveLength(1);
  expect(controller.getSnapshot()).toMatchObject({ preparationPending: true, match: { phase: 'preparing', completedRounds: 1 } });
  jobs.shift()!();
  expect(controller.getSnapshot().match).toMatchObject({ phase: 'thinking', round: { number: 2 }, scores: result.scores, officialRobots: result.officialRobots });
  controller.sendPlayer({ type: 'round.skip', confirmed: true });
  expect(controller.continueRound(result, options)).toBe(false);
  expect(jobs).toHaveLength(0);
});

test('successful positions and points carry through Continue without another award', () => {
  const development = createDevelopmentController();
  const initial = development.getSnapshot().match;
  if (initial.phase !== 'demonstrating') throw new Error('Expected demonstration.');
  const proof = prepareNextRound({
    ...localRoundOptions(initial.puzzle),
    candidateOrder: [initial.round.target.id, ...initial.puzzle.targets.map((target) => target.id).filter((id) => id !== initial.round.target.id)],
    puzzle: initial.puzzle, robots: initial.officialRobots, usedTargetIds: [],
  });
  if (proof.status !== 'selected') throw new Error('Expected verified solution.');
  for (const step of proof.internalProof) development.sendPlayer({ type: 'attempt.move', ...step });
  const result = development.getSnapshot().match;
  expect(result).toMatchObject({ phase: 'round-result', scores: { maria: 1 } });
  const controller = createLocalMatchController({ match: result, hostSeatId: 'maria', actingSeatId: 'maria', now: () => 1_000, schedulePreparation: (work) => work() });
  expect(controller.continueRound(result, localRoundOptions(result.puzzle))).toBe(true);
  expect(controller.getSnapshot().match).toMatchObject({ phase: 'thinking', round: { number: 2, startRobots: result.officialRobots }, scores: result.scores, officialRobots: result.officialRobots });
});

test('preparation failures replace the result modal and permit explicit retry only', () => {
  const controller = fixture(() => { throw new Error('Scheduling unavailable'); });
  controller.sendPlayer({ type: 'round.skip', confirmed: true });
  const result = controller.getSnapshot().match;
  expect(controller.continueRound(result, localRoundOptions(starterBoard))).toBe(true);
  expect(controller.getSnapshot()).toMatchObject({ preparationPending: false, preparationError: expect.any(String), match: { phase: 'preparing' } });
  const markup = renderToStaticMarkup(<App controller={controller} />);
  expect(markup).not.toContain('<dialog');
  expect(markup).toContain('Target preparation could not complete. Please retry.');
  expect(controller.getSnapshot().match.officialRobots).toBe(result.officialRobots);
  expect(controller.getSnapshot().match.usedTargetIds).toBe(result.usedTargetIds);
});

test('the configured final round reaches Finished without preparing another round after View Results', () => {
  const jobs: (() => void)[] = [];
  const controller = fixture((work) => jobs.push(work));
  for (let number = 1; number <= MATCH_ROUND_COUNT; number++) {
    expect(controller.getSnapshot().match).toMatchObject({ phase: 'thinking', round: { number } });
    controller.sendPlayer({ type: 'round.skip', confirmed: true });
    const result = controller.getSnapshot().match;
    expect(controller.continueRound(result, localRoundOptions(starterBoard))).toBe(true);
    if (number < MATCH_ROUND_COUNT) {
      expect(jobs).toHaveLength(1);
      jobs.shift()!();
    } else {
      expect(jobs).toHaveLength(0);
      expect(controller.getSnapshot().match).toMatchObject({ phase: 'finished', completedRounds: MATCH_ROUND_COUNT, scores: { maria: 0, alex: 0, teo: 0 } });
      expect(controller.getSnapshot().match.usedTargetIds).toHaveLength(MATCH_ROUND_COUNT);
      expect(controller.continueRound(result, localRoundOptions(starterBoard))).toBe(false);
    }
  }
});
