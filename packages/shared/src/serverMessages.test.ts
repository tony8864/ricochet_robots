import { expect, expectTypeOf, test, vi } from 'vitest';
import { createMatch, prepareMatchRound, transitionMatch } from '@robot-puzzle/match';
import { starterBoard } from '@robot-puzzle/puzzles';
import { RECOMMENDED_ROUND_SETUP_BUDGET } from '@robot-puzzle/puzzles/round-setup';
import {
  BOOTSTRAP_REJECTION_REASONS, MAX_SERVER_MESSAGE_BYTES, PROTOCOL_ERROR_REASONS,
  PUBLIC_NO_OP_REASONS, PUBLIC_REJECTION_REASONS,
  parseClientRequest, parsePublicServerMessage, parseServerMessage, parseServerMessageJson,
  projectLobbyState, projectMatchState,
  type ClientRequestError, type CommandResultMessage, type ProtocolErrorReason,
  type PrivateServerMessage, type PublicServerMessage, type ServerMessage,
} from './index';
import { utf8Length } from './requestValidation';

const uuid = (number: number) => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
const roomId = uuid(1);
const seatId = uuid(2);
const commandId = `c${uuid(3).slice(1)}`;
const players = [{ seatId, nickname: 'Maria' }, { seatId: uuid(4), nickname: 'Alex' }];
const room = { roomId, roomCode: 'ABC234', revision: 5, hostSeatId: seatId };
const lobby = projectLobbyState({ ...room, lobbyId: uuid(5), puzzle: starterBoard, players: players.map((player) => ({ ...player, connected: true })) });
if (!lobby.ok) throw new Error('Valid fixture required.');
const state = lobby.value;
const base = { version: 2, serverTimeMs: 1_000 } as const;
const ack: CommandResultMessage = { ...base, type: 'command.result', roomId, commandId,
  outcome: { status: 'accepted' }, processedRevision: 5, currentRevision: 5, duplicate: false };
const messages: readonly ServerMessage[] = [
  { ...base, type: 'session.ready', commandId },
  { ...base, type: 'room.entered', commandId, roomId, seatId, membership: 'created', state },
  { ...base, type: 'session.bound', roomId, seatId, connectionId: uuid(20), state },
  { ...base, type: 'room.snapshot', state },
  ack,
  { ...base, type: 'request.rejected', commandId, reason: 'room-full' },
  { ...base, type: 'protocol.error', commandId: null, reason: 'invalid-message' },
  { ...base, type: 'room.closed', roomId, lastRevision: 5, reason: 'expired' },
];
const invalid = (value: unknown) => expect(parseServerMessage(value)).toEqual({ ok: false, error: 'invalid-message' });
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));

test.each(messages.map((message) => [message.type, message] as const))('%s validates, owns its output and JSON-round-trips', (_, message) => {
  const before = JSON.stringify(message);
  const result = parseServerMessage(Object.freeze({ ...message }));
  expect(result).toEqual({ ok: true, value: message });
  if (!result.ok) throw new Error('Expected parsed message.');
  expect(result.value).not.toBe(message);
  if ('state' in result.value && 'state' in message) {
    expect(result.value.state).not.toBe(message.state);
    expect(result.value.state.players[0]).not.toBe(message.state.players[0]);
    expect(result.value.state.puzzle.targets[0].position).not.toBe(message.state.puzzle.targets[0].position);
  }
  if (result.value.type === 'command.result' && message.type === 'command.result') expect(result.value.outcome).not.toBe(message.outcome);
  expect(parseServerMessageJson(before)).toEqual(result);
  expect(JSON.stringify(message)).toBe(before);
  expect(parseClientRequest(message).ok).toBe(false); // server messages are never player commands
});

test('public/private unions and discriminators expose only the reviewed fields', () => {
  expectTypeOf<Extract<PublicServerMessage, { type: 'session.bound' }>>().toEqualTypeOf<never>();
  expectTypeOf<Extract<PrivateServerMessage, { type: 'room.snapshot' }>>().toEqualTypeOf<never>();
  expectTypeOf<ProtocolErrorReason>().toEqualTypeOf<ClientRequestError>();
  expectTypeOf<CommandResultMessage>().not.toHaveProperty('state');
  const parsed = parseServerMessage(ack);
  if (parsed.ok && parsed.value.type === 'command.result') {
    expectTypeOf(parsed.value.processedRevision).toEqualTypeOf<number>();
    if (parsed.value.outcome.status === 'rejected') expectTypeOf(parsed.value.outcome.reason).toEqualTypeOf<(typeof PUBLIC_REJECTION_REASONS)[number]>();
  }
});

