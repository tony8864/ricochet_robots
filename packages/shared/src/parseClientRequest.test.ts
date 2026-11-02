import { describe, expect, expectTypeOf, test, vi } from 'vitest';
import type { PlayerMatchCommand } from '@robot-puzzle/match';
import {
  MAX_CLIENT_MESSAGE_BYTES, parseClientRequest, parseClientRequestJson,
  type AttemptContext, type BootstrapRequest, type ClientRequest,
  type RoomRequest,
} from './index';

const commandId = 'c0000000-0000-4000-8000-000000000001';
const roomId = '10000000-0000-4000-8000-000000000001';
const matchId = '20000000-0000-4000-8000-000000000001';
const attemptId = '30000000-0000-4000-8000-000000000001';
const lobbyId = '40000000-0000-4000-8000-000000000001';
const round = { matchId, roundNumber: 1 };
const attempt = { ...round, attemptId, attemptVersion: 0 };
const bootstrap = (command: unknown) => ({ version: 2, commandId, command });
const room = (command: unknown, context: unknown = round) => ({ ...bootstrap(command), roomId, context });
const bid = (value: unknown) => room({ type: 'bid.submit', value });
const create = (nickname: unknown) => bootstrap({ type: 'room.create', nickname });
const join = (roomCode: unknown, nickname: unknown = 'Maria') => bootstrap({ type: 'room.join', roomCode, nickname });
const rejected = (value: unknown) => expect(parseClientRequest(value)).toEqual({ ok: false, error: 'invalid-message' });

test('End Room accepts exactly a lobby or match binding and explicit boolean confirmation, never actor/time authority', () => {
  for (const context of [{ lobbyId }, { matchId }]) {
    const request = room({ type: 'room.end', confirmed: true }, context);
    expect(parseClientRequest(request)).toEqual({ ok: true, value: request });
    expect(parseClientRequest(room({ type: 'room.end', confirmed: false }, context)).ok).toBe(true);
    rejected(room({ type: 'room.end', confirmed: true }, { ...context, actorSeatId: lobbyId }));
    rejected(room({ type: 'room.end', confirmed: true, nowMs: 0 }, context));
    rejected(room({ type: 'command.retry', originalRequest: { ...request, version: 1 } }, {}));
  }
  rejected(room({ type: 'room.end', confirmed: true }, {}));
  rejected(room({ type: 'room.end', confirmed: true }, { lobbyId, matchId }));
  rejected(room({ type: 'room.end', confirmed: 'true' }, { lobbyId }));
});

test('skip-disconnected requires exact attempt/absence context and boolean confirmation, never legacy execution', () => {
  const valid = room({ type: 'attempt.skipDisconnected', confirmed: true }, { ...attempt, disconnectId: lobbyId });
  expect(parseClientRequest(valid)).toEqual({ ok: true, value: valid });
  expect(parseClientRequest({ ...valid, command: { type: 'attempt.skipDisconnected', confirmed: false } }).ok).toBe(true);
  for (const invalid of [room({ type: 'attempt.skipDisconnected', confirmed: true }, attempt),
    room({ type: 'attempt.skipDisconnected', confirmed: true }, { ...attempt, disconnectId: 'x' }),
    { ...valid, command: { type: 'attempt.skipDisconnected', confirmed: 'true' } },
    { ...valid, context: { ...attempt, disconnectId: lobbyId, actorSeatId: lobbyId } }]) rejected(invalid);
  rejected(room({ type: 'command.retry', originalRequest: { ...valid, version: 1 } }, {}));
});

