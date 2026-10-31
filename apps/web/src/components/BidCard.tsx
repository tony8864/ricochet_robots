import { useId, useReducer, useState } from 'react';
import type { MatchCommandOutcome } from '@robot-puzzle/match';
import { bidDraftReducer, canPlaceBid, parseBidDraft } from './bidDraft';

/** Drafts stay local; accepted bids come exclusively from the match model. */
export function BidCard({ acceptedBid, onPlaceBid, disabled = false, pending = false }: {
  readonly acceptedBid?: number;
  readonly onPlaceBid: (value: number) => MatchCommandOutcome | void;
  readonly disabled?: boolean;
  readonly pending?: boolean;
}) {
  const inputId = useId();
  const [draft, dispatch] = useReducer(bidDraftReducer, acceptedBid ?? 1,
    (value) => ({ text: String(value), lastValidValue: value }));
  const [feedback, setFeedback] = useState<string | null>(null);
  const value = parseBidDraft(draft.text);
  function submit() {
    if (disabled || value === null || !canPlaceBid(draft.text, acceptedBid)) return;
    const result = onPlaceBid(value);
    setFeedback(!result ? null : result.status === 'accepted' ? 'Bid accepted.'
      : result.status === 'no-op' ? 'This bid is already accepted.'
      : result.reason === 'bidding-closed' ? 'Bidding has closed.'
      : result.reason === 'bid-increase' ? 'You can only lower your own bid.'
      : 'Bid not accepted. Check the value and current phase.');
  }

  return (
    <section className="bid-card" aria-labelledby={`${inputId}-label`}>
      <label className="bid-card__label" id={`${inputId}-label`} htmlFor={inputId}>YOUR BID</label>
      <div className="bid-card__selector">
        <button
          className="bid-card__step"
          type="button"
          aria-label="Decrease bid"
          disabled={disabled || value === null || value === 1}
          onClick={() => { setFeedback(null); dispatch({ type: 'step', delta: -1 }); }}
        >
          <svg aria-hidden="true" focusable="false" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M6 12h12" />
          </svg>
        </button>
        <div className="bid-card__value">
          <input
            className="bid-card__number"
            id={inputId}
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            enterKeyHint="done"
            autoComplete="off"
            disabled={disabled}
            aria-describedby={`${inputId}-units`}
            value={draft.text}
            onChange={(event) => { setFeedback(null); dispatch({ type: 'edit', text: event.target.value }); }}
            onBlur={() => dispatch({ type: 'blur' })}
            onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); }}
          />
          <span className="bid-card__units" id={`${inputId}-units`}>moves</span>
        </div>
        <button
          className="bid-card__step"
          type="button"
          aria-label="Increase bid"
          disabled={disabled || value === null || value === Number.MAX_SAFE_INTEGER || (acceptedBid !== undefined && value >= acceptedBid)}
          onClick={() => { setFeedback(null); dispatch({ type: 'step', delta: 1 }); }}
        >
          <svg aria-hidden="true" focusable="false" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M6 12h12M12 6v12" />
          </svg>
        </button>
      </div>
      <button
        className="bid-card__submit"
        type="button"
        disabled={disabled || !canPlaceBid(draft.text, acceptedBid)}
        onClick={submit}
      >{pending ? 'Placing bid…' : 'Place Bid'}</button>
      {(acceptedBid !== undefined || feedback) && (
        <p className="bid-card__feedback" role="status">
          {acceptedBid !== undefined && `Your accepted bid: ${acceptedBid} ${acceptedBid === 1 ? 'move' : 'moves'}. `}
          {value !== null && acceptedBid !== undefined && value > acceptedBid
            ? 'You can only lower your own bid.' : feedback ?? (acceptedBid === 1 ? 'This is the minimum bid.' : 'You may lower this bid.')}
        </p>
      )}
    </section>
  );
}
