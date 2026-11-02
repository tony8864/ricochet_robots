import { afterEach, expect, test, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { entryTestId, roomEnteredFixture } from './roomEntry.testFixture';
import { entryRecovery, type EntryRecovery } from './entryRecovery';
import { recoveryRecord } from '../lobby/roomRecovery';
import { recoveryFixture } from '../lobby/recovery.testFixture';
import { RoomEntry } from '../components/RoomEntry';
import type { ResumeResult } from './resumeRoom';

const flows: EntryRecovery[] = [];
afterEach(() => { for (const flow of flows.splice(0)) flow.stop(); vi.useRealTimers(); });
function setup(pathname = '/', result?: ResumeResult) {
  vi.useFakeTimers(); vi.setSystemTime(0);
  const f = recoveryFixture(); const entry = { ...roomEnteredFixture(entryTestId(1)), membership: 'resumed' as const };
  f.recovery.save(recoveryRecord(entry, null));
  const resume = vi.fn(async (): Promise<ResumeResult> => result ?? { status: 'resumed', entry });
  const flow = entryRecovery(pathname, { ...f, now: () => Date.now(), random: () => 0.5, resume }); flows.push(flow);
  return { ...f, entry, resume, flow };
}

test('refresh uses authenticated resume first and Strict Mode setup/cleanup submits once', async () => {
  const f = setup();
  const markup = renderToStaticMarkup(<RoomEntry pathname="/" recovery={f.flow} />);
  expect(markup).toContain('Restoring your room'); expect(markup).not.toContain('>Create Room</button>');
  expect(f.resume).not.toHaveBeenCalled();
  f.flow.start(); f.flow.stop(); f.flow.start(); await vi.advanceTimersByTimeAsync(0);
  expect(f.resume).toHaveBeenCalledOnce(); expect(f.resume.mock.calls[0]).toBeDefined();
  expect(f.flow.getSnapshot()).toEqual({ status: 'resumed', entry: f.entry });
  expect(f.listeners.size).toBe(0);
});

test('an explicit different invite or invalid invite never silently enters the stored room', async () => {
  for (const path of ['/room/DEF678', '/room/not-a-code']) {
    const f = setup(path); f.flow.start(); await vi.advanceTimersByTimeAsync(0);
    expect(f.flow.getSnapshot().status).toBe('entry'); expect(f.resume).not.toHaveBeenCalled();
  }
});

test('same-code invite restores the existing seat without asking for a nickname again', async () => {
  const f = setup('/room/ABC234'); f.flow.start(); await vi.advanceTimersByTimeAsync(0);
  expect(f.flow.getSnapshot().status).toBe('resumed');
});

test('confirmed departure navigates to entry without deleting the pending request or resuming after refresh', async () => {
  const f = setup(); f.flow.start(); await vi.advanceTimersByTimeAsync(0);
  const request = { version: 2 as const, commandId: entryTestId(900), roomId: f.entry.roomId, context: {}, command: { type: 'state.request' as const } };
  const saved = { ...recoveryRecord(f.entry, request), autoResume: false as const };
  f.recovery.save(saved); f.flow.depart();
  expect(f.flow.getSnapshot()).toEqual({ status: 'entry', message: 'You left the room.' });
  expect(f.recovery.read()).toEqual(saved);
  const refreshed = entryRecovery('/room/ABC234', { ...f, resume: f.resume }); flows.push(refreshed);
  refreshed.start(); refreshed.retry(); f.emit('online'); f.emit('resume');
  await vi.advanceTimersByTimeAsync(120000);
  expect(refreshed.getSnapshot().status).toBe('entry'); expect(f.resume).toHaveBeenCalledOnce();
  const markup = renderToStaticMarkup(<RoomEntry pathname="/" recovery={refreshed} initialNickname="Guest" />);
  expect(markup).toContain('value="Guest"'); expect(markup).toContain('Create Room');
});

test('offline/online and manual retries share one bounded recovery attempt', async () => {
  const f = setup('/', { status: 'transient', message: 'Unavailable.' });
  f.emit('offline'); f.flow.start(); await vi.advanceTimersByTimeAsync(30000); expect(f.resume).not.toHaveBeenCalled();
  f.emit('online'); f.flow.retry(); f.flow.retry(); await vi.advanceTimersByTimeAsync(0); expect(f.resume).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(9999); expect(f.resume).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1); expect(f.resume).toHaveBeenCalledTimes(2);
  f.flow.returnToEntry(); await vi.advanceTimersByTimeAsync(60000);
  expect(f.resume).toHaveBeenCalledTimes(2); expect(f.recovery.read()).toBeNull(); expect(f.listeners.size).toBe(0);
});

test.each(['closed', 'expired', 'error'] as const)('%s recovery stops automatic retries and exposes honest entry feedback', async (status) => {
  const f = setup('/', { status, message: 'Recovery unavailable.' }); f.flow.start(); await vi.advanceTimersByTimeAsync(120000);
  expect(f.resume).toHaveBeenCalledOnce(); expect(f.flow.getSnapshot().status).toBe(status === 'closed' ? 'entry' : status);
  const markup = renderToStaticMarkup(<RoomEntry pathname="/" recovery={f.flow} />);
  expect(markup).toContain('Recovery unavailable.');
  if (status === 'expired') { expect(markup).toContain('Start a new session'); expect(markup).not.toContain('>Create Room</button>'); }
  if (status === 'closed' || status === 'expired') expect(f.recovery.read()).toBeNull();
});

test('mismatched membership/seat never reaches the connected screen', async () => {
  const f = setup(); f.resume.mockResolvedValue({ status: 'resumed', entry: { ...f.entry, seatId: entryTestId(999) } });
  f.flow.start(); await vi.advanceTimersByTimeAsync(0); expect(f.flow.getSnapshot().status).toBe('error');
});
