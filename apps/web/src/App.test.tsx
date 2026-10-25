import { StrictMode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test, vi } from 'vitest';
import * as matchApi from '@robot-puzzle/match';
import { starterBoard } from '@robot-puzzle/puzzles';
import { App } from './App';
import { createLocalMatchController, type LocalMatchController } from './local/controller';
import { createDevelopmentController } from './local/developmentScenario';
import { LOCAL_PLAYERS } from './local/config';

const render = (controller: LocalMatchController) => renderToStaticMarkup(<StrictMode><App controller={controller} /></StrictMode>);

test('active player sees reused controls, all targets, ring, and development-only player selector', () => {
  const markup = render(createDevelopmentController());
  expect(markup).toContain('Local simulation');
  expect(markup).toContain('Act as');
  expect(markup).toContain('Maria (Host)');
  expect(markup).toContain('Your turn');
  expect(markup).toContain('aria-label="Demonstration controls"');
  expect(markup).toContain('game-board__robot--selected');
  expect(markup).toContain('aria-label="Move selected robot down"');
  expect(markup.match(/data-target-id=/g)).toHaveLength(17);
});

test('watcher and inactive host see identical robot positions but no interactive selection or move controls', () => {
  const controller = createDevelopmentController();
  controller.actAs('alex');
  const watch = render(controller);
  expect(watch).toContain('Watching Maria');
  expect(watch).not.toContain('aria-label="Demonstration controls"');
  expect(watch).not.toContain('game-board__robot--interactive');
  expect(watch).not.toContain('game-board__robot--selected');
  controller.actAs('maria');
  controller.sendPlayer({ type: 'attempt.giveUp' });
  const host = render(controller);
  expect(host).toContain('Watching Alex');
  expect(host).not.toContain('aria-label="Movement controls"');
  controller.actAs('alex');
  expect(render(controller)).toContain('aria-label="Movement controls"');
});

test('preparing/thinking/bidding contain no simulation controls and Preparing has no active target', () => {
  const initial = matchApi.createMatch({ matchId: 'phases', players: LOCAL_PLAYERS, puzzle: starterBoard });
  const controller = createLocalMatchController({ match: initial, hostSeatId: 'maria', actingSeatId: 'maria', now: () => 1_000 });
  const markup = render(controller);
  expect(markup).toContain('Round preparation: not-attempted');
  expect(markup).not.toContain('class="game-board__target-highlight"');
  expect(markup).not.toContain('aria-label="Robot selection"');
  const options = { candidateOrder: starterBoard.targets.map((target) => target.id), budget: { perCandidate: { maxExpandedStates: 50_000, maxStoredStates: 150_000 }, maxTotalExpandedStates: 200_000 } };
  const prepared = matchApi.prepareMatchRound(initial, options).state;
  const next = createLocalMatchController({ match: prepared, hostSeatId: 'maria', actingSeatId: 'maria', now: () => 1_000 });
  for (const phase of ['thinking', 'bidding']) {
    expect(next.getSnapshot().match.phase).toBe(phase);
    expect(render(next)).not.toContain('aria-label="Movement controls"');
    expect(render(next)).not.toContain('game-board__robot--interactive');
    expect(render(next)).toContain('demo-layout--bidding');
    expect(render(next)).toContain('>YOUR BID</label>');
    expect(render(next)).toContain('>Place Bid</button>');
    if (phase === 'thinking') expect(render(next)).not.toContain('role="timer"');
    else {
      const markup = render(next);
      expect(markup).toContain('role="timer"');
      expect(markup.indexOf('class="bidding-countdown"')).toBeLessThan(markup.indexOf('class="bid-card"'));
      expect(markup.match(/class="bidding-countdown"/g)).toHaveLength(1);
      expect(markup.indexOf('class="bidding-countdown"')).toBeLessThan(markup.indexOf('</header>'));
      expect(markup).not.toContain('>Skip Round</button>');
    }
    if (phase === 'thinking') next.sendPlayer({ type: 'bid.submit', value: 3 });
  }
});

