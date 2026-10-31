import { acceptRoundPreparation, type PreparingMatchState } from '@robot-puzzle/match';
import { prepareNextRound, type RoundSetupResult } from '@robot-puzzle/puzzles/round-setup';
import { createPreparationJob, PREPARATION_COOLDOWN_MS, PREPARATION_RECOVERY_MS, type PreparationJob } from './preparationJob';
import { projectStoredMatch, type StoredMatch } from './storedMatch';
import { saveRoom, storedRoom } from './lobbyCommands';
import type { StoredRoom } from './roomMembership';

/** Reusable entry hook: no search. Caller commits this with Start/future Continue. */
export function queuedPreparation(state: PreparingMatchState, now: number): StoredMatch {
  return { version: 2, state: { ...state, preparation: { status: 'not-attempted' } }, job: createPreparationJob(state, now) };
}

function withMatch(room: StoredRoom, match: StoredMatch): StoredRoom {
  return { ...room, match, state: projectStoredMatch({ ...room.state, revision: room.state.revision + 1 }, match) };
}

/** Existing T14 Preparing records acquire one durable job, never a new match. */
export function ensurePreparationJob(storage: DurableObjectStorage, now: number): boolean {
  return storage.transactionSync(() => {
    const room = storedRoom(storage);
    if (room?.match?.version !== 1) return false;
    saveRoom(storage, withMatch(room, queuedPreparation(room.match.state, now)));
    return true;
  });
}

export function commitPreparationResult(storage: DurableObjectStorage, id: string, result: RoundSetupResult | null, now: number): boolean {
  return storage.transactionSync(() => {
    const room = storedRoom(storage);
    const match = room?.match;
    if (!room || match?.version !== 2 || match.state.phase !== 'preparing' ||
      match.job?.id !== id || match.job.status !== 'running') return false;
    const accepted = result ? acceptRoundPreparation(match.state, match.job.request, result) : null;
    let next: StoredMatch;
    if (!accepted || accepted.outcome.status !== 'accepted') {
      next = { version: 2, state: match.state, job: { ...match.job, status: 'error', retryAtMs: now + PREPARATION_COOLDOWN_MS } };
    } else if (accepted.state.phase === 'thinking') next = { version: 2, state: accepted.state };
    else if (accepted.state.phase === 'preparing' && result && result.status !== 'selected') {
      next = { version: 2, state: accepted.state, job: { ...match.job, status: result.status, retryAtMs: now + PREPARATION_COOLDOWN_MS } };
    } else throw new Error('Invalid preparation transition');
    saveRoom(storage, withMatch(room, next));
    return true;
  });
}

/** At most one solver call per logical job, even across crash/re-delivery. */
export async function runPreparationAlarm(storage: DurableObjectStorage, now: number, search: typeof prepareNextRound = prepareNextRound): Promise<boolean> {
  ensurePreparationJob(storage, now);
  const claim = storage.transactionSync((): PreparationJob | null => {
    const room = storedRoom(storage);
    const match = room?.match;
    if (!room || match?.version !== 2 || match.state.phase !== 'preparing' || !match.job || match.job.dueAtMs > now) return null;
    if (match.job.status === 'running') {
      commitPreparationResult(storage, match.job.id, null, now);
      return null;
    }
    if (match.job.status !== 'queued') return null;
    const job: PreparationJob = { ...match.job, status: 'running', dueAtMs: now + PREPARATION_RECOVERY_MS };
    saveRoom(storage, { ...room, match: { version: 2, state: match.state, job } });
    return job;
  });
  if (!claim) return false;
  // Install recovery before search. A crash leaves running, never an automatic
  // second search. Preserve an earlier future session alarm; it re-arms recovery.
  const existing = await storage.getAlarm();
  if (existing === null || existing <= now || existing > claim.dueAtMs) await storage.setAlarm(claim.dueAtMs);
  let result: RoundSetupResult | null;
  try { result = search(claim.request.setup); }
  catch { result = null; } // No private exception detail in public state/logs.
  return commitPreparationResult(storage, claim.id, result, now);
}
