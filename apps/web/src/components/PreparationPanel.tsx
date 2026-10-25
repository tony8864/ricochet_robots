import type { PreparationStatus } from '@robot-puzzle/match';

export function PreparationPanel({ pending, preparation, error, isHost, onRetry }: {
  readonly pending: boolean;
  readonly preparation: PreparationStatus;
  readonly error: string | null;
  readonly isHost: boolean;
  readonly onRetry: () => void;
}) {
  const message = pending ? 'Preparing the next target…'
    : error ? error
    : preparation.status === 'deferred' ? 'Could not verify a target within the search limit.'
    : preparation.status === 'unavailable' ? 'No verified target is available from the current robot positions.'
    : 'Round preparation: not-attempted.';
  return (
    <section aria-label="Round preparation" className="phase-placeholder" aria-busy={pending}>
      <p role="status">{message} No target has been revealed.</p>
      {!pending && (isHost ? (
        <button className="attempt-actions__button preparation-panel__retry" type="button" onClick={onRetry}>Retry preparation</button>
      ) : <p>Waiting for the host to retry preparation.</p>)}
    </section>
  );
}