const valid: readonly ClientRequest[] = [
  { version: 2, commandId, roomId, context: { matchId, preparationId: attemptId }, command: { type: 'preparation.retry' } },
  { version: 2, commandId, command: { type: 'session.open' } },
  { version: 2, commandId, command: { type: 'room.create', nickname: 'Maria' } },
  { version: 2, commandId, command: { type: 'room.join', nickname: 'Maria', roomCode: 'ABC234' } },
  { version: 2, commandId, command: { type: 'session.resume', roomId } },
  { version: 2, commandId, roomId, context: {}, command: { type: 'state.request' } },
  { version: 2, commandId, roomId, context: { lobbyId }, command: { type: 'board.shuffle' } },
  { version: 2, commandId, roomId, context: { lobbyId }, command: { type: 'room.start', boardId: 'crossroads' } },
  { version: 2, commandId, roomId, context: { matchId, roundNumber: 1 }, command: { type: 'bid.submit', value: 7 } },
  { version: 2, commandId, roomId, context: { matchId, roundNumber: 1, attemptId, attemptVersion: 0 }, command: { type: 'attempt.move', robotId: 'red', direction: 'right' } },
  { version: 2, commandId, roomId, context: { matchId, roundNumber: 1, attemptId, attemptVersion: 0 }, command: { type: 'attempt.undo' } },
  { version: 2, commandId, roomId, context: { matchId, roundNumber: 1, attemptId, attemptVersion: 0 }, command: { type: 'attempt.reset' } },
  { version: 2, commandId, roomId, context: { matchId, roundNumber: 1, attemptId, attemptVersion: 0 }, command: { type: 'attempt.giveUp' } },
  { version: 2, commandId, roomId, context: { matchId, roundNumber: 1 }, command: { type: 'round.skip', confirmed: true } },
  { version: 2, commandId, roomId, context: { matchId, roundNumber: 10 }, command: { type: 'round.continue' } },
  { version: 2, commandId, roomId, context: { matchId }, command: { type: 'match.returnToLobby' } },
];

test('preparation retry rejects client authority and stale-shaped contexts structurally', () => {
  const context = { matchId, preparationId: attemptId };
  for (const command of [
    { type: 'preparation.retry', budget: 999999 }, { type: 'preparation.retry', targetId: 'red-star' },
    { type: 'preparation.retry', candidateOrder: [] }, { type: 'preparation.retry', hostSeatId: commandId },
  ]) rejected(room(command, context));
  for (const invalidContext of [{ matchId }, { preparationId: attemptId }, { ...context, roundNumber: 1 }, { ...context, preparationId: 'bad' }]) {
    rejected(room({ type: 'preparation.retry' }, invalidContext));
  }
});

describe('reviewed request inventory', () => {
  test.each(valid.map((request) => [request.command.type, request] as const))('%s validates, owns its output, and round-trips', (_, request) => {
    const frozen = Object.freeze({ ...request, command: Object.freeze({ ...request.command }) });
    const result = parseClientRequest(frozen);
    expect(result).toEqual({ ok: true, value: request });
    if (!result.ok) throw new Error('Expected request.');
    expect(result.value).not.toBe(frozen);
    expect(result.value.command).not.toBe(frozen.command);
    if ('context' in result.value && 'context' in frozen) expect(result.value.context).not.toBe(frozen.context);
    expect(parseClientRequestJson(JSON.stringify(request))).toEqual(result);
  });

  test('validated types retain the public domain commands without exposing controller actions', () => {
    type Move = Extract<RoomRequest, { command: { type: 'attempt.move' } }>;
    expectTypeOf<Move['command']>().toEqualTypeOf<Extract<PlayerMatchCommand, { type: 'attempt.move' }>>();
    expectTypeOf<Move['context']>().toEqualTypeOf<AttemptContext>();
    expectTypeOf<Extract<RoomRequest['command'], { type: 'time.advance' }>>().toEqualTypeOf<never>();
    expectTypeOf<BootstrapRequest>().not.toHaveProperty('roomId');
    expectTypeOf<Extract<BootstrapRequest, { command: { type: 'room.create' } }>['command']>()
      .toEqualTypeOf<{ readonly type: 'room.create'; readonly nickname: string }>();
    const result = parseClientRequest(bid(3));
    if (result.ok && result.value.command.type === 'bid.submit') {
      expectTypeOf(result.value.command.value).toEqualTypeOf<number>();
      expectTypeOf(result.value.command).toEqualTypeOf<Extract<PlayerMatchCommand, { type: 'bid.submit' }>>();
    }
  });
});

