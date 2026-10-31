import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test, vi } from 'vitest';
import { entryTestId, roomEnteredFixture, preparingRoomFixture, failedPreparationFixture, thinkingRoomFixture, biddingRoomFixture, demonstratingRoomFixture } from '../entry/roomEntry.testFixture';
import type { LiveLobbyClient, LobbyState } from '../lobby/liveLobbyClient';
import { ConnectedLobby } from './ConnectedLobby';

function render(connection: LobbyState['connection'] = 'connected', guest = false, changes: Partial<LobbyState> = {}) {
  const base = roomEnteredFixture(entryTestId(1), 'Player');
  const host = { seatId: entryTestId(110), nickname: 'Maria', connected: true };
  const entry = guest ? { ...base, state: { ...base.state, hostSeatId: host.seatId, players: [host, ...base.state.players] } } : base;
  const state: LobbyState = { room: entry.state, connection, message: connection === 'connected' ? 'Connected' : 'Disconnected.',
    shuffle: 'idle', start: 'idle', preparation: 'idle', bid: 'idle', bidWindowOpen: true, canRetryPreparation: false, actionError: '', ...changes };
  const client: LiveLobbyClient = { getSnapshot: () => state, subscribe: () => () => {},
    connect: vi.fn(), disconnect: vi.fn(), shuffle: vi.fn(), start: vi.fn(), retry: vi.fn(), retryPreparation: vi.fn(), placeBid: vi.fn(), getServerNow: () => 100 };
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
  expect(markup).toContain('<h1>Preparing round</h1>');
  expect(markup).toContain('aria-label="Match preparation"');
  expect(markup).toContain('Preparing a verified target');
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

test.each(['deferred', 'error', 'unavailable'] as const)('%s preparation has distinct feedback and only server-eligible host Retry', (status) => {
  const room = failedPreparationFixture(twoPlayers(), status);
  const { markup, client } = render('connected', false, { room, canRetryPreparation: true });
  expect(markup).toContain(status === 'deferred' ? 'within the search limit' : status === 'error' ? 'could not be completed' : 'No eligible target');
  expect(markup.includes('>Retry preparation</button>')).toBe(status !== 'unavailable');
  expect(markup).not.toContain('game-board__target--active');
  expect(client.retryPreparation).not.toHaveBeenCalled();
});

test.each([
  { connection: 'disconnected' as const, canRetryPreparation: true },
  { connection: 'connected' as const, canRetryPreparation: false },
  { connection: 'connected' as const, canRetryPreparation: true, preparation: 'pending' as const },
])('preparation Retry respects connection, cooldown and pending state %#', (changes) => {
  const markup = render(changes.connection, false, { room: failedPreparationFixture(twoPlayers()), ...changes }).markup;
  const button = [...markup.matchAll(/<button\b[^>]*>.*?<\/button>/g)].find(([item]) => /Retry preparation|Retrying preparation/.test(item))![0];
  expect(button).toContain('disabled');
});

test('guest waits for host on retryable error and never receives a Retry button', () => {
  const room = failedPreparationFixture(twoPlayers());
  const guestRoom = { ...room, hostSeatId: entryTestId(111) };
  const markup = render('connected', false, { room: guestRoom, canRetryPreparation: true }).markup;
  expect(markup).toContain('Waiting for Guest to retry');
  expect(markup).not.toContain('>Retry preparation</button>');
});

test('Thinking shows the server target and positions, round header, bids and no local controls', () => {
  const room = thinkingRoomFixture(twoPlayers());
  if (room.status !== 'playing' || room.match.phase !== 'thinking') throw new Error('Expected Thinking');
  const { markup, client } = render('connected', false, { room });
  expect(markup).toContain('<h1>Thinking</h1>');
  expect(markup).toContain('Round 1 of 10');
  expect(markup).toContain('Target: red star');
  expect(markup).toContain(`data-target-id="${room.match.round.targetId}"`);
  expect(markup.match(/game-board__target--active/g)).toHaveLength(1);
  expect(markup).toContain('PLAYER BIDS');
  const placeBid = markup.match(/<button[^>]*>Place Bid<\/button>/)![0];
  expect(placeBid).not.toContain('disabled');
  for (const absent of ['Act as', 'game-board__robot--interactive', 'Movement controls', 'Skip Round', 'Continue', 'countdown']) expect(markup).not.toContain(absent);
  expect(client.retryPreparation).not.toHaveBeenCalled();
  expect(client.start).not.toHaveBeenCalled();
});

test('Bidding shows server deadline countdown and accepted bids while the board stays read-only', () => {
  const { markup } = render('connected', false, { room: biddingRoomFixture(twoPlayers(), [7, 5]) });
  expect(markup).toContain('<h1>Bidding</h1>');
  expect(markup).toContain('role="timer"');
  expect(markup).toContain('1:00');
  expect(markup).toContain('Your accepted bid: 7 moves');
  expect(markup.indexOf('5 moves')).toBeLessThan(markup.lastIndexOf('7 moves'));
  expect(markup).not.toContain('game-board__robot--interactive');
  expect(markup).not.toContain('Skip Round');
});

test.each([
  { connection: 'disconnected' as const }, { bid: 'pending' as const }, { bidWindowOpen: false },
])('new bids are disabled while disconnected, pending or locally closed %#', (changes) => {
  const { markup } = render(changes.connection ?? 'connected', false, { room: thinkingRoomFixture(twoPlayers()), ...changes });
  const button = markup.match(/<button[^>]*>(?:Place Bid|Placing bid…)<\/button>/)![0];
  expect(button).toContain('disabled');
});

test('Demonstrating displays the authoritative bidder, bid, move count and target without T16 controls', () => {
  const { markup } = render('connected', false, { room: demonstratingRoomFixture(twoPlayers()) });
  expect(markup).toContain('Guest is demonstrating');
  expect(markup).toContain('Bid: 5');
  expect(markup).toContain('Moves: 0 / 5');
  expect(markup).toContain('game-board__target--active');
  for (const absent of ['Place Bid', 'Skip Round', 'Give Up', 'Movement controls', 'role="timer"']) expect(markup).not.toContain(absent);
});

test('Preparing renders current official positions rather than resetting to catalog starts', () => {
  const room = preparingRoomFixture(twoPlayers());
  if (room.status !== 'playing') throw new Error('Expected playing');
  const carried = { ...room, match: { ...room.match, officialRobots: { ...room.match.officialRobots, red: { row: 0, column: 2 } } } };
  const markup = render('connected', false, { room: carried }).markup;
  expect(markup).toContain('class="game-board__robot game-board__robot--red" transform="translate(2.5 0.5)"');
});

test('lost request can be exactly retried even after Thinking is revealed', () => {
  const markup = render('connected', false, { room: thinkingRoomFixture(twoPlayers()), preparation: 'retry' }).markup;
  expect(markup).toContain('Retry pending request');
  expect(markup).not.toContain('>Retry preparation</button>');
});
