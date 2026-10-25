import type { FinishedMatchState, SeatId } from './model';

export interface MatchStanding {
  readonly seatId: SeatId;
  readonly nickname: string;
  readonly score: number;
}

export interface MatchResults {
  readonly standings: readonly MatchStanding[];
  readonly winnerSeatIds: readonly SeatId[];
}

/** Derived final results, not a second editable copy of scores in match state. */
export function getMatchResults(state: FinishedMatchState): MatchResults {
  if (state.phase !== 'finished') throw new TypeError('Match results require a finished match.');
  // Stable sorting preserves roster order for display only, never as a tiebreak.
  const standings = state.players.map(({ seatId, nickname }) => ({ seatId, nickname, score: state.scores[seatId] }))
    .sort((left, right) => right.score - left.score);
  const highestScore = standings[0].score;
  return { standings, winnerSeatIds: standings.filter((row) => row.score === highestScore).map((row) => row.seatId) };
}
