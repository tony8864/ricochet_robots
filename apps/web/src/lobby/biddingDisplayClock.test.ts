import { afterEach, expect, test, vi } from 'vitest';
import { biddingSecondsLeft, watchBiddingCountdown } from './biddingDisplayClock';

afterEach(() => vi.useRealTimers());

test('display rounds up to the deadline, clamps at zero and does not advance any match', () => {
  expect(biddingSecondsLeft(61000, 1000)).toBe(60);
  expect(biddingSecondsLeft(61000, 60999)).toBe(1);
  expect(biddingSecondsLeft(61000, 61000)).toBe(0);
  expect(biddingSecondsLeft(61000, 99999)).toBe(0);
});

test('ticks/resume use the latest server-time estimate and cleanup removes scheduling/listeners', () => {
  vi.useFakeTimers();
  const events = { visibility: new EventTarget(), resume: new EventTarget() };
  let now = 1000;
  const tick = vi.fn();
  const stop = watchBiddingCountdown(61000, () => now, tick, events);
  expect(tick).toHaveBeenLastCalledWith(60);
  now = 16000;
  vi.advanceTimersByTime(250);
  expect(tick).toHaveBeenLastCalledWith(45);
  now = 61000;
  events.resume.dispatchEvent(new Event('pageshow'));
  expect(tick).toHaveBeenLastCalledWith(0);
  stop();
  const calls = tick.mock.calls.length;
  vi.advanceTimersByTime(1000);
  events.visibility.dispatchEvent(new Event('visibilitychange'));
  events.resume.dispatchEvent(new Event('focus'));
  expect(tick).toHaveBeenCalledTimes(calls);
});
