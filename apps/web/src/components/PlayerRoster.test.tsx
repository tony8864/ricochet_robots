import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test } from 'vitest';
import type { MatchBid } from '@robot-puzzle/match';
import { PlayerRoster } from './PlayerRoster';

const players = [
  { seatId: 'maria', nickname: 'Maria' }, { seatId: 'alex', nickname: 'Alex' },
  { seatId: 'teo', nickname: 'Teo' }, { seatId: 'eva', nickname: 'Eva' },
];
const render = (bids: readonly MatchBid[] = [], currentSeatId = 'maria', roster = players) => renderToStaticMarkup(
  <PlayerRoster variant="bids" players={roster} bids={bids} currentSeatId={currentSeatId} />,
);
const rows = (markup: string) => [...markup.matchAll(/<li\b[^>]*>.*?<\/li>/g)].map(([row]) => row);
const names = (markup: string) => rows(markup).map((row) => players.find((player) => row.includes(`>${player.nickname}`))!.seatId);

test('empty roster bids show em dashes in original roster order, with header above the container', () => {
  const markup = render();
  expect(markup).toContain('>PLAYER BIDS</h2>');
  expect(markup).toContain('>4 players</span>');
  expect(markup.indexOf('PLAYER BIDS')).toBeLessThan(markup.indexOf('<ul'));
  expect(names(markup)).toEqual(['maria', 'alex', 'teo', 'eva']);
  expect(markup.match(/>—<\/span>/g)).toHaveLength(4);
  expect(markup.match(/player-bids__value--empty/g)).toHaveLength(4);
  expect(markup).not.toContain('Host');
  expect(markup).not.toContain('<button');
});

test('submitted bids sort by value and original acceptance order; unbid seats stay last', () => {
  const bids: readonly MatchBid[] = Object.freeze([
    Object.freeze({ seatId: 'teo', value: 4, firstAcceptedOrder: 2 }),
    Object.freeze({ seatId: 'maria', value: 7, firstAcceptedOrder: 1 }),
    Object.freeze({ seatId: 'alex', value: 4, firstAcceptedOrder: 0 }),
  ]);
  const before = JSON.stringify(bids);
  const markup = render(bids);
  expect(names(markup)).toEqual(['alex', 'teo', 'maria', 'eva']);
  expect(rows(markup)[0]).toContain('>4 moves</span>');
  expect(rows(markup)[2]).toContain('>7 moves</span>');
  expect(JSON.stringify(bids)).toBe(before);
});

test('accepted reductions reorder the view immediately without modifying previous bids', () => {
  const original = [
    { seatId: 'maria', value: 7, firstAcceptedOrder: 0 },
    { seatId: 'alex', value: 4, firstAcceptedOrder: 1 },
  ];
  expect(names(render(original))).toEqual(['alex', 'maria', 'teo', 'eva']);
  const tied = [{ ...original[0], value: 4 }, original[1]];
  expect(names(render(tied))).toEqual(['maria', 'alex', 'teo', 'eva']);
  const lowered = [{ ...original[0], value: 3 }, original[1]];
  const markup = render(lowered);
  expect(names(markup)).toEqual(['maria', 'alex', 'teo', 'eva']);
  expect(rows(markup)[0]).toContain('>3 moves</span>');
  expect(original[0].value).toBe(7);
});

test('uses singular move at one; current seat gets only inline (you) and the highlight', () => {
  const markup = render([{ seatId: 'alex', value: 1, firstAcceptedOrder: 0 }], 'alex');
  const rendered = rows(markup);
  expect(rendered[0]).toContain('>1 move</span>');
  expect(rendered[0]).toContain('player-bids__row--current');
  expect(rendered[0]).toContain('class="player-bids__you">(you)</span>');
  expect(rendered.slice(1).every((row) => !row.includes('(you)'))).toBe(true);
  expect(markup).not.toContain('lobby-roster__host');
  expect(markup).not.toContain('1 moves');
});

test('switching current seat preserves ordering and accepted values', () => {
  const bids = [{ seatId: 'teo', value: 5, firstAcceptedOrder: 0 }];
  for (const player of players) {
    const markup = render(bids, player.seatId);
    expect(names(markup)).toEqual(['teo', 'maria', 'alex', 'eva']);
    expect(markup.match(/player-bids__row--current/g)).toHaveLength(1);
    const current = rows(markup).find((row) => row.includes('player-bids__row--current'))!;
    expect(current).toContain(`>${player.nickname}`);
    expect(current).toContain('(you)');
    expect(markup).toContain('>5 moves</span>');
  }
});

test('six-player list remains expanded and keyboard-scrollable without controls or scores', () => {
  const six = [...players, { seatId: 'iris', nickname: 'Iris' }, { seatId: 'nikos', nickname: 'Nikos' }];
  const markup = render([], 'maria', six);
  expect(markup).toContain('>6 players</span>');
  expect(rows(markup)).toHaveLength(6);
  expect(markup).toContain('tabindex="0"');
  for (const absent of ['<details', '<button', 'points', 'score', 'Host']) expect(markup).not.toContain(absent);
});
