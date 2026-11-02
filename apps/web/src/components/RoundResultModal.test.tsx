import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, expect, test, vi } from 'vitest';
import { MATCH_ROUND_COUNT, type RoundOutcome, type RoundResultMatchState } from '@robot-puzzle/match';
import { createDevelopmentController } from '../local/developmentScenario';
import { openResultDialog, RoundResultModal } from './RoundResultModal';

afterEach(() => vi.unstubAllGlobals());

function result(outcome: RoundOutcome): RoundResultMatchState {
  const controller = createDevelopmentController();
  controller.sendPlayer({ type: 'attempt.giveUp' });
  controller.actAs('alex');
  controller.sendPlayer({ type: 'attempt.giveUp' });
  const match = controller.getSnapshot().match;
  if (match.phase !== 'round-result') throw new Error('Expected result fixture.');
  return { ...match, outcome };
}

const render = (match: RoundResultMatchState, isHost = true) => renderToStaticMarkup(
  <RoundResultModal match={match} isHost={isHost} hostName="Maria" onContinue={vi.fn()} />,
);

test.each([
  [{ kind: 'no-bid-skip' }, 'Round skipped.'],
  [{ kind: 'all-bidders-gave-up' }, 'Nobody solved this round.'],
] as const)('no-point outcome %j has only the agreed message and action', (outcome, message) => {
  const markup = render(result(outcome));
  expect(markup).toContain('<dialog');
  expect(markup).toContain('aria-modal="true"');
  expect(markup).toContain('ROUND 1 COMPLETE');
  expect(markup).toContain(message);
  expect(markup).toContain('No points awarded.');
  expect(markup).toContain('>Continue</button>');
  expect(markup).not.toContain('+1 point');
  expect(markup).not.toContain('Preparing');
});

test.each([1, 5])('success shows winner, %i moves, accepted bid, and just the point emphasized', (moves) => {
  const markup = render(result({ kind: 'success', winnerSeatId: 'maria', winningBid: 7, moveCount: moves }));
  expect(markup).toContain('Maria solved the target!');
  expect(markup).toContain(`${moves} ${moves === 1 ? 'move' : 'moves'} · Bid: 7 · <strong>+1 point</strong>`);
  expect(markup).not.toContain('No points awarded.');
});

test('non-host waits, and final round changes both host and watcher actions', () => {
  const match = result({ kind: 'no-bid-skip' });
  expect(render(match, false)).toContain('Waiting for Maria to continue.');
  expect(render(match, false)).not.toContain('<button');
  const final: RoundResultMatchState = { ...match, completedRounds: MATCH_ROUND_COUNT, round: { ...match.round, number: MATCH_ROUND_COUNT } };
  expect(render(final)).toContain('>View Results</button>');
  expect(render(final)).toContain(`ROUND ${MATCH_ROUND_COUNT} COMPLETE`);
  expect(render(final, false)).toContain('Waiting for Maria to show the results.');
  expect(render(final, false)).not.toContain('<button');
});

test('native dialog lifecycle opens modally and restores body scrolling on cleanup/remount', () => {
  const body = { style: { overflow: 'auto' } };
  vi.stubGlobal('document', { body });
  const dialog = {
    open: false,
    showModal: vi.fn(() => { dialog.open = true; }),
    close: vi.fn(() => { dialog.open = false; }),
  };
  const cleanup = openResultDialog(dialog as unknown as HTMLDialogElement);
  expect(dialog.showModal).toHaveBeenCalledOnce();
  expect(body.style.overflow).toBe('hidden');
  cleanup();
  expect(dialog.open).toBe(false);
  expect(body.style.overflow).toBe('auto');
  // React Strict Mode replays setup/cleanup without leaving the page locked.
  openResultDialog(dialog as unknown as HTMLDialogElement)();
  expect(dialog.showModal).toHaveBeenCalledTimes(2);
  expect(body.style.overflow).toBe('auto');
});

test.each([true, false])('nested confirmations keep the page locked until both dialogs close (parent first=%s)', (parentFirst) => {
  const body = { style: { overflow: 'auto' } }; vi.stubGlobal('document', { body });
  const make = () => ({ open: false, showModal: vi.fn(), close: vi.fn() }) as unknown as HTMLDialogElement;
  const parent = openResultDialog(make()); const confirmation = openResultDialog(make());
  const first = parentFirst ? parent : confirmation; const last = parentFirst ? confirmation : parent;
  first(); first(); expect(body.style.overflow).toBe('hidden');
  last(); last(); expect(body.style.overflow).toBe('auto');
});
