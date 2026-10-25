import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test, vi } from 'vitest';
import * as matchApi from '@robot-puzzle/match';
import { puzzleCatalog, starterBoard, type PuzzleBoard } from '@robot-puzzle/puzzles';
import { App } from '../App';
import { LOCAL_PLAYERS } from './config';
import { createLocalMatchController } from './controller';
import { createLobbyMatchStarter, localRoundOptions } from './startLobbyMatch';
import { shufflePreviewBoard } from './shufflePreviewBoard';

function starter() {
  const jobs: (() => void)[] = [];
  const session = createLobbyMatchStarter({
    players: LOCAL_PLAYERS, hostSeatId: 'maria', now: () => 1_000,
    schedulePreparation: (work) => { jobs.push(work); },
  });
  return { session, jobs };
}

test.each(puzzleCatalog.map((puzzle) => [puzzle.id, puzzle] as const))('%s starts a real verified first round from the exact previewed board', (_, puzzle) => {
  const { session, jobs } = starter();
  const controller = session.start(puzzle, 'maria')!;
  const preparing = controller.getSnapshot();
  expect(preparing.match.phase).toBe('preparing');
  expect(preparing.preparationPending).toBe(true);
  expect(preparing.match.puzzle.id).toBe(puzzle.id);
  expect(preparing.match.usedTargetIds).toEqual([]);
  const loading = renderToStaticMarkup(<App controller={controller} />);
  expect(loading).toContain('Preparing the next target');
  expect(loading).not.toContain('game-board__target--active');
  expect(loading).not.toContain('Shuffle Board');
  expect(loading).not.toContain('Start Match');
  expect(jobs).toHaveLength(1);
  jobs.shift()!();
  const snapshot = controller.getSnapshot();
  const state = snapshot.match;
  expect(snapshot.preparationPending).toBe(false);
  expect(snapshot.preparationError).toBeNull();
  if (state.phase !== 'thinking') throw new Error('Expected verified Thinking state.');
  expect(state.puzzle).toBe(preparing.match.puzzle);
  expect(state.round.number).toBe(1);
  expect(state.completedRounds).toBe(0);
  expect(state.usedTargetIds).toEqual([state.round.target.id]);
  expect(state.round.startRobots).toEqual(puzzle.initialRobots);
  expect(state.officialRobots).toEqual(puzzle.initialRobots);
  expect(state.scores).toEqual({ maria: 0, alex: 0, teo: 0 });
  expect(state).not.toHaveProperty('bids');
  expect(JSON.stringify(snapshot)).not.toContain('internalProof');
  const thinking = renderToStaticMarkup(<App controller={controller} />);
  expect(thinking).toContain('<h1>Thinking</h1>');
  expect(thinking.match(/class="game-board__target-highlight"/g)).toHaveLength(1);
  expect(thinking).not.toContain('game-board__robot--interactive');
  expect(thinking).not.toContain('Movement controls');
  expect(thinking).not.toContain('Shuffle Board');
});

test('non-host start does nothing; repeated start creates one match/search and locks the shuffled board', () => {
  const create = vi.spyOn(matchApi, 'createMatch');
  const prepare = vi.spyOn(matchApi, 'prepareMatchRound');
  try {
    const { session, jobs } = starter();
    const preview = shufflePreviewBoard(starterBoard, 'maria', 'maria', () => 0);
    expect(session.start(preview, 'alex')).toBeNull();
    expect(create).not.toHaveBeenCalled();
    const controller = session.start(preview, 'maria')!;
    expect(session.start(starterBoard, 'maria')).toBeNull();
    expect(create).toHaveBeenCalledOnce();
    expect(prepare).not.toHaveBeenCalled();
    jobs.shift()!();
    expect(prepare).toHaveBeenCalledOnce();
    expect(session.start(starterBoard, 'maria')).toBeNull();
    expect(create).toHaveBeenCalledOnce();
    expect(controller.getSnapshot().match.puzzle.id).toBe(preview.id);
    controller.actAs('alex');
    expect(controller.getSnapshot().hostSeatId).toBe('maria');
    expect(controller.getSnapshot().match.puzzle.id).toBe(preview.id);
  } finally {
    create.mockRestore();
    prepare.mockRestore();
  }
});

function unprepared() {
  const jobs: (() => void)[] = [];
  const initial = matchApi.createMatch({ matchId: 'retry', players: LOCAL_PLAYERS, puzzle: starterBoard });
  const controller = createLocalMatchController({
    match: initial, actingSeatId: 'maria', hostSeatId: 'maria', now: () => 1_000,
    schedulePreparation: (work) => { jobs.push(work); },
  });
  return { controller, initial, jobs };
}

