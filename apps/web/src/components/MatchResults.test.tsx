import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test, vi } from 'vitest';
import { createMatch, MATCH_ROUND_COUNT, type FinishedMatchState } from '@robot-puzzle/match';
import { starterBoard } from '@robot-puzzle/puzzles';
import { MatchResults } from './MatchResults';
import { App } from '../App';
import { createLocalMatchController } from '../local/controller';

const players = ['Maria', 'Alex', 'Teo', 'Ana', 'Nora', 'Eli'].map((nickname) => ({ seatId: nickname.toLowerCase(), nickname }));
function finished(scores: readonly number[]): FinishedMatchState {
  const initial = createMatch({ matchId: 'results-view', players, puzzle: starterBoard });
  return {
    phase: 'finished', completedRounds: MATCH_ROUND_COUNT, matchId: initial.matchId,
    players: initial.players, puzzle: initial.puzzle, officialRobots: initial.officialRobots,
    usedTargetIds: initial.usedTargetIds,
    scores: Object.fromEntries(players.map((player, index) => [player.seatId, scores[index]])),
  };
}
const render = (scores: readonly number[], currentSeatId = 'maria') => renderToStaticMarkup(
  <MatchResults match={finished(scores)} currentSeatId={currentSeatId} hostSeatId="maria" onNewMatch={vi.fn()} />,
);
const rows = (markup: string) => [...markup.matchAll(/<li\b[^>]*>.*?<\/li>/g)].map(([row]) => row);

test('single winner shows completed count, descending standings and host action, without board/modal', () => {
  const markup = render([0, 2, 1, 0, 0, 0]);
  expect(markup).toContain('MATCH COMPLETE');
  expect(markup).toContain('Alex wins!');
  expect(markup).toContain(`${MATCH_ROUND_COUNT} rounds played`);
  expect(markup).toContain('>New Match</button>');
  expect(markup).not.toContain('<dialog');
  expect(markup).not.toContain('game-board');
  expect(rows(markup)).toHaveLength(6);
  expect(rows(markup).map((row) => row.match(/data-seat-id="([^"]+)"/)![1])).toEqual(['alex', 'teo', 'maria', 'ana', 'nora', 'eli']);
  expect(rows(markup)[0]).toContain('final-standings__row--winner');
  expect(rows(markup)[2]).toContain('final-standings__row--current');
});

test('positive tie lists all winners, uses shared competition ranks and stable roster order', () => {
  const markup = render([2, 1, 2, 1, 0, 0]);
  expect(markup).toContain('It&#x27;s a tie!');
  expect(markup).toContain('Maria, Teo');
  const list = rows(markup);
  expect(list.map((row) => row.match(/aria-label="Rank (\d+)"/)![1])).toEqual(['1', '1', '3', '3', '5', '5']);
  expect(list.map((row) => row.match(/data-seat-id="([^"]+)"/)![1])).toEqual(['maria', 'teo', 'alex', 'ana', 'nora', 'eli']);
  expect(list.filter((row) => row.includes('final-standings__row--winner'))).toHaveLength(2);
  expect(list[0]).toContain('>You</span>');
  expect(list[0]).not.toContain('final-standings__row--current');
});

test('all zero means No winner, unranked original roster and only your row highlighted', () => {
  const markup = render([0, 0, 0, 0, 0, 0], 'teo');
  expect(markup).toContain('No winner');
  expect(markup).toContain('No points were awarded in this match.');
  expect(markup).not.toContain('final-standings__row--winner');
  expect(markup).not.toContain('Rank ');
  expect(markup).not.toContain('tie!');
  const list = rows(markup);
  expect(list.map((row) => row.match(/data-seat-id="([^"]+)"/)![1])).toEqual(players.map((player) => player.seatId));
  expect(list.every((row) => row.includes('aria-label="Unranked">—') && row.includes('aria-label="0 points"'))).toBe(true);
  expect(list.filter((row) => row.includes('final-standings__row--current'))).toHaveLength(1);
  expect(list[2]).toContain('final-standings__row--current');
  expect(markup).toContain('Waiting for Maria to start a new match.');
  expect(markup).not.toContain('<button');
});

test('finished App switches everyone to full-screen results and keeps Act as available', () => {
  const match = finished([1, 0, 0, 0, 0, 0]);
  const controller = createLocalMatchController({ match, hostSeatId: 'maria', actingSeatId: 'maria', now: () => 1_000 });
  const onNewMatch = vi.fn();
  const host = renderToStaticMarkup(<App controller={controller} onNewMatch={onNewMatch} />);
  expect(host).toContain('class="match-results"');
  expect(host).toContain('Act as');
  expect(host).toContain('>New Match</button>');
  expect(host).not.toContain('board-preview');
  controller.actAs('alex');
  const watcher = renderToStaticMarkup(<App controller={controller} onNewMatch={onNewMatch} />);
  expect(watcher).toContain('Maria wins!');
  expect(watcher).toContain('Waiting for Maria to start a new match.');
  expect(watcher).not.toContain('>New Match</button>');
  expect(controller.getSnapshot().match).toBe(match);
  expect(onNewMatch).not.toHaveBeenCalled();
});
