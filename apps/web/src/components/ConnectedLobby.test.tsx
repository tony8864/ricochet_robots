import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test, vi } from 'vitest';
import { entryTestId, roomEnteredFixture, preparingRoomFixture, failedPreparationFixture, thinkingRoomFixture, biddingRoomFixture, demonstratingRoomFixture, roundResultRoomFixture, finishedRoomFixture } from '../entry/roomEntry.testFixture';
import type { LiveLobbyClient, LobbyState } from '../lobby/liveLobbyClient';
import { ConnectedLobby } from './ConnectedLobby';

function render(connection: LobbyState['connection'] = 'connected', guest = false, changes: Partial<LobbyState> = {}) {
  const base = roomEnteredFixture(entryTestId(1), 'Player');
  const host = { seatId: entryTestId(110), nickname: 'Maria', connected: true };
  const entry = guest ? { ...base, state: { ...base.state, hostSeatId: host.seatId, players: [host, ...base.state.players] } } : base;
  const state: LobbyState = { room: entry.state, connection, message: connection === 'connected' ? 'Connected' : 'Disconnected.',
    shuffle: 'idle', start: 'idle', preparation: 'idle', bid: 'idle', attempt: 'idle', round: 'idle', rematch: 'idle', end: 'idle', attemptFeedback: '', boardEpoch: 0, bidWindowOpen: true, canRetryPreparation: false, actionError: '', ...changes };
  const client: LiveLobbyClient = { getSnapshot: () => state, subscribe: () => () => {},
    connect: vi.fn(), disconnect: vi.fn(), leave: vi.fn(() => true), shuffle: vi.fn(), start: vi.fn(), retry: vi.fn(), retryPreparation: vi.fn(), placeBid: vi.fn(),
    move: vi.fn(), undo: vi.fn(), reset: vi.fn(), giveUp: vi.fn(), skipDisconnected: vi.fn(), skipRound: vi.fn(), continueRound: vi.fn(), returnToLobby: vi.fn(), endRoom: vi.fn(), getServerNow: () => 100 };
  const onLeave = vi.fn();
  return { markup: renderToStaticMarkup(<ConnectedLobby entry={entry} client={client} onLeave={onLeave} />), client, onLeave };
}