test.each(messages.map((message) => [message.type, message] as const))('%s rejects missing/extra envelope keys and recipient data in public messages', (_, message) => {
  for (const key of Object.keys(message)) {
    const altered = { ...message } as Record<string, unknown>;
    delete altered[key]; invalid(altered);
  }
  invalid({ ...message, extra: true });
  invalid({ ...message, credential: 'DO-NOT-ECHO' });
  const broadcast = parsePublicServerMessage(message);
  if (message.type === 'room.snapshot' || message.type === 'room.closed') {
    expect(broadcast).toEqual({ ok: true, value: message });
    invalid({ ...message, seatId });
    expect(parsePublicServerMessage({ ...message, seatId }).ok).toBe(false);
  } else expect(broadcast).toEqual({ ok: false, error: 'invalid-message' });
});

test.each(PUBLIC_NO_OP_REASONS)('accepts public no-op reason %s', (reason) => {
  const message: CommandResultMessage = { ...ack, outcome: { status: 'no-op', reason } };
  expect(parseServerMessageJson(JSON.stringify(message))).toEqual({ ok: true, value: message });
});
test.each(PUBLIC_REJECTION_REASONS)('accepts public rejection %s', (reason) => {
  const message: CommandResultMessage = { ...ack, outcome: { status: 'rejected', reason }, processedRevision: 7, currentRevision: 8 };
  expect(parseServerMessage(message)).toEqual({ ok: true, value: message });
});
test.each(BOOTSTRAP_REJECTION_REASONS)('accepts bootstrap rejection %s', (reason) => {
  const message = { ...base, type: 'request.rejected', commandId, reason };
  expect(parseServerMessage(message)).toEqual({ ok: true, value: message });
});
test.each(PROTOCOL_ERROR_REASONS)('accepts protocol error %s with validated ID or null', (reason) => {
  for (const correlation of [commandId, null]) {
    const message = { ...base, type: 'protocol.error', commandId: correlation, reason };
    expect(parseServerMessageJson(JSON.stringify(message))).toEqual({ ok: true, value: message });
  }
});
test.each(['expired', 'unavailable'])('accepts reviewed room closure %s', (reason) => {
  expect(parsePublicServerMessage({ ...base, type: 'room.closed', roomId, lastRevision: 0, reason }).ok).toBe(true);
});

test.each([
  { status: 'accepted', reason: 'same-bid' }, { status: 'no-op' }, { status: 'rejected' },
  { status: 'no-op', reason: 'deadline-not-due' }, { status: 'no-op', reason: 'no-active-deadline' },
  { status: 'rejected', reason: 'invalid-context' }, { status: 'rejected', reason: 'stale-preparation' },
  { status: 'rejected', reason: 'invalid-preparation' }, { status: 'rejected', reason: 'unknown-player' },
  { status: 'rejected', reason: 'SECRET-EXCEPTION' }, { status: 'accepted', credential: 'SECRET' },
  { status: 'rejected', reason: 'not-host', message: 'SECRET' }, [], null,
])('rejects malformed/internal/unreviewed command outcome %#', (outcome) => invalid({ ...ack, outcome }));

