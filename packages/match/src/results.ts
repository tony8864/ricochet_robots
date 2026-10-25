import type { MatchNoOpReason, MatchRejectionReason, MatchTransitionResult } from './commands';
import type { MatchState } from './model';

export function accepted(state: MatchState): MatchTransitionResult {
  return { state, outcome: { status: 'accepted' } };
}

export function noOp(state: MatchState, reason: MatchNoOpReason): MatchTransitionResult {
  return { state, outcome: { status: 'no-op', reason } };
}

export function rejected(state: MatchState, reason: MatchRejectionReason): MatchTransitionResult {
  return { state, outcome: { status: 'rejected', reason } };
}