test('room code and copy control are in the header before the read-only board and live roster', () => {
  const { markup, client } = render();
  expect(markup).toContain('<h1>Match setup</h1>');
  expect(markup).toContain('class="room-code room-code--compact"');
  expect(markup).toContain('aria-label="Copy room code ABC234"');
  expect(markup).toContain('ABC234</strong>');
  expect(markup.indexOf('class="room-code room-code--compact"')).toBeLessThan(markup.indexOf('class="board-preview__canvas"'));
  const header = markup.slice(markup.indexOf('<header'), markup.indexOf('</header>'));
  expect(header).toContain('class="lobby-header"');
  expect(header).toContain('Lobby · Waiting for players');
  expect(header).toContain('0 online'); // Presence comes from the snapshot, not the local connection.
  expect(header).not.toContain('ROOM CODE');
  expect(header).toContain('More actions');
  expect(header).toContain('End Room');
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
  return { ...entry.state, players: [...entry.state.players.map((p) => ({ ...p, connected: true })), { seatId: entryTestId(111), nickname: 'Guest', connected: true }] };
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
  expect(markup).toContain('ROUND 1 / 10');
  expect(markup).toContain('red star</span>');
  const header = markup.slice(markup.indexOf('<header'), markup.indexOf('</header>'));
  expect(header).toContain('active-match-header__top');
  expect(header).toContain('active-match-header__bottom');
  expect(header).toContain('aria-label="More actions" aria-expanded="false"');
  expect(header).toContain('hidden="" role="group" aria-label="Match actions"');
  expect(header).toContain(`${room.players.filter((player) => player.connected).length} online`);
  expect(header).not.toContain('ROOM CODE');
  expect(markup).not.toContain('Connected ·');
  expect(markup).not.toContain('Leave Room');
  expect(markup).toContain(`data-target-id="${room.match.round.targetId}"`);
  expect(markup.match(/game-board__target--active/g)).toHaveLength(1);
  expect(markup).toContain('PLAYER BIDS');
  const placeBid = markup.match(/<button[^>]*>Place Bid<\/button>/)![0];
  expect(placeBid).not.toContain('disabled');
  expect(markup).toContain('>Skip Round</button>');
  for (const absent of ['Act as', 'game-board__robot--interactive', 'Movement controls', 'Continue', 'countdown']) expect(markup).not.toContain(absent);
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

test('spectator host sees authoritative bidder, bid, count and target but no attempt controls', () => {
  const { markup } = render('connected', false, { room: demonstratingRoomFixture(twoPlayers()) });
  expect(markup).toContain('Guest is demonstrating');
  expect(markup).toContain('Bid: 5');
  expect(markup).toContain('Moves: 0 / 5');
  expect(markup).toContain('game-board__target--active');
  for (const absent of ['Place Bid', 'Skip Round', 'Give Up', 'Movement controls', 'role="timer"']) expect(markup).not.toContain(absent);
});

function activeRoom() {
  const room = demonstratingRoomFixture(twoPlayers());
  if (room.status !== 'playing' || room.match.phase !== 'demonstrating') throw new Error('Expected demo');
  return { ...room, match: { ...room.match, activeBidderIndex: 1 } };
}

test('offline active bidder replaces only demonstration content and restores it on rebind', () => {
  const room = activeRoom();
  if (room.status !== 'playing' || room.match.phase !== 'demonstrating') throw new Error('Expected demo');
  const offline = { ...room, players: room.players.map((p, i) => ({ ...p, connected: i !== 0 })),
    match: { ...room.match, disconnect: { disconnectId: entryTestId(999), disconnectedAtMs: 1000, skipAllowedAtMs: 61000, status: 'grace' as const } } };
  const markup = render('connected', false, { room: offline }).markup;
  expect(markup).toContain('aria-label="Disconnected demonstration"'); expect(markup).toContain('Skip Attempt');
  expect(markup.indexOf('board-preview__canvas')).toBeLessThan(markup.indexOf('class="disconnected-attempt"'));
  expect(markup).toContain('active-match-header'); expect(markup).not.toContain('Movement controls');
  expect(markup).not.toContain('game-board__robot--interactive');
  expect(render('connected', false, { room }).markup).toContain('Movement controls');
});

test('active bidder gets existing controls and local selection, without render-time mutations', () => {
  const { markup, client } = render('connected', false, { room: activeRoom() });
  expect(markup).toContain('Movement controls');
  expect(markup).toContain('game-board__robot--interactive');
  expect(markup).toContain('game-board__robot--red game-board__robot--selected');
  expect(markup).not.toContain('Place Bid');
  expect(markup).not.toContain('Skip Round');
  const buttons = [...markup.matchAll(/<button\b[^>]*>.*?<\/button>/g)].map(([button]) => button);
  expect(buttons.find((button) => button.includes('Move selected robot up'))).not.toContain('disabled');
  expect(buttons.find((button) => button.includes('Give up'))).not.toContain('disabled');
  expect(buttons.find((button) => button.includes('Undo last move'))).toContain('disabled');
  expect(client.move).not.toHaveBeenCalled();
  expect(client.giveUp).not.toHaveBeenCalled();
});

test.each(['pending', 'retry'] as const)('%s attempt blocks all mutations but keeps local selectors available', (attempt) => {
  const { markup } = render('connected', false, { room: activeRoom(), attempt });
  const buttons = [...markup.matchAll(/<button\b[^>]*>.*?<\/button>/g)].map(([button]) => button);
  for (const label of ['Move selected robot', 'Undo last move', 'Reset attempt', 'Give up']) {
    for (const button of buttons.filter((item) => item.includes(label))) expect(button).toContain('disabled');
  }
  expect(buttons.find((button) => button.includes('Select blue robot'))).not.toContain('disabled');
  expect(markup.includes('Retry pending request')).toBe(attempt === 'retry');
});

test.each(['connecting', 'disconnected', 'error', 'expired', 'closed'] as const)('%s active bidder cannot control robots', (connection) => {
  const { markup } = render(connection, false, { room: activeRoom() });
  expect(markup).not.toContain('game-board__robot--interactive');
  const buttons = [...markup.matchAll(/<button\b[^>]*>.*?<\/button>/g)].map(([button]) => button);
  for (const label of ['Move selected robot', 'Select blue robot', 'Give up']) expect(buttons.find((button) => button.includes(label))).toContain('disabled');
});

test('completed attempt retains board and honest read-only result, with pending retry accessible', () => {
  const demo = activeRoom();
  const { bidderQueue: _queue, activeBidderIndex: _index, attempt: _attempt, ...base } = demo.match;
  const room = { ...demo, match: { ...base, phase: 'round-result' as const, completedRounds: 1 as const, outcome: { kind: 'all-bidders-gave-up' as const } } };
  const { markup } = render('connected', false, { room, attempt: 'retry' });
  expect(markup).toContain('Nobody solved this round.');
  expect(markup).toContain('No points awarded.');
  expect(markup).toContain('ROUND 1 / 10');
  expect(markup).toContain('Retry pending request');
  expect(markup.match(/data-target-id=/g)).toHaveLength(17);
  expect(markup).toContain('>Continue</button>');
  for (const absent of ['Movement controls', 'Give Up', 'game-board__robot--interactive']) expect(markup).not.toContain(absent);
});

test('Preparing renders current official positions rather than resetting to catalog starts', () => {
  const room = preparingRoomFixture(twoPlayers());
  if (room.status !== 'playing') throw new Error('Expected playing');
  const carried = { ...room, match: { ...room.match, officialRobots: { ...room.match.officialRobots, red: { row: 0, column: 2 } } } };
  const markup = render('connected', false, { room: carried }).markup;
  expect(markup).toContain('class="game-board__robot game-board__robot--red" transform="translate(2.5 0.5)"');
});

test.each(['pending', 'retry'] as const)('result modal keeps host disabled and recovery reachable during %s Continue', (round) => {
  const { markup } = render('disconnected', false, { room: roundResultRoomFixture(twoPlayers()), round, actionError: 'Reply delayed.' });
  const dialog = markup.slice(markup.indexOf('<dialog'), markup.indexOf('</dialog>'));
  expect(dialog).toContain('Round skipped.');
  expect(dialog).toContain('>Reconnect</button>');
  expect(dialog).toContain('role="alert">Reply delayed.');
  expect(dialog.match(/<button[^>]*>Continue<\/button>/)![0]).toContain('disabled');
  expect(dialog.includes('Retry pending request')).toBe(round === 'retry');
});

test('guest result waits for host, final round uses View Results, Preparing never retains the modal', () => {
  const result = roundResultRoomFixture(twoPlayers());
  const guest = render('connected', false, { room: { ...result, hostSeatId: entryTestId(111) } }).markup;
  expect(guest).toContain('Waiting for Guest to continue.');
  expect(guest).not.toContain('>Continue</button>');
  const final = render('connected', false, { room: roundResultRoomFixture(twoPlayers(), true) }).markup;
  expect(final).toContain('ROUND 10 COMPLETE');
  expect(final).toContain('>View Results</button>');
  const preparing = render('connected', false, { room: failedPreparationFixture(twoPlayers()) }).markup;
  expect(preparing).not.toContain('<dialog');
  expect(preparing).toContain('Target preparation could not be completed');
});

test('Thinking guest has no Skip; pending host Skip is disabled', () => {
  const room = thinkingRoomFixture(twoPlayers());
  expect(render('connected', false, { room: { ...room, hostSeatId: entryTestId(111) } }).markup).not.toContain('>Skip Round</button>');
  const pending = render('connected', false, { room, round: 'pending' }).markup;
  expect(pending.match(/<button[^>]*><svg.*?<\/svg>Skip Round<\/button>/)![0]).toContain('disabled');
});

test('host End Room is available in every phase while Skip Round stays Thinking-only', () => {
  const thinking = thinkingRoomFixture(twoPlayers());
  expect(render('connected', false, { room: thinking }).markup).toContain('aria-label="More actions"');
  const rooms = [
    preparingRoomFixture(twoPlayers()), biddingRoomFixture(twoPlayers(), [7, 5]),
    demonstratingRoomFixture(twoPlayers()), activeRoom(), roundResultRoomFixture(twoPlayers()),
    finishedRoomFixture(twoPlayers()), twoPlayers(),
  ];
  for (const room of rooms) {
    const markup = render('connected', false, { room }).markup;
    expect(markup).toContain('aria-label="More actions"');
    expect(markup).toContain('End Room');
    expect(markup).not.toContain('Skip Round</button>');
    expect(markup).not.toContain('Leave Room');
  }
});

test('guests have Leave Room in every phase, including inside the inert round-result modal', () => {
  const rooms = [twoPlayers(), preparingRoomFixture(twoPlayers()), thinkingRoomFixture(twoPlayers()),
    biddingRoomFixture(twoPlayers(), [7, 5]), demonstratingRoomFixture(twoPlayers()),
    roundResultRoomFixture(twoPlayers()), finishedRoomFixture(twoPlayers())];
  for (const room of rooms) for (const connection of ['connected', 'disconnected'] as const) {
    const { markup, client, onLeave } = render(connection, false, { room: { ...room, hostSeatId: entryTestId(111) }, bid: 'retry' });
    expect(markup).toContain('aria-label="More actions"'); expect(markup).toContain('Leave Room</button>');
    expect(markup).not.toContain('Skip Round</button>'); expect(markup).not.toContain('End Room');
    if (room.status === 'playing' && room.match.phase === 'round-result') {
      expect(markup.slice(markup.indexOf('<dialog'))).toContain('Leave Room</button>');
    }
    expect(client.leave).not.toHaveBeenCalled(); expect(onLeave).not.toHaveBeenCalled();
  }
});

test.each([
  [[2, 1], 'Player wins!'], [[1, 1], 'It&#x27;s a tie!'], [[0, 0], 'No winner'],
] as const)('Finished reuses actual-score full-screen results for %j', (scores, message) => {
  const room = finishedRoomFixture(twoPlayers(), scores);
  const { markup, client } = render('connected', false, { room });
  expect(markup).toContain('class="match-results"');
  expect(markup).toContain(message);
  expect(markup).toContain('>New Match</button>');
  expect(markup.match(/data-seat-id=/g)).toHaveLength(2);
  expect(markup).not.toContain('game-board');
  expect(markup).not.toContain('<dialog');
  expect(client.returnToLobby).not.toHaveBeenCalled();
});

test.each(['disconnected', 'pending', 'retry'] as const)('Finished %s state blocks new requests and leaves recovery usable', (kind) => {
  const { markup } = render(kind === 'disconnected' ? 'disconnected' : 'connected', false,
    { room: finishedRoomFixture(twoPlayers()), rematch: kind === 'disconnected' ? 'idle' : kind, actionError: 'Reply delayed.' });
  const button = markup.match(/<button[^>]*>(?:New Match|Returning to lobby…)<\/button>/)![0];
  expect(button).toContain('disabled');
  expect(markup).toContain('role="alert">Reply delayed.');
  expect(markup.includes('Retry pending request')).toBe(kind === 'retry');
  expect(markup.includes('>Reconnect</button>')).toBe(kind === 'disconnected');
});

test('Finished guest waits for the named host; returned lobby keeps code and blocks Start until retry resolves', () => {
  const room = finishedRoomFixture(twoPlayers());
  const guest = render('connected', false, { room: { ...room, hostSeatId: entryTestId(111) } }).markup;
  expect(guest).toContain('Waiting for Guest to start a new match.');
  expect(guest).not.toContain('>New Match</button>');
  const pending = render('connected', false, { room: twoPlayers(), rematch: 'retry' }).markup;
  expect(pending).toContain('Copy room code ABC234');
  expect(pending).toContain('Retry pending request');
  const buttons = [...pending.matchAll(/<button\b[^>]*>.*?<\/button>/g)].map(([button]) => button);
  expect(buttons.find((button) => button.includes('Start Match'))).toContain('disabled');
  expect(buttons.find((button) => button.includes('Shuffle Board'))).toContain('disabled');
});

test('lost request can be exactly retried even after Thinking is revealed', () => {
  const markup = render('connected', false, { room: thinkingRoomFixture(twoPlayers()), preparation: 'retry' }).markup;
  expect(markup).toContain('Retry pending request');
  expect(markup).not.toContain('>Retry preparation</button>');
});
