import { expect, test, vi } from 'vitest';
import { createRosterMotion, type RosterMotionRow } from './rosterMotion';

function row(seatId: string, top: number, visualOffset = 0) {
  const animation = { cancel: vi.fn(), finished: new Promise<Animation>(() => {}) } as unknown as Animation;
  return { seatId, top, visualOffset, animate: vi.fn(() => animation), animation };
}

test('initial render records positions without animating', () => {
  const motion = createRosterMotion(() => false);
  const rows = [row('maria', 0), row('alex', 40)];
  motion.update(rows);
  expect(rows.every((row) => row.animate.mock.calls.length === 0)).toBe(true);
});

test('reordered rows translate from their former positions while unchanged rows stay still', () => {
  const motion = createRosterMotion(() => false);
  motion.update([row('maria', 0), row('alex', 40), row('teo', 80)]);
  const next = [row('alex', 0), row('maria', 40), row('teo', 80)];
  motion.update(next);
  expect(next[0].animate).toHaveBeenCalledWith(40);
  expect(next[1].animate).toHaveBeenCalledWith(-40);
  expect(next[2].animate).not.toHaveBeenCalled();
  motion.cancel();
});

test('value-only or acting-player updates with unchanged order do not move rows', () => {
  const motion = createRosterMotion(() => false);
  motion.update([row('maria', 0), row('alex', 40)]);
  const rows = [row('maria', 0), row('alex', 40)];
  motion.update(rows);
  expect(rows.every((row) => row.animate.mock.calls.length === 0)).toBe(true);
});

test('rapid reorder cancels prior motion and continues from current interpolated positions', () => {
  const motion = createRosterMotion(() => false);
  motion.update([row('maria', 0), row('alex', 40)]);
  const first = [row('alex', 0), row('maria', 40)];
  motion.update(first);
  const second = [row('maria', 0, -15), row('alex', 40, 15)];
  motion.update(second);
  expect(first[0].animation.cancel).toHaveBeenCalledOnce();
  expect(first[1].animation.cancel).toHaveBeenCalledOnce();
  expect(second[0].animate).toHaveBeenCalledWith(25);
  expect(second[1].animate).toHaveBeenCalledWith(-25);
  motion.cancel();
});

test('Reduce Motion applies new positions instantly and cancels existing motion', () => {
  let reduced = false;
  const motion = createRosterMotion(() => reduced);
  motion.update([row('maria', 0), row('alex', 40)]);
  const moving = [row('alex', 0), row('maria', 40)];
  motion.update(moving);
  reduced = true;
  motion.cancel();
  expect(moving[0].animation.cancel).toHaveBeenCalledOnce();
  const next = [row('maria', 0), row('alex', 40)];
  motion.update(next);
  expect(next.every((row) => row.animate.mock.calls.length === 0)).toBe(true);
});

test('new seats and unavailable animation support do not block immediate ordering', () => {
  const motion = createRosterMotion(() => false);
  motion.update([row('maria', 0)]);
  const rows: RosterMotionRow[] = [row('alex', 0), { ...row('maria', 40), animate: () => null }];
  expect(() => motion.update(rows)).not.toThrow();
  expect(rows.map((row) => row.seatId)).toEqual(['alex', 'maria']);
  motion.cancel();
});

test('cleanup cancels every active row animation', () => {
  const motion = createRosterMotion(() => false);
  motion.update([row('maria', 0), row('alex', 40)]);
  const next = [row('alex', 0), row('maria', 40)];
  motion.update(next);
  motion.cancel();
  motion.cancel();
  expect(next.every((row) => vi.mocked(row.animation.cancel).mock.calls.length === 1)).toBe(true);
});