describe('strict envelopes, IDs, and contexts', () => {
  test.each([null, undefined, [], 1, 'text', true, {}, new Date(), new Map(), () => 0])('rejects non-request input %#', rejected);

  test.each(valid.map((request) => [request.command.type, request] as const))('%s rejects extra and missing keys at every boundary', (_, request) => {
    const value = { ...request } as Record<string, unknown>;
    for (const key of Object.keys(value)) {
      const missing = { ...value };
      delete missing[key];
      rejected(missing);
    }
    rejected({ ...value, extra: 'secret-cookie-value' });
    rejected({ ...value, command: { ...request.command, extra: true } });
    for (const key of Object.keys(request.command)) {
      const missing = { ...request.command } as Record<string, unknown>;
      delete missing[key];
      rejected({ ...value, command: missing });
    }
    if ('context' in request) {
      rejected({ ...value, context: { ...request.context, extra: true } });
      rejected({ ...value, context: null });
      rejected({ ...value, context: [] });
      for (const key of Object.keys(request.context)) {
        const missing = { ...request.context } as Record<string, unknown>;
        delete missing[key];
        rejected({ ...value, context: missing });
      }
    } else {
      rejected({ ...value, roomId });
      rejected({ ...value, context: {} });
    }
  });

  test.each(['', 'x', commandId.toUpperCase(), ` ${commandId}`, `${commandId} `,
    commandId.replace('-4000-', '-1000-'), commandId.replace('-8000-', '-7000-'), null, 7])('rejects noncanonical command IDs %#', (id) => rejected({ ...bid(1), commandId: id }));

  test('checks all contextual IDs rather than only the envelope ID', () => {
    rejected({ ...bid(1), roomId: 'other' });
    rejected(room({ type: 'bid.submit', value: 1 }, { ...round, matchId: 'other' }));
    rejected(room({ type: 'board.shuffle' }, { lobbyId: 'other' }));
    rejected(room({ type: 'attempt.reset' }, { ...attempt, attemptId: 'other' }));
    rejected(room({ type: 'match.returnToLobby' }, { matchId: 'other' }));
    rejected(bootstrap({ type: 'session.resume', roomId: 'other' }));
  });

  test.each([0, 11, -1, 1.5, '1', NaN, Infinity, null])('rejects invalid round %#', (roundNumber) => rejected(room({ type: 'round.continue' }, { matchId, roundNumber })));
  test.each([-1, 0.5, '0', Infinity, Number.MAX_SAFE_INTEGER + 1, null])('rejects invalid attempt version %#', (attemptVersion) => rejected(room({ type: 'attempt.undo' }, { ...attempt, attemptVersion })));
  test.each([1, 10])('accepts round boundary %i without judging its current phase', (roundNumber) => expect(parseClientRequest(room({ type: 'round.continue' }, { matchId, roundNumber })).ok).toBe(true));
  test.each([0, Number.MAX_SAFE_INTEGER])('accepts safe attempt version %i', (attemptVersion) => expect(parseClientRequest(room({ type: 'attempt.reset' }, { ...attempt, attemptVersion })).ok).toBe(true));

  test('rejects wrong context variants and does not accept observed revision as authority', () => {
    rejected(room({ type: 'attempt.undo' }, round));
    rejected(room({ type: 'bid.submit', value: 3 }, attempt));
    rejected(room({ type: 'state.request' }, round));
    rejected(room({ type: 'room.start', boardId: 'crossroads' }, round));
    rejected(room({ type: 'bid.submit', value: 3 }, { ...round, expectedRevision: 9 }));
    rejected({ ...bid(3), expectedRevision: 9 });
  });
});

