import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test } from 'vitest';
import { LobbyRoster } from './LobbyRoster';

const players = [
  { seatId: 'maria', nickname: 'Maria' },
  { seatId: 'alex', nickname: 'Alex' },
  { seatId: 'teo', nickname: 'Teo' },
];
const render = (currentSeatId: string, roster = players) => renderToStaticMarkup(
  <LobbyRoster players={roster} hostSeatId="maria" currentSeatId={currentSeatId} />,
);
const rows = (markup: string) => [...markup.matchAll(/<li\b[^>]*>.*?<\/li>/g)].map(([row]) => row);

test('one shared list shows nicknames, heading, and actual count without extra player information', () => {
  const markup = render('alex');
  expect(markup).toContain('>Players</h2>');
  expect(markup).toContain('aria-label="3 of 6 players">3 / 6');
  expect(markup.match(/<ul\b/g)).toHaveLength(1);
  expect(rows(markup)).toHaveLength(3);
  for (const player of players) expect(markup).toContain(`>${player.nickname}</span>`);
  for (const absent of ['<img', '<svg', '<button', 'avatar', 'score', 'points', 'robot--']) {
    expect(markup).not.toContain(absent);
  }
});

test('host and current player indicators are independent, and other rows have neither', () => {
  const [host, current, other] = rows(render('alex'));
  expect(host).toContain('>Host</span>');
  expect(host).not.toContain('>You</span>');
  expect(current).toContain('>You</span>');
  expect(current).not.toContain('>Host</span>');
  expect(other).not.toContain('>Host</span>');
  expect(other).not.toContain('>You</span>');
});

test('the current host shows both indicators on the same highlighted row', () => {
  const [host, ...others] = rows(render('maria'));
  expect(host).toContain('lobby-roster__row--current');
  expect(host).toContain('>Host</span>');
  expect(host).toContain('>You</span>');
  expect(others.every((row) => !row.includes('lobby-roster__row--current'))).toBe(true);
});

test('changing current seat moves only the highlight/You indicator, not the roster order or host', () => {
  const before = JSON.stringify(players);
  for (const current of players) {
    const rendered = rows(render(current.seatId));
    expect(rendered.filter((row) => row.includes('lobby-roster__row--current'))).toHaveLength(1);
    for (let index = 0; index < players.length; index++) {
      expect(rendered[index]).toContain(`>${players[index].nickname}</span>`);
      expect(rendered[index].includes('>You</span>')).toBe(players[index].seatId === current.seatId);
      expect(rendered[index].includes('>Host</span>')).toBe(index === 0);
    }
  }
  expect(JSON.stringify(players)).toBe(before);
});

test('six players remain in the same fully expanded list', () => {
  const six = [...players, ...['Iris', 'Nikos', 'Eva'].map((nickname) => ({ seatId: nickname.toLowerCase(), nickname }))];
  const markup = render('eva', six);
  expect(markup).toContain('aria-label="6 of 6 players">6 / 6');
  expect(rows(markup)).toHaveLength(6);
  expect(markup).not.toContain('<details');
});