test('bid card sits after the board and viewing/changing player does not send a bid', () => {
  const initial = matchApi.createMatch({ matchId: 'visual-bid', players: LOCAL_PLAYERS, puzzle: starterBoard });
  const prepared = matchApi.prepareMatchRound(initial, {
    candidateOrder: starterBoard.targets.map((target) => target.id),
    budget: { perCandidate: { maxExpandedStates: 50_000, maxStoredStates: 150_000 }, maxTotalExpandedStates: 200_000 },
  }).state;
  const controller = createLocalMatchController({ match: prepared, hostSeatId: 'maria', actingSeatId: 'maria', now: () => 1_000 });
  const send = vi.spyOn(controller, 'sendPlayer');
  for (const actor of ['maria', 'alex', 'maria']) {
    controller.actAs(actor);
    const markup = render(controller);
    expect(markup.indexOf('class="bid-card"')).toBeGreaterThan(markup.indexOf('</svg>'));
    expect(markup.indexOf('class="player-bids"')).toBeGreaterThan(markup.indexOf('class="bid-card"'));
    expect(markup.match(/>—<\/span>/g)).toHaveLength(3);
    expect(markup).toContain('value="1"');
    expect(markup.match(/data-target-id=/g)).toHaveLength(17);
    expect(controller.getSnapshot().match).toBe(prepared);
  }
  expect(send).not.toHaveBeenCalled();
});

test('players panel follows accepted model bids/reductions while card reflects the acting seat accepted value', () => {
  const initial = matchApi.createMatch({ matchId: 'accepted-bids', players: LOCAL_PLAYERS, puzzle: starterBoard });
  const prepared = matchApi.prepareMatchRound(initial, {
    candidateOrder: starterBoard.targets.map((target) => target.id),
    budget: { perCandidate: { maxExpandedStates: 50_000, maxStoredStates: 150_000 }, maxTotalExpandedStates: 200_000 },
  }).state;
  const controller = createLocalMatchController({ match: prepared, hostSeatId: 'maria', actingSeatId: 'maria', now: () => 1_000 });
  controller.sendPlayer({ type: 'bid.submit', value: 7 });
  controller.actAs('alex');
  controller.sendPlayer({ type: 'bid.submit', value: 4 });
  const rows = (markup: string) => [...markup.matchAll(/<li\b[^>]*>.*?<\/li>/g)].map(([row]) => row);
  const first = rows(render(controller));
  expect(first[0]).toContain('Alex');
  expect(first[0]).toContain('4 moves');
  controller.actAs('maria');
  controller.sendPlayer({ type: 'bid.submit', value: 3 });
  const markup = render(controller);
  const next = rows(markup);
  expect(next[0]).toContain('Maria');
  expect(next[0]).toContain('3 moves');
  expect(next[1]).toContain('Alex');
  expect(next[2]).toContain('>—</span>');
  expect(markup).toMatch(/<button[^>]*class="bid-card__submit"[^>]*disabled=""/);
  expect(markup).toContain('Your accepted bid: 3 moves.');
  controller.actAs('teo');
  const newPlayer = render(controller);
  expect(newPlayer).toContain('value="1"');
  expect(newPlayer).not.toMatch(/<button[^>]*class="bid-card__submit"[^>]*disabled=""/);
  expect(markup).not.toContain('Movement controls');
});

test('results replace attempt controls instead of preserving a local given-up flag or writable attempt', () => {
  const controller = createDevelopmentController();
  controller.sendPlayer({ type: 'attempt.giveUp' });
  controller.actAs('alex');
  controller.sendPlayer({ type: 'attempt.giveUp' });
  const markup = render(controller);
  expect(markup).toContain('Nobody solved this round.');
  expect(markup).toContain('inert=""');
  expect(markup).toContain('Waiting for Maria to continue.');
  expect(markup.match(/Act as/g)).toHaveLength(1);
  expect(markup.indexOf('Act as')).toBeGreaterThan(markup.indexOf('<dialog'));
  expect(markup).not.toContain('aria-label="Demonstration controls"');
  expect(markup).not.toContain('game-board__robot--interactive');
});

test('rendering or subscribing repeatedly never runs target preparation or resets the starter', () => {
  const spy = vi.spyOn(matchApi, 'prepareMatchRound');
  try {
    const controller = createDevelopmentController();
    const state = controller.getSnapshot().match;
    render(controller);
    render(controller);
    controller.subscribe(() => {})();
    expect(controller.getSnapshot().match).toBe(state);
    expect(spy).toHaveBeenCalledOnce();
  } finally {
    spy.mockRestore();
  }
});