describe('payloads and normalization', () => {
  test.each([0, -0, -1, 1.2, '7', null, undefined, true, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1, {}, [], 3n])('rejects invalid bid %#', (value) => rejected(bid(value)));
  test.each([1, 7, 500, Number.MAX_SAFE_INTEGER])('accepts positive bid %i with no competing-bid comparison', (value) => expect(parseClientRequest(bid(value)).ok).toBe(true));
  test.each(['red', 'blue', 'green', 'yellow'])('accepts robot %s with every cardinal direction', (robotId) => {
    for (const direction of ['up', 'right', 'down', 'left']) expect(parseClientRequest(room({ type: 'attempt.move', robotId, direction }, attempt)).ok).toBe(true);
  });
  test.each([{ robotId: 'black', direction: 'up' }, { robotId: 'RED', direction: 'up' }, { robotId: 'red', direction: 'north' }, { robotId: 'red', direction: 1 }])('rejects bad movement %#', (move) => rejected(room({ type: 'attempt.move', ...move }, attempt)));
  test.each([true, false])('confirmation %s is structural, not permission to skip', (confirmed) => expect(parseClientRequest(room({ type: 'round.skip', confirmed })).ok).toBe(true));
  test.each([1, 'true', null])('rejects non-boolean confirmation %#', (confirmed) => rejected(room({ type: 'round.skip', confirmed })));

  test.each(['a', '-'.repeat(64)])('accepts board ID boundary %s', (boardId) => expect(parseClientRequest(room({ type: 'room.start', boardId }, { lobbyId })).ok).toBe(true));
  test.each(['', 'a'.repeat(65), 'Crossroads', '../board', 'é', 'board_name', null])('rejects invalid board ID %#', (boardId) => rejected(room({ type: 'room.start', boardId }, { lobbyId })));

  test('normalizes nickname with trim and NFC, preserving internal spaces/case and not mutating input', () => {
    const input = create('  Jose\u0301  Smith  ');
    expect(parseClientRequest(input)).toEqual({ ok: true, value: create('José  Smith') });
    expect(input.command).toEqual({ type: 'room.create', nickname: '  Jose\u0301  Smith  ' });
    // No roster uniqueness or deduplication rule is enforced by structural parsing.
    expect(parseClientRequest(create('Maria')).ok).toBe(true);
    expect(parseClientRequest({ ...create('Maria'), commandId: 'c0000000-0000-4000-8000-000000000002' }).ok).toBe(true);
  });
  test.each(['A', 'a'.repeat(24), '😀'.repeat(24), 'é'.repeat(24), 'e\u0301'.repeat(24), ' '.repeat(127) + 'a' + ' '.repeat(128)])('accepts nickname limits %#', (name) => expect(parseClientRequest(create(name)).ok).toBe(true));
  test.each(['', '   ', 'a'.repeat(25), '😀'.repeat(25), ' '.repeat(256) + 'a', 'é'.repeat(129), null, 1])('rejects nickname limits/types %#', (name) => rejected(create(name)));
  test.each(['\nMaria', 'Maria\t', 'Ma\u0000ria', 'Ma\u007fria', 'Ma\u0085ria', 'Ma\u2028ria', 'Ma\u2029ria', 'Ma\u202eria', 'Ma\u2067ria'])('rejects nickname controls %#', (name) => rejected(create(name)));

  test('normalizes room code before parsing without accepting Unicode lookalikes', () => {
    expect(parseClientRequest(join('  abc234  '))).toEqual({ ok: true, value: join('ABC234') });
    expect(parseClientRequest(join(' '.repeat(5) + 'ABC234' + ' '.repeat(5))).ok).toBe(true); // exactly 16 raw ASCII chars
  });
  test.each(['', 'ABC23', 'ABC2345', 'ABC230', 'ABC231', 'ABCI23', 'ABCO23', 'ＡBC234', 'ſBC234', 'ABC 23', ' '.repeat(6) + 'ABC234' + ' '.repeat(5), null])('rejects room code %#', (code) => rejected(join(code)));
});