test.each([null, undefined, [], true, 'text', 0, {}, new Date(), new Map(), () => 0])('rejects non-message %#', invalid);
test.each(['room.updated', 'command.accepted', 'command.rejected', 'connection.status', 'round.prepared', 'bid.submit'])('rejects unsupported or wrong-direction type %s', (type) => invalid({ ...base, type, commandId }));
test.each([0, 1, Number.MAX_SAFE_INTEGER])('unknown protocol version %i fails closed', (version) => {
  expect(parseServerMessage({ ...messages[0], version })).toEqual({ ok: false, error: 'unsupported-version' });
});
test.each(['1', null, -1, 1.5, NaN, Infinity])('rejects malformed version %#', (version) => invalid({ ...messages[0], version }));
test.each([-1, '1000', null, 0.5, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1])('rejects unsafe timestamp %#', (serverTimeMs) => invalid({ ...messages[0], serverTimeMs }));
test.each([0, Number.MAX_SAFE_INTEGER])('accepts safe timestamp %i without reading a local clock', (serverTimeMs) => {
  expect(parseServerMessage({ ...messages[0], serverTimeMs }).ok).toBe(true);
});
test.each([-1, 0.5, '5', null, Infinity, Number.MAX_SAFE_INTEGER + 1])('rejects malformed revisions %#', (revision) => {
  invalid({ ...ack, processedRevision: revision });
  invalid({ ...ack, currentRevision: revision });
  invalid({ ...messages[7], lastRevision: revision });
});
test('checks revision ordering and duplicate boolean without inventing request history', () => {
  invalid({ ...ack, processedRevision: 6, currentRevision: 5 });
  invalid({ ...ack, duplicate: 'true' });
  expect(parseServerMessage({ ...ack, processedRevision: 0, currentRevision: Number.MAX_SAFE_INTEGER, duplicate: true }).ok).toBe(true);
  expect(parseServerMessage({ ...ack, processedRevision: 5, currentRevision: 8, duplicate: false }).ok).toBe(true);
});
test.each(['', 'not-an-id', commandId.toUpperCase(), null, 1])('rejects malformed correlation ID %# except protocol null', (badId) => {
  invalid({ ...ack, commandId: badId });
  invalid({ ...messages[0], commandId: badId });
  invalid({ ...messages[5], commandId: badId });
  if (badId !== null) invalid({ ...messages[6], commandId: badId });
});

test.each(['created', 'joined', 'resumed'])('membership %s binds only to a seat in the matching room', (membership) => {
  const message = { ...base, type: 'room.entered', commandId, roomId, seatId, membership, state };
  expect(parseServerMessage(message).ok).toBe(true);
  invalid({ ...message, roomId: uuid(99) });
  invalid({ ...message, seatId: uuid(99) });
  invalid({ ...message, membership: 'host' });
  invalid({ ...message, state: { ...state, roomId: uuid(99) } });
});
test('socket binding also validates room, membership and complete nested state', () => {
  const message = messages[2];
  invalid({ ...message, roomId: uuid(99) });
  invalid({ ...message, seatId: uuid(99) });
  invalid({ ...message, state: { ...state, players: [] } });
  invalid({ ...message, state: { ...state, credentialHash: 'SECRET' } });
  const bad = clone(state);
  Object.assign(bad.puzzle.board.walls[0].first, { secret: 'SECRET' });
  invalid({ ...messages[3], state: bad });
});

test('a resumed or retried creation reply may contain the latest active match, not only lobby', () => {
  const initial = createMatch({ matchId: uuid(10), players, puzzle: starterBoard });
  const thinking = prepareMatchRound(initial, { candidateOrder: starterBoard.targets.map((target) => target.id), budget: RECOMMENDED_ROUND_SETUP_BUDGET }).state;
  const bidding = transitionMatch(thinking, { source: 'player', command: { type: 'bid.submit', value: 7 }, context: { actorSeatId: seatId, hostSeatId: seatId, nowMs: 1_000 } }).state;
  if (bidding.phase !== 'bidding') throw new Error('Expected bidding.');
  const demo = transitionMatch(bidding, { source: 'controller', command: { type: 'time.advance' }, context: { nowMs: bidding.deadlineAtMs } }).state;
  if (demo.phase !== 'demonstrating') throw new Error('Expected demonstration.');
  const projected = projectMatchState({ ...room, revision: 9, match: demo,
    connections: { [seatId]: true, [players[1].seatId]: false },
    attempt: { matchId: demo.matchId, roundNumber: demo.round.number, activeBidderIndex: 0, seatId, id: uuid(11), version: 0 },
  });
  if (!projected.ok) throw new Error('Expected public state.');
  for (const membership of ['created', 'resumed']) {
    const message = { ...base, type: 'room.entered', commandId, roomId, seatId, membership, state: projected.value };
    expect(parseServerMessage(message)).toEqual({ ok: true, value: message });
  }
  expect(parseServerMessage({ ...messages[2], state: projected.value }).ok).toBe(true);
});

test.each([
  ['original', { ...ack }],
  ['retry', { ...ack, currentRevision: 8, duplicate: true }],
  ['ID conflict', { ...ack, outcome: { status: 'rejected', reason: 'command-id-conflict' }, processedRevision: 8, currentRevision: 8 }],
  ['late bid', { ...ack, outcome: { status: 'rejected', reason: 'bidding-closed' }, processedRevision: 9, currentRevision: 9 }],
  ['old attempt', { ...ack, outcome: { status: 'rejected', reason: 'stale-context' }, processedRevision: 10, currentRevision: 10 }],
] as const)('%s contract preserves correlation/outcome/revisions without executing deduplication', (_, message) => {
  expect(parseServerMessage(message)).toEqual({ ok: true, value: message });
  expect(message.commandId).toBe(commandId);
  expect(message).not.toHaveProperty('robots');
  expect(message).not.toHaveProperty('scores');
});

