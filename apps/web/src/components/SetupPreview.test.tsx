import { StrictMode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test, vi } from 'vitest';
import * as matchApi from '@robot-puzzle/match';
import { ROBOT_IDS } from '@robot-puzzle/game-engine';
import { getPuzzleBoard, starterBoard } from '@robot-puzzle/puzzles';
import { DEMO_BOARD_ID, LOCAL_HOST_SEAT_ID, LOCAL_PLAYERS } from '../local/config';
import { SetupPreview } from './SetupPreview';
import { LocalPlayerSwitcher } from './LocalPlayerSwitcher';

test('initial setup shows the configured board name, all targets, and all catalog robot starts', () => {
  const puzzle = getPuzzleBoard(DEMO_BOARD_ID)!;
  const markup = renderToStaticMarkup(<SetupPreview />);
  expect(markup).toContain('<h1>Match setup</h1>');
  expect(markup).toContain(puzzle.name);
  expect(markup.match(/data-target-id=/g)).toHaveLength(17);
  for (const id of ROBOT_IDS) {
    const { row, column } = puzzle.initialRobots[id];
    expect(markup).toContain(`${id} robot at row ${row + 1}, column ${column + 1}`);
  }
  expect(markup).toContain('viewBox="0 0 16 16"');
});

test('preview remains read-only, with no selected robot, active target, or match controls', () => {
  const markup = renderToStaticMarkup(<SetupPreview />);
  for (const absent of [
    'game-board__robot--interactive', 'game-board__robot--selected',
    'game-board__target--active', 'class="game-board__target-highlight"',
    'Demonstration controls', 'Movement controls', 'Robot selection',
    'Waiting for',
  ]) expect(markup).not.toContain(absent);
  expect(markup).toContain('No active target.');
  expect(markup.indexOf('class="lobby-actions"')).toBeGreaterThan(markup.indexOf('class="lobby-roster"'));
  expect(markup).toContain('Shuffle Board');
  expect(markup).toContain('Start Match');
});

test('player switcher precedes the heading and board, with the roster below the board', () => {
  const markup = renderToStaticMarkup(<SetupPreview />);
  expect(markup.indexOf('Local development tools')).toBeLessThan(markup.indexOf('<h1>Match setup'));
  expect(markup.indexOf('<h1>Match setup')).toBeLessThan(markup.indexOf('<svg'));
  expect(markup).toContain('Act as');
  expect(markup).toContain('value="maria" selected="">Maria (Host)');
  expect(markup.indexOf('</svg>')).toBeLessThan(markup.indexOf('class="lobby-roster"'));
  expect(markup).toContain('aria-label="3 of 6 players"');
  expect(markup).toContain('lobby-roster__row--current');
});

test('switcher represents another acting seat without changing who is host', () => {
  const markup = renderToStaticMarkup(<LocalPlayerSwitcher
    players={LOCAL_PLAYERS} hostSeatId={LOCAL_HOST_SEAT_ID} actingSeatId="alex" onActAs={() => {}}
  />);
  expect(markup).toContain('value="alex" selected="">Alex');
  expect(markup).toContain('Maria (Host)');
  expect(markup).not.toContain('Alex (Host)');
});

test('repeated preview rendering never creates/prepares a match or mutates the board', () => {
  const createSpy = vi.spyOn(matchApi, 'createMatch');
  const prepareSpy = vi.spyOn(matchApi, 'prepareMatchRound');
  const before = JSON.stringify(starterBoard);
  try {
    const render = () => renderToStaticMarkup(<StrictMode><SetupPreview puzzle={starterBoard} /></StrictMode>);
    expect(render()).toEqual(render());
    expect(createSpy).not.toHaveBeenCalled();
    expect(prepareSpy).not.toHaveBeenCalled();
    expect(JSON.stringify(starterBoard)).toBe(before);
  } finally {
    createSpy.mockRestore();
    prepareSpy.mockRestore();
  }
});
