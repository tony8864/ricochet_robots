import { useEffect, useState } from 'react';
import type { LocalMatchController } from '../local/controller';
import { biddingSecondsRemaining, startBiddingClock } from '../local/biddingClock';

export function BiddingCountdown({ controller, deadlineAtMs }: {
  readonly controller: LocalMatchController;
  readonly deadlineAtMs: number;
}) {
  const [seconds, setSeconds] = useState(() => biddingSecondsRemaining(deadlineAtMs, controller.getNow()));
  useEffect(() => startBiddingClock(controller, deadlineAtMs, setSeconds), [controller, deadlineAtMs]);
  const display = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  return (
    <p className="bidding-countdown">
      <span>Time left</span>
      <strong role="timer" aria-live="off" aria-label={`${seconds} seconds remaining`}>{display}</strong>
    </p>
  );
}