test('deferred preparation preserves everything; only an explicit host retry may reveal a target', () => {
  const { controller, initial, jobs } = unprepared();
  const normal = localRoundOptions(starterBoard);
  controller.actAs('alex');
  expect(controller.prepareRound(normal)).toBe(false);
  expect(jobs).toHaveLength(0);
  controller.actAs('maria');
  expect(controller.prepareRound({ ...normal, budget: { ...normal.budget, maxTotalExpandedStates: 0 } })).toBe(true);
  expect(controller.prepareRound(normal)).toBe(false);
  expect(jobs).toHaveLength(1);
  jobs.shift()!();
  const failed = controller.getSnapshot().match;
  expect(failed).toMatchObject({ phase: 'preparing', preparation: { status: 'deferred' }, completedRounds: 0, usedTargetIds: [] });
  expect(failed.officialRobots).toBe(initial.officialRobots);
  expect(failed.scores).toBe(initial.scores);
  expect(jobs).toHaveLength(0); // No background recovery loop.
  const failureView = renderToStaticMarkup(<App controller={controller} />);
  expect(failureView).toContain('within the search limit');
  expect(failureView).toContain('Retry preparation');
  expect(failureView).not.toContain('game-board__target--active');
  controller.actAs('alex');
  expect(renderToStaticMarkup(<App controller={controller} />)).not.toContain('>Retry preparation</button>');
  expect(controller.prepareRound(normal)).toBe(false);
  controller.actAs('maria');
  expect(controller.prepareRound(normal)).toBe(true);
  jobs.shift()!();
  expect(controller.getSnapshot().match.phase).toBe('thinking');
  expect(controller.getSnapshot().match.usedTargetIds).toHaveLength(1);
  expect(controller.getSnapshot().match.completedRounds).toBe(0);
  expect(controller.prepareRound(normal)).toBe(false); // No preparation after reveal.
});

test('unexpected preparation errors keep the match unrevealed and allow a clean bounded retry', () => {
  const { controller, initial, jobs } = unprepared();
  const normal = localRoundOptions(starterBoard);
  controller.prepareRound({ ...normal, candidateOrder: [] });
  jobs.shift()!();
  expect(controller.getSnapshot().match).toBe(initial);
  expect(controller.getSnapshot().preparationPending).toBe(false);
  expect(controller.getSnapshot().preparationError).toContain('Please retry');
  expect(renderToStaticMarkup(<App controller={controller} />)).toContain('Please retry');
  controller.prepareRound(normal);
  jobs.shift()!();
  expect(controller.getSnapshot().match.phase).toBe('thinking');
  expect(controller.getSnapshot().preparationError).toBeNull();
});

test('actual exhaustive unavailability remains Preparing without board substitution or automatic retries', () => {
  const trapped: PuzzleBoard = {
    ...starterBoard,
    board: { ...starterBoard.board, walls: [
      ...starterBoard.board.walls,
      { first: { row: 0, column: 0 }, second: { row: 0, column: 1 } },
      { first: { row: 0, column: 0 }, second: { row: 1, column: 0 } },
      { first: { row: 0, column: 14 }, second: { row: 0, column: 15 } },
      { first: { row: 0, column: 15 }, second: { row: 1, column: 15 } },
      { first: { row: 14, column: 0 }, second: { row: 15, column: 0 } },
      { first: { row: 15, column: 0 }, second: { row: 15, column: 1 } },
      { first: { row: 14, column: 15 }, second: { row: 15, column: 15 } },
      { first: { row: 15, column: 14 }, second: { row: 15, column: 15 } },
    ] },
  };
  const { session, jobs } = starter();
  const controller = session.start(trapped, 'maria')!;
  const initial = controller.getSnapshot().match;
  jobs.shift()!();
  expect(controller.getSnapshot().match).toMatchObject({
    phase: 'preparing', preparation: { status: 'unavailable' }, usedTargetIds: [], completedRounds: 0,
  });
  expect(controller.getSnapshot().match.puzzle).toBe(initial.puzzle);
  expect(controller.getSnapshot().match.officialRobots).toBe(initial.officialRobots);
  expect(controller.getSnapshot().match.scores).toBe(initial.scores);
  expect(renderToStaticMarkup(<App controller={controller} />)).toContain('No verified target is available');
  expect(session.start(starterBoard, 'maria')).toBeNull();
  expect(jobs).toHaveLength(0);
});

test('changing acting seat while work is pending never loses the result or gives host authority', () => {
  const { session, jobs } = starter();
  const controller = session.start(starterBoard, 'maria')!;
  controller.actAs('alex');
  jobs.shift()!();
  expect(controller.getSnapshot().actingSeatId).toBe('alex');
  expect(controller.getSnapshot().hostSeatId).toBe('maria');
  expect(controller.getSnapshot().match.phase).toBe('thinking');
  expect(controller.sendPlayer({ type: 'attempt.move', robotId: 'red', direction: 'right' })).toEqual({ status: 'rejected', reason: 'wrong-phase' });
});

test('default browser scheduling exposes Preparing before searching and schedules exactly once', () => {
  vi.useFakeTimers();
  try {
    const session = createLobbyMatchStarter({ players: LOCAL_PLAYERS, hostSeatId: 'maria', now: () => 1_000 });
    const controller = session.start(starterBoard, 'maria')!;
    expect(controller.getSnapshot().preparationPending).toBe(true);
    expect(controller.getSnapshot().match.phase).toBe('preparing');
    expect(vi.getTimerCount()).toBe(1);
    expect(session.start(starterBoard, 'maria')).toBeNull();
    vi.runAllTimers();
    expect(controller.getSnapshot().match.phase).toBe('thinking');
    expect(controller.getSnapshot().preparationPending).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    vi.useRealTimers();
  }
});

test('scheduler failure unlocks explicit retry without recreating the match', () => {
  const initial = matchApi.createMatch({ matchId: 'schedule-failure', players: LOCAL_PLAYERS, puzzle: starterBoard });
  const controller = createLocalMatchController({
    match: initial, actingSeatId: 'maria', hostSeatId: 'maria', now: () => 1_000,
    schedulePreparation: () => { throw new Error('Unavailable scheduler'); },
  });
  expect(controller.prepareRound(localRoundOptions(starterBoard))).toBe(true);
  expect(controller.getSnapshot().preparationPending).toBe(false);
  expect(controller.getSnapshot().preparationError).toContain('Please retry');
  expect(controller.getSnapshot().match).toBe(initial);
});
