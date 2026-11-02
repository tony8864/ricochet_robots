import { expect, test } from 'vitest';
import { parseSocketMessageJson, parseClientRequest, parseServerMessage, parsePublicServerMessage } from './index';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ping = { version: 2, type: 'connection.ping', roomId: id(1), connectionId: id(2), sequence: 1 };
const parse = (value: unknown) => parseSocketMessageJson(JSON.stringify(value));

test('heartbeat is transport-only, exact, copied and never a public broadcast', () => {
  expect(parse(ping)).toEqual({ ok: true, value: ping });
  expect(parseClientRequest(ping).ok).toBe(false);
  const pong = { version: 2, type: 'connection.pong', connectionId: id(2), sequence: 1, serverTimeMs: 100 };
  expect(parseServerMessage(pong)).toEqual({ ok: true, value: pong });
  expect(parsePublicServerMessage(pong).ok).toBe(false);
  expect(parse(pong).ok).toBe(false);
});

test.each([0, -1, 1.1, '1', null, Number.MAX_SAFE_INTEGER + 1])('rejects unsafe heartbeat sequence %j', (sequence) => {
  expect(parse({ ...ping, sequence }).ok).toBe(false);
  expect(parseServerMessage({ version: 2, type: 'connection.pong', connectionId: ping.connectionId, sequence, serverTimeMs: 100 }).ok).toBe(false);
});

test.each(['roomId', 'connectionId', 'sequence', 'version', 'type'])('requires heartbeat field %s', (key) => {
  const altered: Record<string, unknown> = { ...ping }; delete altered[key]; expect(parse(altered).ok).toBe(false);
});

test('heartbeat cannot supply identity, clock or unknown fields and remains byte bounded', () => {
  for (const field of ['sessionId', 'seatId', 'credential', 'nowMs', 'commandId']) expect(parse({ ...ping, [field]: 'secret' }).ok).toBe(false);
  expect(parse({ ...ping, version: 1 })).toEqual({ ok: false, error: 'unsupported-version' });
  expect(parseSocketMessageJson('{')).toEqual({ ok: false, error: 'invalid-json' });
  expect(parseSocketMessageJson('é'.repeat(2049))).toEqual({ ok: false, error: 'message-too-large' });
});

test('historical retry is lookup-only shape, same room/id, and cannot nest or inject', () => {
  const originalRequest = { version: 1, roomId: id(1), commandId: id(3), context: {}, command: { type: 'state.request' } };
  const retry = { ...originalRequest, version: 2, command: { type: 'command.retry', originalRequest } };
  expect(parseClientRequest(originalRequest)).toEqual({ ok: false, error: 'unsupported-version' });
  expect(parseClientRequest(retry)).toEqual({ ok: true, value: retry });
  for (const changed of [ { ...originalRequest, version: 2 }, { ...originalRequest, roomId: id(4) },
    { ...originalRequest, commandId: id(5) }, { ...originalRequest, command: retry.command },
    { ...originalRequest, command: { type: 'state.request', credential: 'secret' } } ]) {
    expect(parseClientRequest({ ...retry, command: { type: 'command.retry', originalRequest: changed } }).ok).toBe(false);
  }
});
