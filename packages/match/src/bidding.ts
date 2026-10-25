import type { MatchTransitionResult } from './commands';
import { BIDDING_WINDOW_MS, type MatchBid, type MatchState, type NonEmptyBids, type SeatId } from './model';
import { accepted, noOp, rejected } from './results';

/** Domain checks run after deadline normalization and roster authorization. */
export function submitBid(state: MatchState, seatId: SeatId, value: number, nowMs: number): MatchTransitionResult {
  if (state.phase === 'finished') return rejected(state, 'match-finished');
  if (state.phase === 'demonstrating') return rejected(state, 'bidding-closed');
  if (state.phase !== 'thinking' && state.phase !== 'bidding') return rejected(state, 'wrong-phase');
  if (!Number.isSafeInteger(value) || value <= 0) return rejected(state, 'invalid-bid');

  if (state.phase === 'thinking') {
    const deadlineAtMs = nowMs + BIDDING_WINDOW_MS;
    if (!Number.isSafeInteger(deadlineAtMs)) return rejected(state, 'invalid-context');
    const firstBid: MatchBid = { seatId, value, firstAcceptedOrder: 0 };
    return accepted({ ...state, phase: 'bidding', bids: [firstBid], deadlineAtMs });
  }

  const previous = state.bids.find((bid) => bid.seatId === seatId);
  if (previous && value > previous.value) return rejected(state, 'bid-increase');
  if (previous && value === previous.value) return noOp(state, 'same-bid');
  const updated: MatchBid = {
    seatId, value, firstAcceptedOrder: previous ? previous.firstAcceptedOrder : state.bids.length,
  };
  const bids: NonEmptyBids = previous
    ? [state.bids[0].seatId === seatId ? updated : state.bids[0],
      ...state.bids.slice(1).map((bid) => bid.seatId === seatId ? updated : bid)]
    : [...state.bids, updated];
  return accepted({ ...state, bids });
}
