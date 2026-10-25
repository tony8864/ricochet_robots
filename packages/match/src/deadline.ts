import { createAttempt } from '@robot-puzzle/game-engine';
import { copyRobots } from './data';
import type { MatchState, NonEmptyBids } from './model';

/** Shared normalization for all future handlers. Caller validates authoritative time. */
export function normalizeBiddingDeadline(state: MatchState, nowMs: number): MatchState {
  if (state.phase !== 'bidding' || nowMs < state.deadlineAtMs) return state;

  const sorted = state.bids
    .map(({ seatId, value, firstAcceptedOrder }) => ({ seatId, value, firstAcceptedOrder }))
    .sort((first, second) => first.value - second.value || first.firstAcceptedOrder - second.firstAcceptedOrder);
  if (!sorted[0]) throw new TypeError('Invalid bidding state: expiry requires at least one accepted bid.');
  const bidderQueue: NonEmptyBids = [sorted[0], ...sorted.slice(1)];
  return {
    phase: 'demonstrating', matchId: state.matchId, players: state.players, scores: state.scores,
    puzzle: state.puzzle, officialRobots: state.officialRobots, usedTargetIds: state.usedTargetIds,
    completedRounds: state.completedRounds, round: state.round,
    bidderQueue, activeBidderIndex: 0,
    attempt: createAttempt(copyRobots(state.round.startRobots)),
  };
}
