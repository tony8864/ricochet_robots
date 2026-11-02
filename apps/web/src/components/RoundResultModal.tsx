import { useEffect, useRef, useState, type ReactNode } from 'react';
import { MATCH_ROUND_COUNT, type MatchPlayer, type RoundNumber, type RoundOutcome } from '@robot-puzzle/match';
import { openModalDialog } from './modalDialog';

export interface RoundResultModalProps {
  readonly match: { readonly round: { readonly number: RoundNumber }; readonly outcome: RoundOutcome; readonly players: readonly MatchPlayer[] };
  readonly isHost: boolean;
  readonly hostName: string;
  readonly onContinue: () => void;
  readonly developmentTools?: ReactNode;
  readonly pending?: boolean;
  readonly disabled?: boolean;
  readonly recovery?: ReactNode;
  readonly administrativeActions?: ReactNode;
}

/** Native modal provides background inertness, focus containment, and focus return. */
export const openResultDialog = openModalDialog;

export function RoundResultModal({ match, isHost, hostName, onContinue, developmentTools, pending: remotePending, disabled = false, recovery, administrativeActions }: RoundResultModalProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const panel = useRef<HTMLElement>(null);
  const [localPending, setPending] = useState(false);
  const pending = remotePending ?? localPending;
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
    if (!isHost || disabled || pending || submitted.current) return;
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
        {administrativeActions && <div className="result-actions">{administrativeActions}</div>}
        <h2 id="round-result-heading">ROUND {match.round.number} COMPLETE</h2>
        <p id="round-result-message" className="round-result-panel__message">{message}</p>
        <p id="round-result-details" className="round-result-panel__details">
          {outcome.kind === 'success' ? <>
            {outcome.moveCount} {outcome.moveCount === 1 ? 'move' : 'moves'} · Bid: {outcome.winningBid} ·{' '}
            <strong>+1 point</strong>
          </> : 'No points awarded.'}
        </p>
        <div className="round-result-panel__action">
          {isHost ? <button type="button" disabled={disabled || pending} onClick={advance}>
            {finalRound ? 'View Results' : 'Continue'}
          </button> : <p>Waiting for {hostName} to {finalRound ? 'show the results' : 'continue'}.</p>}
        </div>
        {recovery && <div className="round-result-panel__recovery">{recovery}</div>}
      </section>
    </dialog>
  );
}
