import { afterEach, expect, test, vi } from 'vitest';
import { createMatch, prepareMatchRound } from '@robot-puzzle/match';
import { starterBoard } from '@robot-puzzle/puzzles';
import { createLocalMatchController } from './controller';
import { localRoundOptions } from './startLobbyMatch';
import { LOCAL_PLAYERS } from './config';
import { biddingSecondsRemaining, startBiddingClock } from './biddingClock';

afterEach(() => { vi.useRealTimers(); });

function fixture(now = () => Date.now()) {
  vi.useFakeTimers();
  vi.setSystemTime(1_000);
  const initial = createMatch({ matchId: 'clock-test', players: LOCAL_PLAYERS, puzzle: starterBoard });
  const state = prepareMatchRound(initial, localRoundOptions(starterBoard)).state;
  const controller = createLocalMatchController({ match: state, actingSeatId: 'maria', hostSeatId: 'maria', now });
  controller.sendPlayer({ type: 'bid.submit', value: 7 });
  const open = controller.getSnapshot().match;
  if (open.phase !== 'bidding') throw new Error('Expected open bidding.');
  const events = { visibility: new EventTarget(), resume: new EventTarget() };
  const onTick = vi.fn();
  const advance = vi.spyOn(controller, 'advanceTime');
  const stop = startBiddingClock(controller, open.deadlineAtMs, onTick, events);
  return { controller, deadline: open.deadlineAtMs, events, onTick, advance, stop };
}

test.each([[1_000, 60], [1_001, 60], [60_999, 1], [61_000, 0], [80_000, 0]])('display at %i ms rounds remaining seconds up to %i', (now, seconds) => {
  expect(biddingSecondsRemaining(61_000, now)).toBe(seconds);
});

test('automatic expiry closes exactly at the absolute deadline; repeated ticks cannot reset attempts', () => {
  const { controller, onTick, advance, stop } = fixture();
  expect(onTick).toHaveBeenLastCalledWith(60);
  vi.advanceTimersByTime(59_999);
  expect(controller.getSnapshot().match.phase).toBe('bidding');
  vi.advanceTimersByTime(1);
  expect(controller.getSnapshot().match.phase).toBe('demonstrating');
  expect(onTick).toHaveBeenLastCalledWith(0);
  expect(advance).toHaveBeenCalledOnce();
  controller.sendPlayer({ type: 'attempt.move', robotId: 'blue', direction: 'down' });
  const progressed = controller.getSnapshot().match;
  vi.advanceTimersByTime(100_000);
  expect(controller.getSnapshot().match).toBe(progressed);
  expect(vi.getTimerCount()).toBe(0);
  stop();
});

test('later higher bids, own reductions, and actor switches never extend the deadline or tie priority', () => {
  const { controller, deadline, stop } = fixture();
  vi.advanceTimersByTime(10_000);
  controller.actAs('alex');
  expect(controller.sendPlayer({ type: 'bid.submit', value: 12 }).status).toBe('accepted');
  expect(controller.sendPlayer({ type: 'bid.submit', value: 5 }).status).toBe('accepted');
  controller.actAs('maria');
  controller.sendPlayer({ type: 'bid.submit', value: 5 });
  const open = controller.getSnapshot().match;
  if (open.phase !== 'bidding') throw new Error('Expected same open window.');
  expect(open.deadlineAtMs).toBe(deadline);
  expect(open.bids[0].firstAcceptedOrder).toBe(0);
  vi.advanceTimersByTime(50_000);
  const demo = controller.getSnapshot().match;
  if (demo.phase !== 'demonstrating') throw new Error('Expected demonstration.');
  expect(demo.bidderQueue.map((bid) => bid.seatId)).toEqual(['maria', 'alex']);
  stop();
});

test.each(['visibilitychange', 'pageshow', 'focus'])('resuming via %s catches overdue bidding even if callbacks were suspended', (event) => {
  const { controller, events, advance, stop } = fixture();
  vi.setSystemTime(70_000); // Change time without running scheduled callbacks.
  const target = event === 'visibilitychange' ? events.visibility : events.resume;
  target.dispatchEvent(new Event(event));
  expect(controller.getSnapshot().match.phase).toBe('demonstrating');
  target.dispatchEvent(new Event(event));
  expect(advance).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
  stop();
});

test('a late command retains expiry before the suspended timer runs; stale callbacks preserve progress', () => {
  const { controller, events, advance, stop } = fixture();
  vi.setSystemTime(61_000);
  controller.actAs('teo');
  expect(controller.sendPlayer({ type: 'bid.submit', value: 1 })).toEqual({ status: 'rejected', reason: 'bidding-closed' });
  const demo = controller.getSnapshot().match;
  if (demo.phase !== 'demonstrating') throw new Error('Late rejection must retain expiry.');
  expect(demo.bidderQueue).toHaveLength(1);
  controller.actAs('maria');
  controller.sendPlayer({ type: 'attempt.move', robotId: 'blue', direction: 'down' });
  const progressed = controller.getSnapshot().match;
  events.resume.dispatchEvent(new Event('pageshow'));
  expect(controller.getSnapshot().match).toBe(progressed);
  expect(advance).not.toHaveBeenCalled();
  stop();
});

test('timer firing early does not close bidding when supplied time has not reached the deadline', () => {
  let now = 1_000;
  const { controller, events, advance, stop } = fixture(() => now);
  vi.advanceTimersByTime(60_000);
  expect(controller.getSnapshot().match.phase).toBe('bidding');
  expect(advance).not.toHaveBeenCalled();
  now = 61_000;
  events.resume.dispatchEvent(new Event('focus'));
  expect(controller.getSnapshot().match.phase).toBe('demonstrating');
  expect(advance).toHaveBeenCalledOnce();
  stop();
});

test('cleanup cancels timers/listeners and remounting creates only one active clock', () => {
  const { controller, deadline, events, advance, stop } = fixture();
  expect(vi.getTimerCount()).toBe(2);
  stop();
  expect(vi.getTimerCount()).toBe(0);
  const cleanup = startBiddingClock(controller, deadline, () => {}, events);
  expect(vi.getTimerCount()).toBe(2);
  cleanup();
  vi.setSystemTime(70_000);
  events.visibility.dispatchEvent(new Event('visibilitychange'));
  events.resume.dispatchEvent(new Event('pageshow'));
  expect(advance).not.toHaveBeenCalled();
  expect(controller.getSnapshot().match.phase).toBe('bidding');
});
