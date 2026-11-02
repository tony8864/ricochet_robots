import { getMatchResults, type FinishedMatchState } from '@robot-puzzle/match';
import type { ReactNode } from 'react';

export function MatchResults(props: {
  readonly match: Pick<FinishedMatchState, 'phase' | 'players' | 'scores' | 'completedRounds'>;
  readonly currentSeatId: string;
  readonly hostSeatId: string;
  readonly onNewMatch: () => void;
  readonly developmentTools?: ReactNode;
  readonly disabled?: boolean;
  readonly pending?: boolean;
  readonly feedback?: ReactNode;
  readonly administrativeActions?: ReactNode;
}) {
  const { standings, winnerSeatIds } = getMatchResults(props.match);
  // All-zero results are presented as "No winner", without changing model scoring.
  const noWinner = standings.every((player) => player.score === 0);
  const winners = noWinner ? [] : standings.filter((player) => winnerSeatIds.includes(player.seatId));
  const host = props.match.players.find((player) => player.seatId === props.hostSeatId)!;
  let rank = 0;

  return (
    <main className="match-results" aria-labelledby="match-results-heading">
      <div className="match-results__content">
        {props.developmentTools}
        {props.administrativeActions && <div className="result-actions">{props.administrativeActions}</div>}
        <header className="match-results__summary">
          <p className="match-results__eyebrow">MATCH COMPLETE</p>
          <h1 id="match-results-heading">{noWinner ? 'No winner' : winners.length === 1 ? `${winners[0].nickname} wins!` : "It's a tie!"}</h1>
          {winners.length > 1 && <p className="match-results__winners">{winners.map((player) => player.nickname).join(', ')}</p>}
          <p className="match-results__supporting">{noWinner ? 'No points were awarded in this match.'
            : `${props.match.completedRounds} rounds played`}</p>
        </header>
        <section aria-labelledby="final-standings-heading">
          <h2 id="final-standings-heading" className="match-results__eyebrow">FINAL STANDINGS</h2>
          <ul className="final-standings">
            {standings.map((player, index) => {
              if (index === 0 || player.score !== standings[index - 1].score) rank = index + 1;
              const isWinner = !noWinner && winnerSeatIds.includes(player.seatId);
              const isYou = player.seatId === props.currentSeatId;
              return (
                <li key={player.seatId} data-seat-id={player.seatId}
                  className={`final-standings__row${isWinner ? ' final-standings__row--winner' : isYou ? ' final-standings__row--current' : ''}`}>
                  <span className="final-standings__rank" aria-label={noWinner ? 'Unranked' : `Rank ${rank}`}>{noWinner ? '—' : rank}</span>
                  <span className="final-standings__nickname" title={player.nickname}>{player.nickname}</span>
                  {isYou && <span className="final-standings__you">You</span>}
                  <span className="final-standings__score" aria-label={`${player.score} ${player.score === 1 ? 'point' : 'points'}`}>{player.score}</span>
                </li>
              );
            })}
          </ul>
        </section>
        <footer className="match-results__action">
          {props.currentSeatId === props.hostSeatId
            ? <button type="button" disabled={props.disabled || props.pending} onClick={props.onNewMatch}>{props.pending ? 'Returning to lobby…' : 'New Match'}</button>
            : <p>Waiting for {host.nickname} to start a new match.</p>}
        </footer>
        {props.feedback}
      </div>
    </main>
  );
}