test('snapshot parsing is stateless: ordering and rematch reconciliation remain integration duties', () => {
  const old = { ...base, type: 'room.snapshot', state: { ...state, revision: 5 } };
  const newer = { ...base, type: 'room.snapshot', state: { ...state, revision: 8 } };
  const rematchLobby = { ...base, type: 'room.snapshot', state: { ...state, revision: 9, lobbyId: uuid(99) } };
  for (const message of [newer, old, rematchLobby]) expect(parseServerMessage(message)).toEqual({ ok: true, value: message });
  const resend = parseServerMessage({ ...old, serverTimeMs: 20_000 });
  if (!resend.ok || resend.value.type !== 'room.snapshot') throw new Error('Expected snapshot.');
  expect(resend.value.state).toEqual(old.state); // send-time metadata does not advance revision
  expect(parseServerMessage({ ...old, state: { ...state, roomId: uuid(100), revision: 0 } }).ok).toBe(true); // distinct scope
});

test.each(['not-host', 'SECRET', null])('bootstrap/protocol/closure reasons do not accept arbitrary or cross-domain codes %#', (reason) => {
  invalid({ ...messages[5], reason });
  invalid({ ...messages[6], reason });
  invalid({ ...messages[7], reason });
});

test('JSON parser enforces total UTF-8 bytes before parsing, with exact limit and multibyte boundaries', () => {
  const text = JSON.stringify(messages[0]);
  expect(parseServerMessageJson(text + ' '.repeat(MAX_SERVER_MESSAGE_BYTES - text.length)).ok).toBe(true);
  expect(parseServerMessageJson(text + ' '.repeat(MAX_SERVER_MESSAGE_BYTES - text.length + 1))).toEqual({ ok: false, error: 'message-too-large' });
  expect(parseServerMessageJson('"' + '😀'.repeat(16_384) + '"')).toEqual({ ok: false, error: 'message-too-large' });
  expect(parseServerMessageJson('"' + 'é'.repeat(32_768) + '"')).toEqual({ ok: false, error: 'message-too-large' });
  expect(parseServerMessageJson('{'.repeat(MAX_SERVER_MESSAGE_BYTES + 1))).toEqual({ ok: false, error: 'message-too-large' });
  expect(utf8Length(JSON.stringify(messages[1]))).toBeLessThan(MAX_SERVER_MESSAGE_BYTES);
});
test.each(['', '{', 'undefined', '{"version":1,}', '\uFEFF{}'])('malformed JSON %# returns a bounded error', (text) => {
  expect(parseServerMessageJson(text)).toEqual({ ok: false, error: 'invalid-json' });
});
test.each([null, {}, new Uint8Array(1)])('JSON API rejects non-text %#', (text) => {
  expect(parseServerMessageJson(text)).toEqual({ ok: false, error: 'invalid-message' });
});

test('secret fields, hidden data, getters, and malformed nested outcomes cannot leak via errors', () => {
  const secret = 'NEVER-ECHO-THIS-COOKIE';
  const getter = vi.fn(() => { throw new Error(secret); });
  const inputs = [
    { ...messages[0], credential: secret }, { ...messages[1], sessionId: secret },
    { ...messages[3], serverTimeMs: secret }, { ...ack, outcome: { status: 'rejected', reason: secret } },
    Object.defineProperty({ ...ack }, 'serverTimeMs', { get: getter, enumerable: true }),
    { ...ack, outcome: Object.defineProperty({}, 'status', { get: getter, enumerable: true }) },
    Object.assign({ ...ack }, { [Symbol('credential')]: secret }),
    Object.defineProperty({ ...ack }, 'private', { value: secret }),
    Object.create(ack), new Proxy({}, { getPrototypeOf() { throw new Error(secret); } }),
  ];
  for (const input of inputs) {
    const parsed = parseServerMessage(input);
    expect(parsed).toEqual({ ok: false, error: 'invalid-message' });
    expect(JSON.stringify(parsed)).not.toContain(secret);
  }
  expect(getter).not.toHaveBeenCalled();
});
