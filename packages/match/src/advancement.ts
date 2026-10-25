import type { MatchTransitionResult, PlayerMatchContext } from './commands';
import { completeRound } from './completion';
import { MATCH_ROUND_COUNT, type MatchState } from './model';
import { accepted, rejected } from './results';

/** The current host may resolve only an unbid round, with explicit confirmation. */
export function skipRound(state: MatchState, context: PlayerMatchContext, confirmed: boolean): MatchTransitionResult {
  if (state.phase !== 'thinking') return rejected(state, 'wrong-phase');
  if (context.actorSeatId !== context.hostSeatId) return rejected(state, 'not-host');
  if (!confirmed) return rejected(state, 'confirmation-required');
  return accepted(completeRound(state, { outcome: { kind: 'no-bid-skip' } }));
}

/** Advancement never scores, commits robots, or runs target selection. */
export function advanceRound(state: MatchState): MatchTransitionResult {
  if (state.phase === 'finished') return rejected(state, 'match-finished');
  if (state.phase !== 'round-result') return rejected(state, 'wrong-phase');
  const common = {
    matchId: state.matchId, players: state.players, scores: state.scores,
    puzzle: state.puzzle, officialRobots: state.officialRobots, usedTargetIds: state.usedTargetIds,
  };
  if (state.completedRounds === MATCH_ROUND_COUNT) {
    return accepted({ ...common, phase: 'finished', completedRounds: MATCH_ROUND_COUNT });
  }
  return accepted({
    ...common, phase: 'preparing', completedRounds: state.completedRounds,
    preparation: { status: 'not-attempted' },
  });
}
