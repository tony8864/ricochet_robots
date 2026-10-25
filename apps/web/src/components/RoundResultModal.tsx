import { useEffect, useRef, useState, type ReactNode } from 'react';
import { MATCH_ROUND_COUNT, type RoundResultMatchState } from '@robot-puzzle/match';

export interface RoundResultModalProps {
  readonly match: RoundResultMatchState;
  readonly isHost: boolean;
  readonly hostName: string;
  readonly onContinue: () => void;
  readonly developmentTools?: ReactNode;
}

/** Native modal provides background inertness, focus containment, and focus return. */
export function openResultDialog(dialog: HTMLDialogElement): () => void {
  const previousOverflow = document.body.style.overflow;
  document.body.style.overflow = 'hidden';
  if (!dialog.open) dialog.showModal();
  return () => {
    dialog.close();
    document.body.style.overflow = previousOverflow;
  };
}

export function RoundResultModal({ match, isHost, hostName, onContinue, developmentTools }: RoundResultModalProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const panel = useRef<HTMLElement>(null);
  const [pending, setPending] = useState(false);
  const submitted = useRef(false);
  const finalRound = match.round.number === MATCH_ROUND_COUNT;
  const outcome = match.outcome;
  const winner = outcome.kind === 'success'
    ? match.players.find((player) => player.seatId === outcome.winnerSeatId)?.nickname : null;
  const message = outcome.kind === 'success' ? `${winner} solved the target!`
    : outcome.kind === 'no-bid-skip' ? 'Round skipped.' : 'Nobody solved this round.';

  useEffect(() => {
    const cleanup = openResultDialog(dialog.current!);
    panel.current?.focus();
    return cleanup;
  }, []);

  function advance() {
    if (!isHost || submitted.current) return;
    submitted.current = true;
    setPending(true);
    try {
      onContinue();
    } finally {
      submitted.current = false;
      setPending(false);
    }
  }

  return (
    <dialog ref={dialog} className={`round-result-overlay${developmentTools ? ' round-result-overlay--development' : ''}`}
      aria-modal="true" aria-labelledby="round-result-heading" aria-describedby="round-result-message round-result-details"
      onCancel={(event) => event.preventDefault()}>
      {developmentTools && <div className="round-result-tools">{developmentTools}</div>}
      <section ref={panel} tabIndex={-1} className="round-result-panel">
        <h2 id="round-result-heading">ROUND {match.round.number} COMPLETE</h2>
        <p id="round-result-message" className="round-result-panel__message">{message}</p>
        <p id="round-result-details" className="round-result-panel__details">
          {outcome.kind === 'success' ? <>
            {outcome.moveCount} {outcome.moveCount === 1 ? 'move' : 'moves'} · Bid: {outcome.winningBid} ·{' '}
            <strong>+1 point</strong>
          </> : 'No points awarded.'}
        </p>
        <div className="round-result-panel__action">
          {isHost ? <button type="button" disabled={pending} onClick={advance}>
            {finalRound ? 'View Results' : 'Continue'}
          </button> : <p>Waiting for {hostName} to {finalRound ? 'show the results' : 'continue'}.</p>}
        </div>
      </section>
    </dialog>
  );
}
