import type { RobotPositions } from '@robot-puzzle/game-engine';
import { copyRobots } from './data';
import type { DemonstratingMatchState, RoundOutcome, RoundResultMatchState, ThinkingMatchState } from './model';

type RoundResolution =
  | { readonly outcome: Extract<RoundOutcome, { kind: 'success' }>; readonly finalRobots: RobotPositions }
  | { readonly outcome: Exclude<RoundOutcome, { kind: 'success' }> };

/** Atomic resolution; advancing past this result must never award/commit again. */
export function completeRound(state: ThinkingMatchState | DemonstratingMatchState, resolution: RoundResolution): RoundResultMatchState {
  const outcome = resolution.outcome;
  const scores = outcome.kind === 'success'
    ? { ...state.scores, [outcome.winnerSeatId]: state.scores[outcome.winnerSeatId] + 1 }
    : state.scores;
  return {
    phase: 'round-result', matchId: state.matchId, players: state.players, scores,
    puzzle: state.puzzle, usedTargetIds: state.usedTargetIds,
    officialRobots: 'finalRobots' in resolution ? copyRobots(resolution.finalRobots) : state.officialRobots,
    completedRounds: state.round.number, round: state.round, outcome: { ...outcome },
  };
}
