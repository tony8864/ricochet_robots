import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test, vi } from 'vitest';
import { createMatch, prepareMatchRound } from '@robot-puzzle/match';
import { starterBoard } from '@robot-puzzle/puzzles';
import { App } from '../App';
import { LOCAL_PLAYERS } from './config';
import { createLocalMatchController } from './controller';
import { localRoundOptions } from './startLobbyMatch';
import { confirmRoundSkip } from './confirmRoundSkip';

function ready() {
  const initial = createMatch({ matchId: 'skip-ui', players: LOCAL_PLAYERS, puzzle: starterBoard });
  const state = prepareMatchRound(initial, localRoundOptions(starterBoard)).state;
  if (state.phase !== 'thinking') throw new Error('Expected verified round.');
  return createLocalMatchController({ match: state, actingSeatId: 'maria', hostSeatId: 'maria', now: () => 1_000 });
}

test('Skip Round is above the board in the header, only for the host in Thinking', () => {
  const controller = ready();
  const markup = renderToStaticMarkup(<App controller={controller} />);
  const header = markup.match(/<header\b[^>]*>.*?<\/header>/)![0];
  expect(header).toContain('>Skip Round</button>');
  expect(markup.indexOf('class="skip-round"')).toBeLessThan(markup.indexOf('<svg'));
  expect(header).not.toContain('role="timer"');
  controller.actAs('alex');
  expect(renderToStaticMarkup(<App controller={controller} />)).not.toContain('>Skip Round</button>');
  controller.actAs('maria');
  controller.sendPlayer({ type: 'bid.submit', value: 5 });
  const bidding = renderToStaticMarkup(<App controller={controller} />);
  const biddingHeader = bidding.match(/<header\b[^>]*>.*?<\/header>/)![0];
  expect(biddingHeader).toContain('role="timer"');
  expect(bidding).not.toContain('>Skip Round</button>');
});

test('cancelling confirmation leaves the entire snapshot untouched', () => {
  const controller = ready();
  const before = controller.getSnapshot();
  const confirm = vi.fn(() => false);
  expect(confirmRoundSkip(controller, confirm)).toBeNull();
  expect(confirm).toHaveBeenCalledOnce();
  expect(controller.getSnapshot()).toBe(before);
});

test('confirmation resolves exactly once, preserves all positions/scores/used targets, and shows skipped feedback', () => {
  const controller = ready();
  const before = controller.getSnapshot().match;
  const confirm = vi.fn(() => true);
  expect(confirmRoundSkip(controller, confirm)).toEqual({ status: 'accepted' });
  const after = controller.getSnapshot().match;
  expect(after).toMatchObject({ phase: 'round-result', completedRounds: 1, outcome: { kind: 'no-bid-skip' } });
  expect(after.officialRobots).toBe(before.officialRobots);
  expect(after.scores).toBe(before.scores);
  expect(after.usedTargetIds).toBe(before.usedTargetIds);
  expect(confirmRoundSkip(controller, confirm)).toBeNull();
  expect(confirm).toHaveBeenCalledOnce();
  const markup = renderToStaticMarkup(<App controller={controller} />);
  expect(markup).toContain('Round skipped.');
  expect(markup).toContain('No points awarded.');
  expect(markup).not.toContain('>Skip Round</button>');
  expect(markup).not.toContain('role="timer"');
});

test('non-host and bidding phase cannot even open confirmation; model also rejects a non-host skip', () => {
  const controller = ready();
  const confirm = vi.fn(() => true);
  controller.actAs('alex');
  expect(confirmRoundSkip(controller, confirm)).toBeNull();
  expect(controller.sendPlayer({ type: 'round.skip', confirmed: true })).toEqual({ status: 'rejected', reason: 'not-host' });
  controller.actAs('maria');
  controller.sendPlayer({ type: 'bid.submit', value: 5 });
  expect(confirmRoundSkip(controller, confirm)).toBeNull();
  expect(confirm).not.toHaveBeenCalled();
});

test('confirmation cannot apply after a bid arrives while the dialog was open', () => {
  const controller = ready();
  const confirm = () => { controller.sendPlayer({ type: 'bid.submit', value: 5 }); return true; };
  expect(confirmRoundSkip(controller, confirm)).toBeNull();
  expect(controller.getSnapshot().match.phase).toBe('bidding');
  expect(controller.getSnapshot().match.completedRounds).toBe(0);
});

test('confirmation cannot apply after the acting player changes', () => {
  const controller = ready();
  const before = controller.getSnapshot().match;
  expect(confirmRoundSkip(controller, () => { controller.actAs('alex'); return true; })).toBeNull();
  expect(controller.getSnapshot().match).toBe(before);
});
