import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test } from 'vitest';
import { RoomEntry } from './RoomEntry';
import type { RoomEntryClient, RoomEntryState } from '../entry/roomEntryClient';
import { entryTestId, roomEnteredFixture } from '../entry/roomEntry.testFixture';

const render = (initialNickname = '', pathname = '/', showSimulator = false) =>
  renderToStaticMarkup(<RoomEntry pathname={pathname} initialNickname={initialNickname} showSimulator={showSimulator} />);
const buttons = (markup: string) => [...markup.matchAll(/<button\b[^>]*>.*?<\/button>/g)].map(([button]) => button);
const renderState = (state: RoomEntryState) => {
  const client: RoomEntryClient = { getSnapshot: () => state, subscribe: () => () => {},
    create: async () => {}, join: async () => {}, retry: async () => {}, startNewSession: () => {} };
  return renderToStaticMarkup(<RoomEntry pathname="/room/ABC234" initialNickname="Maria" client={client} />);
};

test('entry has shared nickname, both actions, branding dots, and online-only feedback', () => {
  const markup = render();
  expect(markup).toContain('Robot Puzzle</h1>');
  expect(markup).toContain('Play together. Solve the puzzle.');
  expect(markup.match(/class="room-entry__dot /g)).toHaveLength(4);
  expect(markup.match(/name="nickname"/g)).toHaveLength(1);
  expect(markup).toContain('Up to 24 characters.');
  expect(markup).toContain('Internet connection required.');
  expect(buttons(markup)).toHaveLength(2);
  expect(buttons(markup).every((button) => button.includes('disabled'))).toBe(true);
  expect(markup).not.toContain('Open local simulator');
});

test('valid nickname enables only Create until code is valid', () => {
  const actions = buttons(render('Maria'));
  expect(actions[0]).not.toContain('disabled');
  expect(actions[1]).toContain('disabled');
  expect(buttons(render(' '.repeat(5))).every((button) => button.includes('disabled'))).toBe(true);
  expect(buttons(render('a'.repeat(25))).every((button) => button.includes('disabled'))).toBe(true);
});

test('actions have decorative leading icons and an or divider before room code', () => {
  const markup = render();
  const actions = buttons(markup);
  for (const action of actions) {
    expect(action).toContain('class="room-entry__button-icon"');
    expect(action).toContain('aria-hidden="true"');
    expect(action).toContain('focusable="false"');
  }
  expect(actions[0]).toContain('M12 5v14M5 12h14');
  expect(actions[1]).toContain('M14 4h6v16h-6M4 12h11m-4-4 4 4-4 4');
  expect(markup).toContain('class="room-entry__divider"><span>OR</span>');
  expect(markup.indexOf('Create Room')).toBeLessThan(markup.indexOf('room-entry__divider'));
  expect(markup.indexOf('room-entry__divider')).toBeLessThan(markup.indexOf('>ROOM CODE</label>'));
});

test('pending creation locks inputs and actions and shows an accessible loading indicator', () => {
  const markup = renderState({ status: 'pending', action: 'create', nickname: 'Maria' });
  expect(buttons(markup).every((button) => button.includes('disabled'))).toBe(true);
  expect(buttons(markup)[0]).toContain('aria-busy="true"');
  expect(markup).toContain('room-entry__spinner');
  expect(markup).toContain('Creating Room…');
  expect(markup).toContain('role="status"');
  expect([...markup.matchAll(/<input[^>]+>/g)].every(([input]) => input.includes('disabled'))).toBe(true);
});

test('ambiguous failure offers an enabled exact retry but cannot edit the pending nickname or join', () => {
  const markup = renderState({ status: 'error', action: 'create', nickname: 'Maria', message: 'Connection lost.', retryable: true, sessionExpired: false });
  expect(buttons(markup)[0]).not.toContain('disabled');
  expect(buttons(markup)[0]).toContain('Retry Create Room');
  expect(buttons(markup)[1]).toContain('disabled');
  expect(markup).toContain('role="alert"');
  expect(markup).toContain('Connection lost.');
  expect(markup).toContain('avoid duplicate rooms or seats');
});

test('expired session has a distinct explicit reset action instead of an automatic retry', () => {
  const markup = renderState({ status: 'error', action: 'create', nickname: 'Maria', message: 'Session expired.', retryable: false, sessionExpired: true });
  expect(buttons(markup)[0]).toContain('disabled');
  expect(markup).toContain('Start a new session');
  expect(markup).not.toContain('Retry Create Room');
});

test('pending join shows loading only on Join and disables Create and both fields', () => {
  const markup = renderState({ status: 'pending', action: 'join', nickname: 'Maria', roomCode: 'ABC234' });
  expect(buttons(markup).every((button) => button.includes('disabled'))).toBe(true);
  expect(buttons(markup)[0]).toContain('aria-busy="false"');
  expect(buttons(markup)[1]).toContain('aria-busy="true"');
  expect(buttons(markup)[1]).toContain('Joining Room…');
  expect(buttons(markup)[1]).toContain('room-entry__spinner');
  expect([...markup.matchAll(/<input[^>]+>/g)].every(([input]) => input.includes('disabled'))).toBe(true);
});

test('ambiguous join failure offers only Join retry with an inline error near Join', () => {
  const markup = renderState({ status: 'error', action: 'join', nickname: 'Maria', roomCode: 'ABC234',
    message: 'Connection lost.', retryable: true, sessionExpired: false });
  expect(buttons(markup)[0]).toContain('disabled');
  expect(buttons(markup)[1]).not.toContain('disabled');
  expect(buttons(markup)[1]).toContain('Retry Join Room');
  expect(markup.indexOf('Connection lost.')).toBeGreaterThan(markup.indexOf('Retry Join Room'));
  expect(markup).not.toContain('Retry Create Room');
});

test('definitive join rejection keeps drafts editable and displays the safe server error', () => {
  const markup = renderState({ status: 'error', action: 'join', nickname: 'Maria', roomCode: 'ABC234',
    message: 'Room not found.', retryable: false, sessionExpired: false });
  expect(markup).toContain('Room not found.');
  expect([...markup.matchAll(/<input[^>]+>/g)].every(([input]) => !input.includes('disabled'))).toBe(true);
  expect(markup).toContain('value="ABC234"');
  expect(markup).toContain('value="Maria"');
});

test.each(['joined', 'resumed'] as const)('lobby handles %s membership and uses the server name without assigning host', (membership) => {
  const entry = roomEnteredFixture(entryTestId(1), 'Original name');
  const host = { seatId: entryTestId(103), nickname: 'Host', connected: true };
  const markup = renderState({ status: 'entered', entry: { ...entry, membership,
    state: { ...entry.state, hostSeatId: host.seatId, players: [host, ...entry.state.players] } } });
  expect(markup).toContain('<h1>Match setup</h1>');
  expect(markup).toContain('Original name');
  expect(markup).toContain('Waiting for Host');
  expect(markup).not.toContain('Shuffle Board');
  expect(markup).toContain('Connecting to the room');
});

test('room entry routes to the shared lobby, which waits for socket binding before enabling actions', () => {
  const markup = renderState({ status: 'entered', entry: roomEnteredFixture(entryTestId(1), 'Alex') });
  expect(markup).toContain('<h1>Match setup</h1>');
  expect(markup).toContain('Alex');
  expect(markup).toContain('ABC234</strong>');
  expect(markup).toContain('Connecting to the room');
  expect(markup).not.toContain('<form');
  const start = [...markup.matchAll(/<button\b[^>]*>.*?<\/button>/g)].find(([button]) => button.includes('Start Match'))![0];
  expect(start).toContain('disabled');
});

test('valid invitation makes joining obvious but does not autojoin', () => {
  const markup = render('Maria', '/room/abc234');
  expect(markup).toContain('value="ABC234"');
  expect(markup).toContain('You’re invited!');
  expect(buttons(markup).every((button) => !button.includes('disabled'))).toBe(true);
  expect(markup).not.toContain('role="status"');
});

test('invalid invite gives inline feedback and leaves Join disabled', () => {
  const markup = render('Maria', '/room/ABCD12');
  expect(markup).toContain('Enter a valid six-character room code.');
  expect(buttons(markup)[1]).toContain('disabled');
});

test('fields have labels, hints, mobile-friendly types, and simulator access is explicit', () => {
  const markup = render('', '/', true);
  const fields = [...markup.matchAll(/<input[^>]+>/g)].map(([field]) => field);
  for (const field of fields) {
    const id = field.match(/\bid="([^"]+)"/)![1];
    expect(markup).toContain(`for="${id}"`);
    expect(field).toContain('type="text"');
  }
  expect(fields[0]).toContain('autoComplete="nickname"');
  expect(fields[1]).toContain('autoCapitalize="characters"');
  expect(markup).toContain('href="/?preview=local"');
});
