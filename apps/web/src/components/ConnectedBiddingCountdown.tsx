import { useEffect, useState } from 'react';
import { biddingSecondsLeft, watchBiddingCountdown } from '../lobby/biddingDisplayClock';

export function ConnectedBiddingCountdown({ deadlineAtMs, getServerNow }: {
  readonly deadlineAtMs: number;
  readonly getServerNow: () => number;
}) {
  const [seconds, setSeconds] = useState(() => biddingSecondsLeft(deadlineAtMs, getServerNow()));
  useEffect(() => watchBiddingCountdown(deadlineAtMs, getServerNow, setSeconds), [deadlineAtMs, getServerNow]);
  const display = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  return <span className="bidding-countdown bidding-countdown--inline"
    role="timer" aria-live="off" aria-label={`${seconds} seconds remaining`}>{display}</span>;
}
