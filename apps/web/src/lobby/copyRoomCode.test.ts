import { afterEach, expect, test, vi } from 'vitest';
import { copyRoomCode, roomCodeCopyFeedback } from './copyRoomCode';

afterEach(() => vi.useRealTimers());

test('copies only the room code and reports success after the write completes', async () => {
  const write = vi.fn(async () => {});
  expect(await copyRoomCode('ABC234', write)).toBe(true);
  expect(write).toHaveBeenCalledExactlyOnceWith('ABC234');
});

test('clipboard denial or unavailability never reports success', async () => {
  expect(await copyRoomCode('ABC234', async () => { throw new Error('denied'); })).toBe(false);
  expect(await copyRoomCode('ABC234', () => { throw new Error('unavailable'); })).toBe(false);
});

test('successful copy feedback lasts exactly 1.5 seconds', async () => {
  vi.useFakeTimers();
  const feedback = roomCodeCopyFeedback(async () => {});
  const copy = feedback.copy('ABC234');
  expect(feedback.getSnapshot()).toBe('copying');
  await copy;
  expect(feedback.getSnapshot()).toBe('copied');
  await vi.advanceTimersByTimeAsync(1_499);
  expect(feedback.getSnapshot()).toBe('copied');
  await vi.advanceTimersByTimeAsync(1);
  expect(feedback.getSnapshot()).toBe('idle');
});

test('repeated successful copy restarts the checkmark duration', async () => {
  vi.useFakeTimers();
  const write = vi.fn(async () => {});
  const feedback = roomCodeCopyFeedback(write);
  await feedback.copy('ABC234');
  await vi.advanceTimersByTimeAsync(1_000);
  await feedback.copy('ABC234');
  await vi.advanceTimersByTimeAsync(500);
  expect(feedback.getSnapshot()).toBe('copied');
  await vi.advanceTimersByTimeAsync(1_000);
  expect(feedback.getSnapshot()).toBe('idle');
  expect(write).toHaveBeenCalledTimes(2);
});

test('rapid clicks cannot overlap clipboard writes and failures never show a checkmark', async () => {
  let finish!: () => void;
  const write = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
  const feedback = roomCodeCopyFeedback(write);
  const first = feedback.copy('ABC234');
  await feedback.copy('ABC234');
  expect(write).toHaveBeenCalledTimes(1);
  finish();
  await first;
  feedback.reset();
  const failure = roomCodeCopyFeedback(async () => { throw new Error('denied'); });
  await failure.copy('ABC234');
  expect(failure.getSnapshot()).toBe('failed');
});

test('cleanup cancels timers and ignores late clipboard completion', async () => {
  vi.useFakeTimers();
  let finish!: () => void;
  const feedback = roomCodeCopyFeedback(() => new Promise<void>((resolve) => { finish = resolve; }));
  const first = feedback.copy('ABC234');
  feedback.reset();
  finish();
  await first;
  expect(feedback.getSnapshot()).toBe('idle');
  expect(vi.getTimerCount()).toBe(0);
  const next = feedback.copy('DEF567');
  finish(); await next;
  expect(vi.getTimerCount()).toBe(1);
  feedback.reset();
  expect(vi.getTimerCount()).toBe(0);
});
