import { parseServerMessage, type RoomEnteredMessage } from '@robot-puzzle/shared';
import { roomRecoveryStore, type RoomRecoveryStore } from '../lobby/roomRecovery';
import { browserRecoveryEnvironment, reconnectDelay, type RecoveryEnvironment } from '../lobby/recoveryEnvironment';
import { inviteFromPath } from './entryDraft';
import { resumeRoom, type ResumeResult } from './resumeRoom';

export type EntryRecoveryState = { readonly status: 'entry'; readonly message: string }
  | { readonly status: 'recovering' | 'waiting' | 'error' | 'expired'; readonly message: string }
  | { readonly status: 'resumed'; readonly entry: RoomEnteredMessage };
interface Dependencies {
  readonly recovery: RoomRecoveryStore;
  readonly environment: RecoveryEnvironment;
  readonly now: () => number;
  readonly random: () => number;
  readonly resume: (roomId: string, signal: AbortSignal) => Promise<ResumeResult>;
}

/** Entry owns navigation; the connected adapter owns live room recovery. */
export function entryRecovery(pathname: string, overrides: Partial<Dependencies> = {}) {
  const deps: Dependencies = { recovery: roomRecoveryStore(), environment: browserRecoveryEnvironment,
    now: () => performance.now(), random: Math.random, resume: resumeRoom, ...overrides };
  const invite = inviteFromPath(pathname);
  let record = deps.recovery.read();
  if (record?.autoResume === false || invite.invalid || (invite.code && invite.code !== record?.roomCode)) record = null;
  let state: EntryRecoveryState = record ? { status: 'recovering', message: 'Restoring your room…' } : { status: 'entry', message: '' };
  const listeners = new Set<() => void>();
  let active = false; let generation = 0; let step = 0; let lastProbe = -Infinity;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let controller: AbortController | undefined;
  let unwatch: (() => void) | undefined;
  const publish = (next: EntryRecoveryState) => { state = next; for (const listener of listeners) listener(); };
  function stop() {
    active = false; generation++; clearTimeout(timer); timer = undefined;
    controller?.abort(); controller = undefined; unwatch?.(); unwatch = undefined;
  }
  function schedule(immediate = false) {
    if (!active || !record || controller || timer) return;
    if (!deps.environment.online()) { publish({ status: 'waiting', message: 'You are offline. Waiting for a connection…' }); return; }
    const delay = Math.max(immediate ? 0 : reconnectDelay(step++, deps.random), 10000 - (deps.now() - lastProbe));
    timer = setTimeout(() => { timer = undefined; void attempt(); }, delay);
  }
  async function attempt() {
    if (!active || !record || !deps.environment.online()) { schedule(); return; }
    const current = generation; const saved = record;
    const abort = new AbortController(); controller = abort; lastProbe = deps.now();
    publish({ status: 'recovering', message: 'Restoring your room…' });
    let result: ResumeResult;
    try { result = await deps.resume(saved.roomId, abort.signal); }
    catch { result = { status: 'transient', message: 'Connection lost. Reconnecting…' }; }
    if (!active || generation !== current) return;
    controller = undefined;
    if (result.status === 'resumed') {
      const parsed = parseServerMessage(result.entry);
      if (!parsed.ok || parsed.value.type !== 'room.entered' || parsed.value.membership !== 'resumed'
        || result.entry.roomId !== saved.roomId || result.entry.seatId !== saved.seatId || result.entry.state.roomCode !== saved.roomCode) {
        stop(); publish({ status: 'error', message: 'The recovered room did not match your saved seat.' }); return;
      }
      stop(); publish({ status: 'resumed', entry: result.entry });
    } else if (result.status === 'transient') { publish({ status: 'waiting', message: result.message }); schedule(); }
    else {
      stop();
      if (result.status === 'closed' || result.status === 'expired') { deps.recovery.clear(saved.roomId); record = null; }
      publish({ status: result.status === 'closed' ? 'entry' : result.status, message: result.message });
    }
  }
  function watchLifecycle() {
    if (unwatch) return;
    unwatch = deps.environment.watch((event) => {
      if (event === 'offline') {
        generation++; controller?.abort(); controller = undefined; clearTimeout(timer); timer = undefined;
        publish({ status: 'waiting', message: 'You are offline. Waiting for a connection…' });
      } else { clearTimeout(timer); timer = undefined; schedule(true); }
    });
  }
  return {
    getSnapshot: () => state,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    start() {
      if (active || !record || state.status === 'resumed' || state.status === 'expired' || state.status === 'error') return;
      active = true; generation++;
      watchLifecycle();
      schedule(true); // Deferred so Strict Mode setup/cleanup cannot double-submit.
    },
    stop,
    retry() {
      if (!record || state.status === 'expired' || state.status === 'resumed' || ('message' in state && state.message.startsWith('Update required'))) return;
      if (!active) { active = true; generation++; }
      watchLifecycle();
      clearTimeout(timer); timer = undefined; schedule(true);
    },
    returnToEntry() {
      stop(); if (record) deps.recovery.clear(record.roomId); record = null;
      publish({ status: 'entry', message: '' });
    },
    depart() {
      // The live adapter has already saved the tab-local suppression marker.
      // Keep the pending request for an explicit same-seat rejoin.
      stop(); record = null;
      publish({ status: 'entry', message: 'You left the room.' });
    },
    terminal(roomId: string, kind: 'closed' | 'expired', message: string) {
      stop(); deps.recovery.clear(roomId); record = null;
      publish({ status: kind === 'closed' ? 'entry' : 'expired', message });
    },
  };
}
export type EntryRecovery = ReturnType<typeof entryRecovery>;
