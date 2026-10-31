/** Display only: never submits a command or advances a match. */
export const biddingSecondsLeft = (deadlineAtMs: number, serverNowMs: number) =>
  Math.max(0, Math.ceil((deadlineAtMs - serverNowMs) / 1000));

export function watchBiddingCountdown(
  deadlineAtMs: number, getServerNow: () => number, onTick: (seconds: number) => void,
  events = { visibility: document as EventTarget, resume: window as EventTarget },
): () => void {
  const refresh = () => onTick(biddingSecondsLeft(deadlineAtMs, getServerNow()));
  refresh();
  const timer = setInterval(refresh, 250);
  events.visibility.addEventListener('visibilitychange', refresh);
  events.resume.addEventListener('pageshow', refresh);
  events.resume.addEventListener('focus', refresh);
  return () => {
    clearInterval(timer);
    events.visibility.removeEventListener('visibilitychange', refresh);
    events.resume.removeEventListener('pageshow', refresh);
    events.resume.removeEventListener('focus', refresh);
  };
}
