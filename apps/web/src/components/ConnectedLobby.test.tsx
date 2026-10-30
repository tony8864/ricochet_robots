import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test, vi } from 'vitest';
import { entryTestId, roomEnteredFixture, preparingRoomFixture } from '../entry/roomEntry.testFixture';
import type { LiveLobbyClient, LobbyState } from '../lobby/liveLobbyClient';
import { ConnectedLobby } from './ConnectedLobby';

function render(connection: LobbyState['connection'] = 'connected', guest = false, changes: Partial<LobbyState> = {}) {
  const base = roomEnteredFixture(entryTestId(1), 'Player');
  const host = { seatId: entryTestId(110), nickname: 'Maria', connected: true };
  const entry = guest ? { ...base, state: { ...base.state, hostSeatId: host.seatId, players: [host, ...base.state.players] } } : base;
  const state: LobbyState = { room: entry.state, connection, message: connection === 'connected' ? 'Connected' : 'Disconnected.',
    shuffle: 'idle', start: 'idle', actionError: '', ...changes };
  const client: LiveLobbyClient = { getSnapshot: () => state, subscribe: () => () => {},
    connect: vi.fn(), disconnect: vi.fn(), shuffle: vi.fn(), start: vi.fn(), retry: vi.fn() };
  return { markup: renderToStaticMarkup(<ConnectedLobby entry={entry} client={client} />), client };
}

test('room code and copy control are in the header before the read-only board and live roster', () => {
  const { markup, client } = render();
  expect(markup).toContain('<h1>Match setup</h1>');
  expect(markup).toContain('class="room-code"');
  expect(markup).toContain('aria-label="Copy room code ABC234"');
  expect(markup).toContain('ABC234</strong>');
  expect(markup.indexOf('class="room-code"')).toBeLessThan(markup.indexOf('class="board-preview__canvas"'));
  expect(markup.indexOf('class="board-preview__canvas"')).toBeLessThan(markup.indexOf('class="lobby-roster"'));
  expect(markup.match(/data-target-id=/g)).toHaveLength(17);
  expect(markup).not.toContain('game-board__robot--interactive');
  expect(markup).not.toContain('Act as');
  expect(client.connect).not.toHaveBeenCalled(); // SSR/render never opens a socket.
});

test('one-player host can shuffle but cannot start until another player joins', () => {
  const { markup } = render();
  const actions = [...markup.matchAll(/<button\b[^>]*>.*?<\/button>/g)].map(([button]) => button);
  expect(actions.find((button) => button.includes('Shuffle Board'))).not.toContain('disabled');
  expect(actions.find((button) => button.includes('Start Match'))).toContain('disabled');
  expect(markup).toContain('At least two players are needed');
});

test('guest retains You/Host roster indicators but has neither host action', () => {
  const { markup } = render('connected', true);
  expect(markup).toContain('lobby-roster__you');
  expect(markup).toContain('lobby-roster__host');
  expect(markup).toContain('Waiting for Maria');
  expect(markup).not.toContain('Shuffle Board');
  expect(markup).not.toContain('Start Match');
});

test.each(['connecting', 'disconnected', 'error', 'expired', 'closed'] as const)('%s state never permits shuffle', (connection) => {
  const { markup } = render(connection);
  const shuffle = [...markup.matchAll(/<button\b[^>]*>.*?<\/button>/g)].find(([button]) => button.includes('Shuffle Board'))![0];
  expect(shuffle).toContain('disabled');
  expect(markup.includes('>Reconnect</button>')).toBe(connection === 'disconnected' || connection === 'error');
});

test('pending/retry shuffle labels and safe errors are visible without changing the board locally', () => {
  expect(render('connected', false, { shuffle: 'pending' }).markup).toContain('Shuffling…');
  const markup = render('connected', false, { shuffle: 'retry', actionError: 'Reply delayed.' }).markup;
  expect(markup).toContain('Retry Shuffle');
  expect(markup).toContain('role="alert">Reply delayed.');
});

function twoPlayers() {
  const entry = roomEnteredFixture(entryTestId(1), 'Player');
  return { ...entry.state, players: [...entry.state.players, { seatId: entryTestId(111), nickname: 'Guest', connected: false }] };
}

test('two-seat host can start; pending Start disables both actions and retry keeps its own label', () => {
  const buttons = (markup: string) => [...markup.matchAll(/<button\b[^>]*>.*?<\/button>/g)].map(([button]) => button);
  const ready = render('connected', false, { room: twoPlayers() }).markup;
  expect(buttons(ready).find((button) => button.includes('Start Match'))).not.toContain('disabled');
  const pending = render('connected', false, { room: twoPlayers(), start: 'pending' }).markup;
  expect(buttons(pending).find((button) => button.includes('Starting…'))).toContain('disabled');
  expect(buttons(pending).find((button) => button.includes('Shuffle Board'))).toContain('disabled');
  expect(render('connected', false, { room: twoPlayers(), start: 'retry' }).markup).toContain('Retry Start');
});

test('Preparing preserves board/roster/code with no active target, host actions or fake preparation retry', () => {
  const markup = render('connected', false, { room: preparingRoomFixture(twoPlayers()) }).markup;
  expect(markup).toContain('<h1>Preparing match</h1>');
  expect(markup).toContain('aria-label="Match preparation"');
  expect(markup).toContain('First-target preparation will be connected next');
  expect(markup).toContain('class="lobby-roster"');
  expect(markup).toContain('aria-label="Copy room code ABC234"');
  expect(markup.match(/data-target-id=/g)).toHaveLength(17);
  for (const absent of ['Start Match', 'Shuffle Board', 'Retry preparation', 'Movement controls', 'Place Bid', 'game-board__target--active']) {
    expect(markup).not.toContain(absent);
  }
});

test('Preparing permits only an explicit retry of an unresolved request, not a fresh Start', () => {
  const markup = render('connected', false, { room: preparingRoomFixture(twoPlayers()), start: 'retry' }).markup;
  expect(markup).toContain('Retry pending request');
  expect(markup).not.toContain('Start Match');
});
