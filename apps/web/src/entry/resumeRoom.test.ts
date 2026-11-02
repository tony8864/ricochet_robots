import { afterEach, expect, test, vi } from 'vitest';
import { resumeRoom } from './resumeRoom';
import { entryTestId, roomEnteredFixture } from './roomEntry.testFixture';

afterEach(() => { vi.useRealTimers(); });
const entry = { ...roomEnteredFixture(entryTestId(1)), membership: 'resumed' as const };
const commandId = entry.commandId;
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });

test('resume uses only the existing cookie endpoint, with validated ID and no session creation', async () => {
  const fetcher = vi.fn(async () => json(entry));
  expect(await resumeRoom(entry.roomId, new AbortController().signal, fetcher, commandId)).toEqual({ status: 'resumed', entry });
  expect(fetcher).toHaveBeenCalledOnce();
  const [path, options] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
  expect(path).toBe(`/api/rooms/${entry.roomId}/resume`); expect(options.credentials).toBe('same-origin');
  expect(JSON.parse(options.body as string)).toEqual({ version: 2, commandId, command: { type: 'session.resume', roomId: entry.roomId } });
  expect(options.headers).not.toHaveProperty('Cookie');
  expect((await resumeRoom('../api/session', new AbortController().signal, fetcher, commandId)).status).toBe('error');
  expect(fetcher).toHaveBeenCalledOnce();
});

test.each([
  ['not-authenticated', 'expired'], ['seat-not-found', 'expired'], ['room-not-found', 'closed'],
  ['rate-limited', 'transient'], ['temporarily-unavailable', 'transient'],
] as const)('resume rejection %s maps to %s without a replacement identity', async (reason, status) => {
  const fetcher = vi.fn(async () => json({ version: 2, type: 'request.rejected', commandId, reason, serverTimeMs: 100 }, 409));
  expect((await resumeRoom(entry.roomId, new AbortController().signal, fetcher, commandId)).status).toBe(status);
  expect(fetcher).toHaveBeenCalledOnce();
});

test.each([
  { ...entry, commandId: entryTestId(999) }, { ...entry, membership: 'joined' }, { ...entry, version: 1 },
  { ...entry, credential: 'secret' }, { version: 2, type: 'session.ready', commandId, serverTimeMs: 100 },
])('malformed/mismatched bootstrap cannot bind a room %#', async (value) => {
  expect((await resumeRoom(entry.roomId, new AbortController().signal, async () => json(value), commandId)).status).toBe('error');
});

test('malformed UTF-8, JSON and oversized bodies halt rather than looping', async () => {
  for (const body of [new Uint8Array([0xff]), '{', 'x'.repeat(65537)]) {
    const result = await resumeRoom(entry.roomId, new AbortController().signal,
      async () => new Response(body, { headers: { 'Content-Type': 'application/json' } }), commandId);
    expect(result.status).toBe('error');
  }
});

test('network failure is transient and resume timeout/outer cancellation abort outstanding fetch', async () => {
  const failed = await resumeRoom(entry.roomId, new AbortController().signal, async () => { throw new TypeError('network'); }, commandId);
  expect(failed.status).toBe('transient');
  vi.useFakeTimers();
  let signal: AbortSignal | undefined;
  const fetcher: typeof fetch = async (_input, init) => new Promise((_resolve, reject) => {
    signal = init?.signal ?? undefined; signal?.addEventListener('abort', () => reject(new Error('aborted')));
  });
  const promise = resumeRoom(entry.roomId, new AbortController().signal, fetcher, commandId);
  await vi.advanceTimersByTimeAsync(10000); expect((await promise).status).toBe('transient'); expect(signal?.aborted).toBe(true);
});