describe('safe JSON boundary and authority separation', () => {
  test.each([1, 0, Number.MAX_SAFE_INTEGER])('reports unsupported version %i without coercion', (version) => expect(parseClientRequest({ ...bid(1), version })).toEqual({ ok: false, error: 'unsupported-version' }));
  test.each(['1', 1.5, NaN, Infinity, -1, null])('rejects malformed version %#', (version) => rejected({ ...bid(1), version }));
  test.each(['', '{', 'undefined', '{"version":1,}', '\uFEFF{}'])('reports malformed JSON %#', (text) => expect(parseClientRequestJson(text)).toEqual({ ok: false, error: 'invalid-json' }));
  test.each([null, {}, new Uint8Array(1)])('JSON entry point rejects non-text %#', (text) => expect(parseClientRequestJson(text)).toEqual({ ok: false, error: 'invalid-message' }));

  test('enforces exact encoded byte limit before JSON parsing, including multibyte text', () => {
    const text = JSON.stringify(valid[0]);
    expect(parseClientRequestJson(text + ' '.repeat(MAX_CLIENT_MESSAGE_BYTES - text.length)).ok).toBe(true);
    expect(parseClientRequestJson(text + ' '.repeat(MAX_CLIENT_MESSAGE_BYTES - text.length + 1))).toEqual({ ok: false, error: 'message-too-large' });
    // Fewer than 4096 UTF-16 code units but more than 4096 UTF-8 bytes.
    expect(parseClientRequestJson('"' + '😀'.repeat(1024) + '"')).toEqual({ ok: false, error: 'message-too-large' });
    expect(parseClientRequestJson('"' + 'é'.repeat(2048) + '"')).toEqual({ ok: false, error: 'message-too-large' });
    expect(parseClientRequestJson('{'.repeat(4097))).toEqual({ ok: false, error: 'message-too-large' });
  });

  test.each(['actorSeatId', 'hostSeatId', 'nowMs', 'scores', 'robots', 'internalProof', 'credential', 'source'])('rejects injected %s without echoing secrets', (field) => {
    const secret = 'DO-NOT-ECHO-THIS-COOKIE';
    for (const value of [
      { ...bid(7), [field]: secret },
      room({ type: 'bid.submit', value: 7, [field]: secret }),
      room({ type: 'bid.submit', value: 7 }, { ...round, [field]: secret }),
    ]) {
      rejected(value);
      expect(JSON.stringify(parseClientRequest(value))).not.toContain(secret);
    }
  });
  test.each(['time.advance', 'round.advance', 'round.prepared', 'round.retryPreparation', 'room.leave', 'host.transfer', 'success', 'actAs', 'room.snapshot'])('rejects internal/deferred/unknown command %s', (type) => rejected(room({ type })));

  test('rejects inherited, symbolic, hidden, and accessor fields without invoking getters', () => {
    rejected(Object.create(bid(1)));
    rejected({ ...bid(1), command: Object.create({ type: 'bid.submit', value: 1 }) });
    rejected({ ...bid(1), [Symbol('credential')]: 'secret' });
    rejected(Object.defineProperty(bid(1), 'secret', { value: 'secret' }));
    const getter = vi.fn(() => { throw new Error('secret'); });
    for (const value of [
      Object.defineProperty(bid(1), 'version', { get: getter, enumerable: true }),
      { ...bid(1), command: Object.defineProperty({ type: 'bid.submit' }, 'value', { get: getter, enumerable: true }) },
      room({ type: 'attempt.undo' }, Object.defineProperty({ ...attempt }, 'attemptId', { get: getter, enumerable: true })),
    ]) rejected(value);
    expect(getter).not.toHaveBeenCalled();
    rejected(new Proxy({}, { getPrototypeOf() { throw new Error('secret'); } }));
    rejected(JSON.parse('{"version":1,"commandId":"' + commandId + '","command":{"type":"session.open"},"__proto__":{"hostSeatId":"secret"}}'));
    const nullPrototype = Object.assign(Object.create(null), valid[0]);
    expect(parseClientRequest(nullPrototype).ok).toBe(true);
  });
});
