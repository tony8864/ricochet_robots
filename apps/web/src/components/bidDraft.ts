/** Presentation-only draft: this does not submit or accept a game bid. */
export interface BidDraft {
  readonly text: string;
  readonly lastValidValue: number;
}

export type BidDraftAction =
  | { readonly type: 'edit'; readonly text: string }
  | { readonly type: 'step'; readonly delta: -1 | 1 }
  | { readonly type: 'blur' };

export const INITIAL_BID_DRAFT: BidDraft = { text: '1', lastValidValue: 1 };

export function parseBidDraft(text: string): number | null {
  if (!/^\d+$/.test(text)) return null;
  const value = Number(text);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

/** UI guard only; T11 still validates every submitted command. */
export function canPlaceBid(text: string, acceptedBid?: number): boolean {
  const value = parseBidDraft(text);
  return value !== null && (acceptedBid === undefined || value < acceptedBid);
}

export function bidDraftReducer(draft: BidDraft, action: BidDraftAction): BidDraft {
  const value = parseBidDraft(draft.text);
  switch (action.type) {
    case 'edit': {
      if (!/^\d*$/.test(action.text)) return draft;
      return { text: action.text, lastValidValue: parseBidDraft(action.text) ?? draft.lastValidValue };
    }
    case 'blur': {
      const restored = value ?? draft.lastValidValue;
      return { text: String(restored), lastValidValue: restored };
    }
    case 'step': {
      if (value === null) return draft;
      const next = value + action.delta;
      return Number.isSafeInteger(next) && next > 0 ? { text: String(next), lastValidValue: next } : draft;
    }
  }
}
