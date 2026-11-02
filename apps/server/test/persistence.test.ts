import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { build } from 'esbuild';
import { Miniflare } from 'miniflare';
import { expect, test } from 'vitest';
import type { OpenSessionResult } from '../src/sessions';
import { parseServerMessage } from '@robot-puzzle/shared';
import type { ServerMessage, PublicRoomState } from '@robot-puzzle/shared';
import type { CreationRecord } from '../src/creations';

async function openRuntimeSocket(runtime: Miniflare, roomId: string, headers: Record<string, string>) {
  const response = await runtime.dispatchFetch(`https://localhost:5173/api/rooms/${roomId}/socket`, {
    headers: { ...headers, Upgrade: 'websocket' },
  });
  expect(response.status).toBe(101);
  const socket = response.webSocket;
  if (!socket) throw new Error('Expected runtime socket');
  const messages: ServerMessage[] = [];
  const waiters: Array<{ predicate: (m: ServerMessage) => boolean; resolve: (m: ServerMessage) => void }> = [];
  const closed = new Promise<void>((resolveClose) => socket.addEventListener('close', () => {
    if (socket.readyState === 2) socket.close();
    resolveClose();
  }));
  socket.addEventListener('message', (event) => {
    const parsed = parseServerMessage(JSON.parse(String(event.data)));
    if (!parsed.ok) throw new Error('Invalid runtime message');
    const index = waiters.findIndex((w) => w.predicate(parsed.value));
    if (index < 0) messages.push(parsed.value);
    else waiters.splice(index, 1)[0].resolve(parsed.value);
  });
  socket.accept();
  function next(predicate: (m: ServerMessage) => boolean): Promise<ServerMessage> {
    const index = messages.findIndex(predicate);
    if (index >= 0) return Promise.resolve(messages.splice(index, 1)[0]);
    return new Promise((resolveMessage) => waiters.push({ predicate, resolve: resolveMessage }));
  }
  return { socket, next, closed };
}

