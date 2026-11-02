import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { build } from 'esbuild';
import { Miniflare } from 'miniflare';
import { expect, test } from 'vitest';
import type { StoredRoom } from '../src/roomMembership';
import type { RoomTerminal } from '../src/roomTerminal';

test('full runtime recreation normalizes an overdue persisted lease at its effective deadline exactly once', async () => {
  const bundle = await build({ entryPoints: ['test/preparationRestart.worker.ts'], bundle: true, write: false,
    format: 'esm', platform: 'browser', target: 'es2022', external: ['cloudflare:workers'] });
  const directory = await mkdtemp(join(tmpdir(), 'rr-t17-presence-'));
  const start = () => new Miniflare({ modules: true, script: bundle.outputFiles[0].text, compatibilityDate: '2025-10-11',
    host: '127.0.0.1', port: 0, durableObjects: { ROOMS: { className: 'Room', useSQLite: true } }, durableObjectsPersist: join(directory, 'saved') });
  let runtime = start();
  const read = async (path: string) => {
    const response = await runtime.dispatchFetch(`https://test.invalid${path}`);
    expect(response.status).toBe(200);
    return await response.json() as { room: StoredRoom; alarm: number | null; presence: {
      leases: Array<{ deadline: number }>; seats: Array<{ offline_since: number | null }>; empty: Array<{ empty_since: number | null }>;
    } };
  };
  try {
    const before = await read('/seed-presence');
    expect(before.room.state.players[0].connected).toBe(true);
    const due = before.presence.leases[0].deadline;
    await runtime.dispose(); runtime = start();
    const restored = await read('/inspect');
    expect(restored.room.state).toEqual({ ...before.room.state, revision: before.room.state.revision + 1,
      players: before.room.state.players.map((p) => ({ ...p, connected: false })) });
    expect(restored.room.members).toEqual(before.room.members);
    expect(restored.presence).toEqual({ leases: [], seats: [{ seat_id: before.room.state.hostSeatId, offline_since: due }],
      empty: [{ singleton: 1, empty_since: due, empty_expires_at: due + 1800000 }] });
    expect(restored.alarm).toBe(due + 1800000); expect(await read('/inspect')).toEqual(restored);
  } finally {
    await runtime.dispose();
    const target = resolve(directory);
    if (dirname(target) !== resolve(tmpdir()) || !basename(target).startsWith('rr-t17-presence-')) throw new Error('Unsafe test cleanup');
    await rm(target, { recursive: true, force: true });
  }
});

