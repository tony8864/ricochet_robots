import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test } from 'vitest';
import type {
  RobotPositions,
  TargetSymbol as SymbolName,
} from '@robot-puzzle/game-engine';
import { starterBoard } from '@robot-puzzle/puzzles';
import { DEMO_GAME_STATE, DEMO_TARGETS } from '../fixtures/demoGameState';
import { BoardSvg } from './BoardSvg';
import { TargetSymbol } from './TargetSymbol';

function renderBoard(
  activeTargetId: string = DEMO_GAME_STATE.target.id,
  robots: RobotPositions = DEMO_GAME_STATE.robots,
) {
  return renderToStaticMarkup(
    <BoardSvg
      activeTargetId={activeTargetId}
      board={DEMO_GAME_STATE.board}
      robots={robots}
      selectedRobot="blue"
      targets={DEMO_TARGETS}
    />,
  );
}

describe('board target rendering', () => {
  test('renders every target and exactly one soft-fill hook for the active target', () => {
    const markup = renderBoard();
    expect(markup.match(/data-target-id=/g)).toHaveLength(17);
    expect(markup.match(/class="game-board__target-highlight"/g)).toHaveLength(1);
    expect(markup).toContain('game-board__target--blue game-board__target--active');
    const { row, column } = DEMO_GAME_STATE.target.position;
    expect(markup).toContain(`Active blue star target at row ${row + 1}, column ${column + 1}`);
    for (const target of DEMO_TARGETS) {
      expect(markup).toContain(`data-target-id="${target.id}"`);
    }
  });

  test('changes the active marker without removing other targets', () => {
    const markup = renderBoard('wildcard-vortex');
    expect(markup.match(/data-target-id=/g)).toHaveLength(17);
    expect(markup.match(/class="game-board__target-highlight"/g)).toHaveLength(1);
    expect(markup).toContain('game-board__target--wildcard game-board__target--active');
    const vortex = DEMO_TARGETS.find(({ id }) => id === 'wildcard-vortex')!;
    expect(markup).toContain(
      `Active wildcard vortex target at row ${vortex.position.row + 1}, column ${vortex.position.column + 1}`,
    );
  });

  test('fills the active cell behind its symbol and robots without covering walls', () => {
    const markup = renderBoard(DEMO_GAME_STATE.target.id, {
      ...DEMO_GAME_STATE.robots,
      blue: DEMO_GAME_STATE.target.position,
    });
    expect(markup.indexOf('class="game-board__targets"')).toBeLessThan(
      markup.indexOf('class="game-board__robots"'),
    );
    expect(markup).toContain('class="game-board__target-highlight" height="1" width="1" x="-0.5" y="-0.5"');
    const activeGroup = markup.slice(markup.indexOf('data-target-id="' + DEMO_GAME_STATE.target.id + '"'));
    expect(activeGroup.indexOf('game-board__target-highlight')).toBeLessThan(activeGroup.indexOf('class="target-symbol"'));
    expect(markup.indexOf('game-board__target-highlight')).toBeLessThan(markup.indexOf('class="game-board__walls"'));
    expect(markup).not.toContain('game-board__target-outline');
    expect(markup).toContain('class="game-board__robot-piece" r="0.34"');
    expect(markup.match(/data-target-id=/g)).toHaveLength(17);
  });
});

test('the five symbols use distinct SVG artwork without external images', () => {
  const symbols: readonly SymbolName[] = [
    'star', 'crescent', 'triangle', 'square', 'vortex',
  ];
  const artwork = symbols.map((symbol) => {
    const markup = renderToStaticMarkup(<TargetSymbol symbol={symbol} />);
    expect(markup).toContain('viewBox="0 0 100 100"');
    expect(markup).not.toContain('<image');
    return markup.slice(markup.indexOf('>') + 1, markup.lastIndexOf('</svg>'));
  });
  expect(new Set(artwork).size).toBe(5);
});

test('the catalog starter board renders its full wall and target layout', () => {
  const markup = renderToStaticMarkup(
    <BoardSvg
      activeTargetId={starterBoard.targets[0]!.id}
      board={starterBoard.board}
      robots={starterBoard.initialRobots}
      targets={starterBoard.targets}
    />,
  );
  expect(markup.match(/data-target-id=/g)).toHaveLength(17);
  expect(markup.match(/<line vector-effect="non-scaling-stroke"/g))
    .toHaveLength(starterBoard.board.walls.length + 30);
  expect(markup).toContain('data-target-id="red-star"');
  expect(markup).toContain('Active red star target at row 4, column 13');
});

test('outer boundary follows the true grid edges while corner robots keep their cell centers', () => {
  const robots: RobotPositions = {
    red: { row: 0, column: 0 }, blue: { row: 0, column: 15 },
    green: { row: 15, column: 0 }, yellow: { row: 15, column: 15 },
  };
  const markup = renderBoard(undefined, robots);
  const boundary = markup.match(/<rect[^>]*class="game-board__boundary"[^>]*>/)?.[0];
  expect(boundary).toBeDefined();
  for (const attribute of ['height="16"', 'width="16"', 'x="0"', 'y="0"']) {
    expect(boundary).toContain(attribute);
  }
  for (const [id, position] of Object.entries(robots)) {
    const robot = markup.match(new RegExp(`<g class="game-board__robot game-board__robot--${id}[^\"]*"[^>]*>`))?.[0];
    expect(robot).toContain(`transform="translate(${position.column + 0.5} ${position.row + 0.5})"`);
  }
});