test.each(['reserved', 'initialized', 'started'])('sessions and %s room state survive full runtime shutdown/recreation', async (phase) => {
  const { outputFiles } = await build({
    entryPoints: ['test/persistence.worker.ts'],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    external: ['cloudflare:workers'],
  });
  const directory = await mkdtemp(join(tmpdir(), 'rr-t14-persistence-'));
  function start(persistPath: string) {
    return new Miniflare({
      modules: true,
      script: outputFiles[0].text,
      compatibilityDate: '2025-10-11',
      host: '127.0.0.1',
      port: 0,
      bindings: { APP_ENV: 'local', ALLOWED_ORIGINS: 'https://localhost:5173' },
      durableObjects: {
        REGISTRY: { className: 'Registry', useSQLite: true },
        ROOMS: { className: 'Room', useSQLite: true },
      },
      durableObjectsPersist: persistPath,
    });
  }

  let runtime = start(join(directory, 'saved'));
  try {
    for (const path of ['registry', 'room']) {
      const response = await runtime.dispatchFetch(`https://test.invalid/${path}`, {
        method: 'PUT', body: `${path}-saved`,
      });
      expect(await response.json()).toEqual({ version: 1, marker: `${path}-saved` });
    }

    const sessionResponse = await runtime.dispatchFetch('https://test.invalid/test-session', {
      method: 'POST', headers: { 'X-Test-Time': '1000000' },
    });
    const opened = await sessionResponse.json() as OpenSessionResult;
    if (opened.status !== 'ready' || !opened.credential) throw new Error('Expected test session');

    const post = (type: string, commandId: string) => JSON.stringify({
      version: 2, commandId, command: type === 'session.open' ? { type } : { type, nickname: 'Maria' },
    });
    const commonHeaders = { Origin: 'https://localhost:5173', 'Content-Type': 'application/json' };
    const realSession = await runtime.dispatchFetch('https://localhost:5173/api/session', {
      method: 'POST', headers: commonHeaders, body: post('session.open', crypto.randomUUID()),
    });
    expect(realSession.status).toBe(200);
    const cookie = realSession.headers.get('Set-Cookie')!.split(';')[0];
    const headers = { ...commonHeaders, Cookie: cookie };
    const createBody = post('room.create', crypto.randomUUID());
    const created = await runtime.dispatchFetch('https://localhost:5173/api/rooms', { method: 'POST', headers, body: createBody });
    expect(created.status).toBe(200);
    const original = parseServerMessage(await created.json());
    if (!original.ok || original.value.type !== 'room.entered') throw new Error('Expected durable room');
    const initialBoardId = original.value.state.puzzle.id;
    const guestSession = await runtime.dispatchFetch('https://localhost:5173/api/session', {
      method: 'POST', headers: commonHeaders, body: post('session.open', crypto.randomUUID()),
    });
    expect(guestSession.status).toBe(200);
    const guestHeaders = { ...commonHeaders, Cookie: guestSession.headers.get('Set-Cookie')!.split(';')[0] };
    const joinBody = JSON.stringify({ version: 2, commandId: crypto.randomUUID(),
      command: { type: 'room.join', nickname: 'Guest', roomCode: original.value.state.roomCode } });
    const joined = await runtime.dispatchFetch('https://localhost:5173/api/rooms/join', {
      method: 'POST', headers: guestHeaders, body: joinBody,
    });
    expect(joined.status).toBe(200);
    const joinedMessage = parseServerMessage(await joined.json());
    if (!joinedMessage.ok || joinedMessage.value.type !== 'room.entered') throw new Error('Expected guest membership');
    const live = await openRuntimeSocket(runtime, original.value.roomId, headers);
    const bound = await live.next((m) => m.type === 'session.bound');
    if (bound.type !== 'session.bound' || bound.state.status !== 'lobby') throw new Error('Expected live lobby');
    const shuffleRequest = { version: 2, commandId: crypto.randomUUID(), roomId: original.value.roomId,
      context: { lobbyId: bound.state.lobbyId }, command: { type: 'board.shuffle' } };
    live.socket.send(JSON.stringify(shuffleRequest));
    const shuffleResult = await live.next((m) => m.type === 'command.result' && m.commandId === shuffleRequest.commandId);
    if (shuffleResult.type !== 'command.result') throw new Error('Expected shuffle result');
    expect(shuffleResult.outcome).toEqual({ status: 'accepted' });
    const shuffled = await live.next((m) => m.type === 'room.snapshot' && m.state.puzzle.id !== initialBoardId);
    if (shuffled.type !== 'room.snapshot') throw new Error('Expected shuffled snapshot');
    let started: PublicRoomState | undefined;
    let startProcessedRevision: number | undefined;
    if (shuffled.state.status !== 'lobby') throw new Error('Expected shuffled lobby');
    const startRequest = { version: 2, commandId: crypto.randomUUID(), roomId: original.value.roomId,
      context: { lobbyId: shuffled.state.lobbyId }, command: { type: 'room.start', boardId: shuffled.state.puzzle.id } };
    if (phase === 'started') {
      live.socket.send(JSON.stringify(startRequest));
      const result = await live.next((m) => m.type === 'command.result' && m.commandId === startRequest.commandId);
      if (result.type !== 'command.result') throw new Error('Expected Start acknowledgment');
      expect(result.outcome).toEqual({ status: 'accepted' });
      startProcessedRevision = result.processedRevision;
      const snapshot = await live.next((m) => m.type === 'room.snapshot' && m.state.status === 'playing' && m.state.match.phase === 'thinking');
      if (snapshot.type !== 'room.snapshot') throw new Error('Expected Thinking');
      started = snapshot.state;
    }
    const resumeBody = JSON.stringify({ version: 2, commandId: crypto.randomUUID(),
      command: { type: 'session.resume', roomId: original.value.roomId } });
    const resumeUrl = `https://localhost:5173/api/rooms/${original.value.roomId}/resume`;
    const beforeRestart = await runtime.dispatchFetch(resumeUrl, { method: 'POST', headers: guestHeaders, body: resumeBody });
    expect(beforeRestart.status).toBe(200);
    const pendingBody = post('room.create', crypto.randomUUID());
    const pendingReply = await runtime.dispatchFetch('https://test.invalid/test-reserve', {
      method: 'POST', headers: { ...headers, 'X-Test-Initialize': String(phase === 'initialized') }, body: pendingBody,
    });
    const pending = await pendingReply.json() as CreationRecord;
    expect(pending.status).toBe('pending');

    await runtime.dispose();
    runtime = start(join(directory, 'saved'));
    const replay = await runtime.dispatchFetch('https://localhost:5173/api/rooms', { method: 'POST', headers, body: createBody });
    expect(replay.status).toBe(200);
    const replayMessage = parseServerMessage(await replay.json());
    if (!replayMessage.ok || replayMessage.value.type !== 'room.entered') throw new Error('Expected replay');
    expect(replayMessage.value.state.puzzle).toEqual(shuffled.state.puzzle);
    expect(replayMessage.value.state.players).toEqual(joinedMessage.value.state.players);
    expect(replayMessage.value.state.revision).toBeGreaterThan(shuffled.state.revision);
    expect(replayMessage.value.seatId).toBe(original.value.seatId);
    if (started) {
      expect(replayMessage.value.state.status).toBe('playing');
      if (replayMessage.value.state.status !== 'playing' || started.status !== 'playing') throw new Error('Expected durable Thinking');
      expect(replayMessage.value.state.match).toEqual(started.match);
      expect(replayMessage.value.state.match.phase).toBe('thinking');
    }
    const joinedRetry = await runtime.dispatchFetch('https://localhost:5173/api/rooms/join', {
      method: 'POST', headers: guestHeaders, body: joinBody,
    });
    expect(joinedRetry.status).toBe(200);
    const joinedReplay = parseServerMessage(await joinedRetry.json());
    if (!joinedReplay.ok || joinedReplay.value.type !== 'room.entered') throw new Error('Expected durable join replay');
    expect(joinedReplay.value.membership).toBe('joined');
    expect(joinedReplay.value.seatId).toBe(joinedMessage.value.seatId);
    expect(joinedReplay.value.state).toEqual(replayMessage.value.state);
    const resumed = await runtime.dispatchFetch(resumeUrl, { method: 'POST', headers: guestHeaders, body: resumeBody });
    expect(resumed.status).toBe(200);
    const resumedMessage = parseServerMessage(await resumed.json());
    if (!resumedMessage.ok || resumedMessage.value.type !== 'room.entered') throw new Error('Expected durable resume');
    expect(resumedMessage.value.membership).toBe('resumed');
    expect(resumedMessage.value.seatId).toBe(joinedMessage.value.seatId);
    expect(resumedMessage.value.state).toEqual(replayMessage.value.state);
    const reconnected = await openRuntimeSocket(runtime, original.value.roomId, headers);
    const rebind = await reconnected.next((m) => m.type === 'session.bound');
    if (rebind.type !== 'session.bound') throw new Error('Expected rebind');
    expect(rebind.seatId).toBe(original.value.seatId);
    if (started) {
      reconnected.socket.send(JSON.stringify(startRequest));
      const duplicateStart = await reconnected.next((m) => m.type === 'command.result' && m.commandId === startRequest.commandId);
      expect(duplicateStart).toMatchObject({ duplicate: true, processedRevision: startProcessedRevision, outcome: { status: 'accepted' } });
      const freshSession = await runtime.dispatchFetch('https://localhost:5173/api/session', {
        method: 'POST', headers: commonHeaders, body: post('session.open', crypto.randomUUID()),
      });
      expect(freshSession.status).toBe(200);
      const lateJoin = await runtime.dispatchFetch('https://localhost:5173/api/rooms/join', {
        method: 'POST', headers: { ...commonHeaders, Cookie: freshSession.headers.get('Set-Cookie')!.split(';')[0] },
        body: JSON.stringify({ version: 2, commandId: crypto.randomUUID(), command: { type: 'room.join', nickname: 'Late', roomCode: original.value.state.roomCode } }),
      });
      expect(lateJoin.status).toBe(409);
      expect(await lateJoin.json()).toMatchObject({ type: 'request.rejected', reason: 'match-started' });
    }
    reconnected.socket.send(JSON.stringify(shuffleRequest));
    const duplicate = await reconnected.next((m) => m.type === 'command.result' && m.commandId === shuffleRequest.commandId);
    if (duplicate.type !== 'command.result') throw new Error('Expected persisted shuffle replay');
    expect(duplicate.duplicate).toBe(true);
    expect(duplicate.processedRevision).toBe(shuffleResult.processedRevision);
    const repeated = await reconnected.next((m) => m.type === 'room.snapshot' && m.state.revision === duplicate.currentRevision);
    if (repeated.type !== 'room.snapshot') throw new Error('Expected latest snapshot');
    expect(repeated.state.puzzle).toEqual(shuffled.state.puzzle);
    reconnected.socket.close(1000);
    await reconnected.closed;
    // The HTTP operation queues behind close reconciliation before runtime disposal.
    await runtime.dispatchFetch(resumeUrl, { method: 'POST', headers: guestHeaders, body: resumeBody });
    const recovered = await runtime.dispatchFetch('https://localhost:5173/api/rooms', { method: 'POST', headers, body: pendingBody });
    expect(recovered.status).toBe(200);
    const recoveryMessage = parseServerMessage(await recovered.json());
    if (!recoveryMessage.ok || recoveryMessage.value.type !== 'room.entered') throw new Error('Expected recovery');
    expect(recoveryMessage.value.roomId).toBe(pending.initialization.roomId);
    expect(recoveryMessage.value.seatId).toBe(pending.initialization.hostSeatId);
    expect(recoveryMessage.value.state.roomCode).toBe(pending.initialization.roomCode);
    for (const path of ['registry', 'room']) {
      const response = await runtime.dispatchFetch(`https://test.invalid/${path}`);
      expect(await response.json()).toEqual({ version: 1, marker: `${path}-saved` });
    }
    const beforeExpiry = await runtime.dispatchFetch('https://test.invalid/test-session', {
      headers: { 'X-Test-Time': String(opened.session.expiresAt - 1), 'X-Test-Credential': opened.credential },
    });
    expect(await beforeExpiry.json()).toEqual(opened.session);
    const atExpiry = await runtime.dispatchFetch('https://test.invalid/test-session', {
      headers: { 'X-Test-Time': String(opened.session.expiresAt), 'X-Test-Credential': opened.credential },
    });
    expect(await atExpiry.json()).toBeNull();

    await runtime.dispose();
    runtime = start(join(directory, 'isolated'));
    for (const path of ['registry', 'room']) {
      const response = await runtime.dispatchFetch(`https://test.invalid/${path}`);
      expect(await response.json()).toEqual({ version: 1, marker: null });
    }
  } finally {
    await runtime.dispose();
    // Delete only this test's verified, freshly created temporary directory.
    const target = resolve(directory);
    if (dirname(target) !== resolve(tmpdir()) || !basename(target).startsWith('rr-t14-persistence-')) {
      throw new Error('Refusing to remove an unexpected test storage path');
    }
    await rm(target, { recursive: true, force: true });
  }
});