test.each(['queued', 'running', 'error', 'thinking', 'bidding', 'overdue-bidding', 'attempt', 'undo', 'success', 'later-bidder', 'round-result', 'continued', 'finished', 'returned-lobby', 'disconnect-grace', 'skipped-disconnect', 'closed-room', 'empty-overdue'])('full runtime restart preserves %s state and normalizes due work once', async (mode) => {
  const bundle = await build({ entryPoints: ['test/preparationRestart.worker.ts'], bundle: true, write: false,
    format: 'esm', platform: 'browser', target: 'es2022', external: ['cloudflare:workers'] });
  const directory = await mkdtemp(join(tmpdir(), 'rr-t15-preparation-'));
  function start() {
    return new Miniflare({ modules: true, script: bundle.outputFiles[0].text, compatibilityDate: '2025-10-11',
      host: '127.0.0.1', port: 0, durableObjects: { ROOMS: { className: 'Room', useSQLite: true } },
      durableObjectsPersist: join(directory, 'saved') });
  }
  let runtime = start();
  const read = async (path: string) => {
    const response = await runtime.dispatchFetch(`https://test.invalid${path}`);
    expect(response.status).toBe(200);
    return await response.json() as { room: StoredRoom; alarm: number | null; replays: readonly unknown[]; terminal: RoomTerminal | null;
      replay?: { duplicate: boolean; changed: boolean; outcome: { status: string } } };
  };
  try {
    const before = await read(`/seed?mode=${mode}`);
    if (mode === 'attempt' || mode === 'undo') expect(before.room.match).toMatchObject({ version: 4, state: { phase: 'demonstrating', attempt: { moves: [expect.any(Object)] } }, attempt: { version: 3 } });
    if (mode === 'success') expect(before.room.match).toMatchObject({ version: 4, state: { phase: 'round-result', outcome: { kind: 'success' } } });
    if (mode === 'later-bidder' || mode === 'skipped-disconnect') expect(before.room.match).toMatchObject({ version: 4, state: { phase: 'demonstrating', activeBidderIndex: 1 } });
    if (mode === 'round-result') expect(before.room.match).toMatchObject({ version: 4, state: { phase: 'round-result' } });
    if (mode === 'continued') expect(before.room.match).toMatchObject({ version: 2, state: { phase: 'preparing', completedRounds: 1 }, job: { status: 'queued' } });
    if (mode === 'finished') expect(before.room.match).toMatchObject({ version: 5, state: { phase: 'finished', completedRounds: 10 } });
    if (mode === 'returned-lobby') { expect(before.room.state.status).toBe('lobby'); expect(before.room).not.toHaveProperty('match'); }
    if (mode === 'queued' || mode === 'bidding') expect((await read('/forget-alarm')).alarm).toBeNull();
    await runtime.dispose();
    runtime = start();
    const restored = await read('/inspect');
    if (mode === 'empty-overdue') {
      expect(before.terminal).toBeNull(); expect(before.alarm).toBeNull();
      expect(restored.terminal).toMatchObject({ reason: 'expired', lastRevision: before.room.state.revision + 1 });
      expect(restored.room.match).toEqual(before.room.match);
      expect(restored.room.state).toEqual({ ...before.room.state, revision: before.room.state.revision + 1 });
    } else if (mode === 'closed-room') {
      expect(restored.room).toEqual(before.room); expect(restored.terminal).toMatchObject({ reason: 'host-ended', closureId: before.terminal!.closureId });
      const retried = await read('/replay-end');
      expect(retried.replay).toMatchObject({ duplicate: true, changed: false, outcome: { status: 'accepted' } });
      expect(retried.room).toEqual(restored.room); expect(retried.replays).toEqual(before.replays);
    } else if (mode === 'disconnect-grace') {
      const d = before.room.attemptPresence!.disconnect!;
      expect(d.status).toBe('grace');
      expect(restored.room.attemptPresence?.disconnect).toEqual({ ...d, status: 'skippable' });
      expect(restored.room.match).toEqual(before.room.match);
      expect(restored.room.state.revision).toBe(before.room.state.revision + 1);
      expect(restored.alarm).not.toBeNull(); // The empty-room deadline remains scheduled.
    } else if (mode === 'overdue-bidding') {
      expect(restored.room.match!.state.phase).toBe('demonstrating');
      expect(restored.room.match!.state.usedTargetIds).toEqual(before.room.match!.state.usedTargetIds);
    } else expect(restored).toEqual(before);
    expect(restored.replays).toEqual(before.replays);
    if (['attempt', 'undo', 'success', 'later-bidder', 'round-result', 'continued', 'finished', 'returned-lobby', 'disconnect-grace', 'skipped-disconnect'].includes(mode)) {
      const retried = await read('/replay-attempt');
      expect(retried.replay).toMatchObject({ duplicate: true, changed: false, outcome: { status: 'accepted' } });
      expect(retried.room).toEqual(restored.room);
      expect(retried.replays).toEqual(restored.replays);
    }
    const advanced = await read('/advance');
    if (mode === 'queued' || mode === 'bidding') {
      expect(advanced.room.match!.state.phase).toBe(mode === 'queued' ? 'thinking' : 'demonstrating');
      expect(advanced.room.match!.state.usedTargetIds).toHaveLength(1);
    } else if (mode === 'continued') {
      expect(['thinking', 'preparing']).toContain(advanced.room.match!.state.phase);
      expect(advanced.room.match!.state.completedRounds).toBe(1);
      expect(advanced.room.match!.state.usedTargetIds).toHaveLength(advanced.room.match!.state.phase === 'thinking' ? 2 : 1);
    } else if (mode === 'running') {
      expect(advanced.room.match).toMatchObject({ job: { status: 'error' } });
      expect(advanced.room.match!.state.usedTargetIds).toEqual([]);
    } else if (mode === 'closed-room' || mode === 'empty-overdue') expect(advanced.room).toEqual(restored.room);
    else expect(advanced).toEqual(restored);
    const again = await read('/advance');
    if (mode === 'closed-room' || mode === 'empty-overdue') { expect(again.room).toEqual(advanced.room); expect(again.replays).toEqual(advanced.replays); }
    else expect(again).toEqual(advanced);
    if (mode !== 'returned-lobby') {
      expect(advanced.room.match!.state.matchId).toBe(before.room.match!.state.matchId);
      expect(advanced.room.match!.state.officialRobots).toEqual(before.room.match!.state.officialRobots);
    } else expect(advanced.room).toEqual(before.room);
  } finally {
    await runtime.dispose();
    const target = resolve(directory);
    if (dirname(target) !== resolve(tmpdir()) || !basename(target).startsWith('rr-t15-preparation-')) throw new Error('Unsafe test cleanup');
    await rm(target, { recursive: true, force: true });
  }
}, 30000);
