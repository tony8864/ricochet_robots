import { expect, test } from 'vitest';
import { roomEnteredFixture, entryTestId } from '../entry/roomEntry.testFixture';
import { recoveryRecord, parseRecoveryRecord, ROOM_RECOVERY_KEY, roomRecoveryStore } from './roomRecovery';
import { recoveryFixture } from './recovery.testFixture';

const entry = roomEnteredFixture(entryTestId(1));
const pending = { version: 2 as const, roomId: entry.roomId, commandId: entryTestId(900), context: {}, command: { type: 'state.request' as const } };

test('tab storage keeps only routing and one bounded immutable pending request', () => {
  const f = recoveryFixture(); const record = recoveryRecord(entry, pending);
  expect(f.recovery.save(record)).toBe(true);
  expect(f.recovery.read()).toEqual(record);
  const text = f.values.get(ROOM_RECOVERY_KEY)!;
  for (const secret of ['credential', 'sessionId', 'internalProof', 'officialRobots', 'players']) expect(text).not.toContain(secret);
  const copied = parseRecoveryRecord(text)!;
  expect(copied).not.toBe(record); expect(copied.pending).not.toBe(pending);
  f.recovery.clear(entryTestId(999)); expect(f.recovery.read()).toEqual(record);
  f.recovery.clear(entry.roomId); expect(f.recovery.read()).toBeNull();
});

test.each([
  '{', 'null', '[]', 'x'.repeat(8193),
  JSON.stringify({ ...recoveryRecord(entry, pending), credential: 'secret' }),
  JSON.stringify({ ...recoveryRecord(entry, pending), version: 2 }),
  JSON.stringify({ ...recoveryRecord(entry, pending), roomId: '../api/session' }),
  JSON.stringify({ ...recoveryRecord(entry, pending), pending: { ...pending, roomId: entryTestId(999) } }),
  JSON.stringify({ ...recoveryRecord(entry, pending), pending: { version: 2, commandId: entryTestId(900), command: { type: 'session.open' } } }),
])('untrusted recovery data cannot allocate seats or introduce a different room %#', (text) => {
  expect(parseRecoveryRecord(text)).toBeNull();
});

test('historical requests use receipt-only wrapping, never fresh legacy gameplay', () => {
  const parsed = parseRecoveryRecord(JSON.stringify({ ...recoveryRecord(entry, pending), pending: { ...pending, version: 1 } }));
  expect(parsed?.pending).toMatchObject({ version: 2, commandId: pending.commandId, context: {},
    command: { type: 'command.retry', originalRequest: { ...pending, version: 1 } } });
});

test('blocked storage retains this instance memory but reports that refresh persistence failed', () => {
  const store = roomRecoveryStore(() => { throw new Error('blocked'); });
  const record = recoveryRecord(entry, pending);
  expect(store.save(record)).toBe(false); expect(store.read()).toEqual(record);
  store.clear(entry.roomId); expect(store.read()).toBeNull();
});

test('explicit departure keeps a validated pending request but disables automatic resume', () => {
  const f = recoveryFixture();
  const record = { ...recoveryRecord(entry, pending), autoResume: false as const };
  expect(f.recovery.save(record)).toBe(true);
  expect(f.recovery.read()).toEqual(record);
  for (const invalid of [true, null, 0, 'false']) {
    expect(parseRecoveryRecord(JSON.stringify({ ...record, autoResume: invalid }))).toBeNull();
  }
  // Original records are still readable; explicit entry enables normal recovery again.
  expect(f.recovery.save(recoveryRecord(entry, pending))).toBe(true);
  expect(f.recovery.read()).toEqual(recoveryRecord(entry, pending));
});
