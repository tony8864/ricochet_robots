import { acceptRoundPreparation, snapshotRoundPreparation, transitionMatch,
  type PreparingMatchState, type ThinkingMatchState, type BiddingMatchState, type DemonstratingMatchState } from '@robot-puzzle/match';
import { RECOMMENDED_ROUND_SETUP_BUDGET } from '@robot-puzzle/puzzles/round-setup';
import { projectMatchState, type PublicRoomState, type AttemptProjectionMetadata } from '@robot-puzzle/shared';
import type { StoredRoom } from './roomMembership';
import { canonicalJson } from './creations';
import { PREPARATION_COOLDOWN_MS, PREPARATION_RECOVERY_MS, type PreparationJob } from './preparationJob';

export type StoredMatch =
  | { readonly version: 1; readonly state: PreparingMatchState }
  | { readonly version: 2; readonly state: PreparingMatchState | ThinkingMatchState; readonly job?: PreparationJob }
  | { readonly version: 3; readonly state: BiddingMatchState | DemonstratingMatchState; readonly attempt?: AttemptProjectionMetadata };

function check(condition: unknown): asserts condition {
  if (!condition) throw new Error('Invalid private match record');
}
const integer = (value: number) => Number.isSafeInteger(value) && value >= 0;
const uuid = (value: string) => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);

/** No solver on restore. Reject extra private fields as well as public mismatch. */
function validateFailure(state: PreparingMatchState, job: PreparationJob): void {
  const result = state.preparation;
  check(result.status === 'deferred' || result.status === 'unavailable');
  check(result.status === job.status);
  check(result.status === 'deferred'
    ? ['total-expansion-limit', 'candidate-expansion-limit', 'unverified-candidates'].includes(result.reason)
    : ['all-targets-used', 'all-unused-targets-complete', 'all-eligible-targets-unsolvable'].includes(result.reason));
  const d = result.diagnostics;
  check(d && Array.isArray(d.candidates) && d.candidates.length <= 17);
  check([d.totalTargets, d.usedTargetCount, d.alreadyCompleteTargetCount, d.eligibleTargetCount, d.untestedTargetCount, d.totalExpandedStates].every(integer));
  check(d.totalTargets === 17 && d.usedTargetCount === state.usedTargetIds.length &&
    d.usedTargetCount + d.alreadyCompleteTargetCount + d.eligibleTargetCount === 17 &&
    d.untestedTargetCount + d.candidates.length === d.eligibleTargetCount);
  let remaining = job.request.setup.budget.maxTotalExpandedStates;
  const seen = new Set<string>();
  for (const c of d.candidates) {
    check(!seen.has(c.targetId) && state.puzzle.targets.some((t) => t.id === c.targetId) && !state.usedTargetIds.includes(c.targetId));
    seen.add(c.targetId);
    check(c.status === 'unsolvable' || (c.status === 'unknown' && ['expansion-limit', 'storage-limit'].includes(c.reason)));
    check(c.limits.maxExpandedStates === Math.min(remaining, 50_000) && c.limits.maxStoredStates === 150_000);
    check([c.stats.expandedStates, c.stats.attemptedMoves, c.stats.generatedStates, c.stats.peakStoredStates, c.stats.searchArrayBytes].every(integer));
    check(c.stats.expandedStates <= c.limits.maxExpandedStates && c.stats.peakStoredStates >= 1 && c.stats.peakStoredStates <= 150_000);
    remaining -= c.stats.expandedStates;
  }
  check(remaining >= 0 && d.totalExpandedStates === job.request.setup.budget.maxTotalExpandedStates - remaining);
  const base = { ...state, preparation: { status: 'not-attempted' as const } };
  const accepted = acceptRoundPreparation(base, job.request, result);
  check(accepted.outcome.status === 'accepted' && canonicalJson(accepted.state) === canonicalJson(state));
}

export function projectStoredMatch(room: PublicRoomState, match: StoredMatch): PublicRoomState {
  const state = match.state;
  const common = { ...room, connections: Object.fromEntries(room.players.map((p) => [p.seatId, p.connected])) };
  const job = match.version === 2 ? match.job : undefined;
  const projected = state.phase === 'preparing' ? projectMatchState({ ...common, match: state,
    preparation: { matchId: state.matchId, completedRounds: state.completedRounds,
      activity: job?.status === 'error' ? 'failed' : job?.status === 'queued' || job?.status === 'running' ? 'pending' : 'idle',
      ...((job?.status === 'deferred' || job?.status === 'error') ? { retry: { preparationId: job.id, availableAtMs: job.retryAtMs } } : {}),
    } }) : state.phase === 'demonstrating' && match.version === 3 && match.attempt
      ? projectMatchState({ ...common, match: state, attempt: match.attempt })
      : state.phase === 'demonstrating' ? { ok: false as const } : projectMatchState({ ...common, match: state });
  check(projected.ok);
  return projected.value;
}

