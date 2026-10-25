import { useId, useRef } from 'react';
import type { MatchBid, MatchPlayer } from '@robot-puzzle/match';
import { useRosterMotion } from './useRosterMotion';

type PlayerRosterProps = {
  readonly players: readonly MatchPlayer[];
  readonly currentSeatId: string;
} & (
  | { readonly variant: 'lobby'; readonly hostSeatId: string }
  | { readonly variant: 'bids'; readonly bids: readonly MatchBid[] }
);

/** Shared roster presentation. Accepted bids/order are supplied by the match model. */
export function PlayerRoster(props: PlayerRosterProps) {
  const headingId = useId();
  const isBidding = props.variant === 'bids';
  const prefix = isBidding ? 'player-bids' : 'lobby-roster';
  const bids = new Map(isBidding ? props.bids.map((bid) => [bid.seatId, bid]) : []);
  const players = isBidding ? [...props.players].sort((left, right) => {
    const first = bids.get(left.seatId);
    const second = bids.get(right.seatId);
    if (first && second) return first.value - second.value || first.firstAcceptedOrder - second.firstAcceptedOrder;
    return first ? -1 : second ? 1 : 0;
  }) : props.players;
  const listRef = useRef<HTMLUListElement>(null);
  useRosterMotion(listRef, JSON.stringify(players.map((player) => player.seatId)), isBidding);

  return (
    <section className={prefix} aria-labelledby={headingId}>
      <div className={`${prefix}__heading`}>
        <h2 id={headingId}>{isBidding ? 'PLAYER BIDS' : 'Players'}</h2>
        <span aria-label={isBidding ? undefined : `${players.length} of 6 players`}>
          {isBidding ? `${players.length} ${players.length === 1 ? 'player' : 'players'}` : `${players.length} / 6`}
        </span>
      </div>
      <ul
        ref={listRef}
        className={`${prefix}__list`}
        tabIndex={isBidding ? 0 : undefined}
        aria-label={isBidding ? 'Player bids list' : undefined}
        aria-live={isBidding ? 'polite' : undefined}
      >
        {players.map((player) => {
          const isYou = player.seatId === props.currentSeatId;
          const bid = bids.get(player.seatId);
          return (
            <li className={`${prefix}__row${isYou ? ` ${prefix}__row--current` : ''}`} key={player.seatId} data-seat-id={player.seatId}>
              <span className={`${prefix}__nickname`}>
                {isBidding ? <>
                  <span className="player-bids__name" title={player.nickname}>{player.nickname}</span>
                  {isYou && <span className="player-bids__you">(you)</span>}
                </> : player.nickname}
              </span>
              {isBidding ? (
                <span
                  className={`player-bids__value${bid ? '' : ' player-bids__value--empty'}`}
                  aria-label={bid ? undefined : 'No bid submitted'}
                >{bid ? `${bid.value} ${bid.value === 1 ? 'move' : 'moves'}` : '—'}</span>
              ) : (
                <span className="lobby-roster__indicators">
                  {props.variant === 'lobby' && player.seatId === props.hostSeatId && <span className="lobby-roster__host">Host</span>}
                  {isYou && <span className="lobby-roster__you">You</span>}
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
