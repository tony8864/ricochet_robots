import { snapshotRoundPreparation, type PreparingMatchState, type RoundPreparationRequest } from '@robot-puzzle/match';
import { RECOMMENDED_ROUND_SETUP_BUDGET } from '@robot-puzzle/puzzles/round-setup';

export const PREPARATION_COOLDOWN_MS = 5_000;
export const PREPARATION_RECOVERY_MS = 30_000;
export interface PreparationJob {
  readonly id: string;
  readonly status: 'queued' | 'running' | 'deferred' | 'unavailable' | 'error';
  readonly createdAtMs: number;
  /** queued: execute after this time; running: recover as error after this time. */
  readonly dueAtMs: number;
  readonly retryAtMs: number;
  readonly request: RoundPreparationRequest;
}

/** Randomness belongs to the server, never the pure selector or a client. */
function candidateOrder(state: PreparingMatchState): string[] {
  const order = state.puzzle.targets.map((target) => target.id);
  for (let i = order.length - 1; i > 0; i--) {
    const ceiling = Math.floor(0x1_0000_0000 / (i + 1)) * (i + 1);
    let value: number;
    do { value = crypto.getRandomValues(new Uint32Array(1))[0]; } while (value >= ceiling);
    const j = value % (i + 1);
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order;
}

export function createPreparationJob(state: PreparingMatchState, now: number): PreparationJob {
  return { id: crypto.randomUUID(), status: 'queued', createdAtMs: now,
    dueAtMs: now + 1, retryAtMs: now + PREPARATION_COOLDOWN_MS,
    request: snapshotRoundPreparation(state, { candidateOrder: candidateOrder(state), budget: RECOMMENDED_ROUND_SETUP_BUDGET }),
  };
}

export function preparationDue(job: PreparationJob | undefined): number | undefined {
  return job && (job.status === 'queued' || job.status === 'running') ? job.dueAtMs : undefined;
}
