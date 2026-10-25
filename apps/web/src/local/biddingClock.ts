import type { LocalMatchController } from './controller';

export function biddingSecondsRemaining(deadlineAtMs: number, nowMs: number): number {
  return Math.max(0, Math.ceil((deadlineAtMs - nowMs) / 1_000));
}

/** Browser scheduling only. Absolute supplied time/T11, never the display, closes bidding. */
export function startBiddingClock(
  controller: Pick<LocalMatchController, 'getNow' | 'advanceTime' | 'getSnapshot'>,
  deadlineAtMs: number,
  onTick: (seconds: number) => void,
  events: { readonly visibility: EventTarget; readonly resume: EventTarget } = { visibility: document, resume: window },
): () => void {
  let stopped = false;
  let expired = false;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let interval: ReturnType<typeof setInterval> | undefined;

  function clearTimers() {
    clearTimeout(timeout);
    clearInterval(interval);
  }
  function refresh() {
    if (stopped || expired) return;
    const now = controller.getNow();
    onTick(biddingSecondsRemaining(deadlineAtMs, now));
    if (now >= deadlineAtMs) {
      expired = true;
      clearTimers();
      const state = controller.getSnapshot().match;
      if (state.phase === 'bidding' && state.deadlineAtMs === deadlineAtMs) controller.advanceTime();
    }
  }
  function scheduleExpiry() {
    clearTimeout(timeout);
    refresh();
    if (!stopped && !expired) {
      timeout = setTimeout(scheduleExpiry, Math.max(1, deadlineAtMs - controller.getNow()));
    }
  }
  scheduleExpiry();
  if (!expired) interval = setInterval(refresh, 250);
  events.visibility.addEventListener('visibilitychange', scheduleExpiry);
  events.resume.addEventListener('pageshow', scheduleExpiry);
  events.resume.addEventListener('focus', scheduleExpiry);

  return () => {
    stopped = true;
    clearTimers();
    events.visibility.removeEventListener('visibilitychange', scheduleExpiry);
    events.resume.removeEventListener('pageshow', scheduleExpiry);
    events.resume.removeEventListener('focus', scheduleExpiry);
  };
}