export function validateStoredMatch(room: PublicRoomState, value: unknown): StoredMatch | undefined {
  if (room.status === 'lobby') { check(value === undefined); return undefined; }
  check(room.status === 'playing' && ['preparing', 'thinking', 'bidding', 'demonstrating'].includes(room.match.phase));
  check(value && typeof value === 'object');
  const match = value as StoredMatch;
  check(match.version === 1 || match.version === 2 || match.version === 3);
  const common = { matchId: room.match.matchId,
    players: room.players.map(({ seatId, nickname }) => ({ seatId, nickname })),
    scores: room.match.scores, puzzle: room.puzzle, officialRobots: room.match.officialRobots,
    usedTargetIds: room.match.usedTargetIds, completedRounds: room.match.completedRounds };
  check(common.completedRounds < 10);
  const unfinished = { ...common, completedRounds: common.completedRounds as PreparingMatchState['completedRounds'] };
  if (room.match.phase === 'bidding' || room.match.phase === 'demonstrating') {
    check(match.version === 3);
    const round = room.match.round;
    const target = room.puzzle.targets.find((t) => t.id === round.targetId);
    check(target);
    const base = { ...unfinished, round: { number: round.number, target, startRobots: round.startRobots } };
    if (room.match.phase === 'bidding') {
      const expected: BiddingMatchState = { ...base, phase: 'bidding', bids: room.match.bids, deadlineAtMs: room.match.deadlineAtMs };
      check(canonicalJson(value) === canonicalJson({ version: 3, state: expected }));
    } else {
      // T15.4 supports only the fresh initial attempt. T16 must extend this codec.
      check(room.match.activeBidderIndex === 0 && room.match.attempt.version === 0 && room.match.attempt.moveCount === 0);
      const expected: DemonstratingMatchState = { ...base, phase: 'demonstrating', bidderQueue: room.match.bidderQueue,
        activeBidderIndex: 0, attempt: { roundStartRobots: round.startRobots, robots: round.startRobots, moves: [] } };
      const attempt: AttemptProjectionMetadata = { matchId: expected.matchId, roundNumber: round.number,
        activeBidderIndex: 0, seatId: expected.bidderQueue[0].seatId, id: room.match.attempt.id, version: 0 };
      check(canonicalJson(value) === canonicalJson({ version: 3, state: expected, attempt }));
    }
    check(canonicalJson(projectStoredMatch(room, match)) === canonicalJson(room));
    return match;
  }
  check(room.match.phase === 'preparing' || room.match.phase === 'thinking');
  check(match.version !== 3);
  if (match.version === 1) {
    const expected: PreparingMatchState = { ...unfinished, phase: 'preparing',
      scores: Object.fromEntries(room.players.map((p) => [p.seatId, 0])),
      officialRobots: room.puzzle.initialRobots, usedTargetIds: [], completedRounds: 0,
      preparation: { status: 'not-attempted' } };
    check(canonicalJson(value) === canonicalJson({ version: 1, state: expected }));
  } else if (room.match.phase === 'thinking') {
    const round = room.match.round;
    const target = room.puzzle.targets.find((t) => t.id === round.targetId);
    check(target);
    const expected: ThinkingMatchState = { ...unfinished, phase: 'thinking', round: { number: round.number, target, startRobots: round.startRobots } };
    check(canonicalJson(value) === canonicalJson({ version: 2, state: expected }));
  } else {
    check(match.state?.phase === 'preparing' && match.job);
    const state = match.state;
    const job = match.job;
    check(uuid(job.id) && ['queued', 'running', 'deferred', 'unavailable', 'error'].includes(job.status));
    check([job.createdAtMs, job.dueAtMs, job.retryAtMs].every(integer));
    check(job.dueAtMs >= job.createdAtMs && job.retryAtMs >= job.createdAtMs + PREPARATION_COOLDOWN_MS);
    check(job.request?.setup && canonicalJson(job.request.setup.budget) === canonicalJson(RECOMMENDED_ROUND_SETUP_BUDGET));
    const order = job.request.setup.candidateOrder;
    check(Array.isArray(order) && order.length === 17 && new Set(order).size === 17 && order.every((id) => room.puzzle.targets.some((t) => t.id === id)));
    const expectedState: PreparingMatchState = { ...unfinished, phase: 'preparing', preparation: state.preparation };
    const expectedRequest = snapshotRoundPreparation(expectedState, { candidateOrder: order, budget: RECOMMENDED_ROUND_SETUP_BUDGET });
    check(canonicalJson(job.request) === canonicalJson(expectedRequest));
    const expectedJob: PreparationJob = { id: job.id, status: job.status, createdAtMs: job.createdAtMs,
      dueAtMs: job.dueAtMs, retryAtMs: job.retryAtMs, request: expectedRequest };
    check(canonicalJson(value) === canonicalJson({ version: 2, state: expectedState, job: expectedJob }));
    if (job.status === 'deferred' || job.status === 'unavailable') validateFailure(state, job);
    else check(canonicalJson(state.preparation) === canonicalJson({ status: 'not-attempted' }));
    if (job.status === 'queued') check(job.dueAtMs === job.createdAtMs + 1);
    if (job.status === 'running') check(job.dueAtMs >= job.createdAtMs + PREPARATION_RECOVERY_MS);
  }
  check(canonicalJson(projectStoredMatch(room, match)) === canonicalJson(room));
  return match;
}

/** Server-owned attempt identity is allocated once, never on projection/restore. */
export function withBiddingState(room: StoredRoom, state: BiddingMatchState | DemonstratingMatchState): StoredRoom {
  const match: StoredMatch = state.phase === 'bidding' ? { version: 3, state } : { version: 3, state,
    attempt: { matchId: state.matchId, roundNumber: state.round.number, activeBidderIndex: state.activeBidderIndex,
      seatId: state.bidderQueue[state.activeBidderIndex].seatId, id: crypto.randomUUID(), version: 0 } };
  return { ...room, match, state: projectStoredMatch({ ...room.state, revision: room.state.revision + 1 }, match) };
}

export function advanceStoredBidding(room: StoredRoom, nowMs: number): StoredRoom {
  const state = room.match?.state;
  if (state?.phase !== 'bidding' || nowMs < state.deadlineAtMs) return room;
  const next = transitionMatch(state, { source: 'controller', context: { nowMs }, command: { type: 'time.advance' } }).state;
  check(next.phase === 'demonstrating');
  return withBiddingState(room, next);
}
