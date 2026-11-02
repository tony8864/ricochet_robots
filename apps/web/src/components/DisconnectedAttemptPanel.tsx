import { useEffect, useState } from 'react';
import type { PublicAttemptDisconnect } from '@robot-puzzle/shared';
import { biddingSecondsLeft, watchBiddingCountdown } from '../lobby/biddingDisplayClock';

/** Snapshot-owned eligibility; the countdown is informational, never authority. */
export function DisconnectedAttemptPanel({ nickname, bid, moveCount, disconnect, isHost, disabled, pending, getServerNow, onSkip }: {
  readonly nickname: string;
  readonly bid: number;
  readonly moveCount: number;
  readonly disconnect: PublicAttemptDisconnect | null | undefined;
  readonly isHost: boolean;
  readonly disabled: boolean;
  readonly pending: boolean;
  readonly getServerNow: () => number;
  readonly onSkip: () => void;
}) {
  const deadline = disconnect?.skipAllowedAtMs;
  const [seconds, setSeconds] = useState(() => deadline === undefined ? 0 : biddingSecondsLeft(deadline, getServerNow()));
  useEffect(() => deadline === undefined ? undefined : watchBiddingCountdown(deadline, getServerNow, setSeconds), [deadline, getServerNow]);
  return <section className="disconnected-attempt" aria-label="Disconnected demonstration">
    <div className="disconnected-attempt__information"><span>{nickname} · Bid: {bid}</span><span>Moves: {moveCount} / {bid}</span></div>
    <div className="disconnected-attempt__status">
      <p role="status">
        <svg className="disconnected-attempt__wifi-off" width="16" height="16" viewBox="0 0 24 24"
          fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
          aria-hidden="true" focusable="false">
          <path d="m2 2 20 20M2 8.82a15 15 0 0 1 2.17-1.45M10.66 5A16 16 0 0 1 22 8.82M5 12a10 10 0 0 1 5.17-2.69M16.85 10.66A10 10 0 0 1 19 12M8.5 15.5a5 5 0 0 1 7 0M12 19h.01" />
        </svg>
        <span>{nickname} is disconnected. Waiting for them to reconnect.</span>
      </p>
      <span className="disconnected-attempt__countdown" role="timer" aria-live="off" aria-label={deadline === undefined ? 'Waiting for the server' : `${seconds} seconds to reconnect`}>
        {deadline === undefined ? '—' : `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`}
      </span>
    </div>
    {isHost && <button type="button" className="disconnected-attempt__skip"
      disabled={disabled || disconnect?.status !== 'skippable'} onClick={onSkip}>{pending ? 'Skipping…' : 'Skip Attempt'}</button>}
  </section>;
}
