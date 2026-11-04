import { afterEach, expect, test, vi } from 'vitest';
import { browserRecoveryEnvironment, type LifecycleEvent } from './recoveryEnvironment';

afterEach(() => { vi.unstubAllGlobals(); });

test('browser lifecycle watch filters visibility and BFCache events and cleans up listeners', () => {
  const surface = new EventTarget();
  const document = Object.assign(new EventTarget(), { visibilityState: 'visible' });
  vi.stubGlobal('window', surface); vi.stubGlobal('document', document);
  const events: LifecycleEvent[] = [];
  const stop = browserRecoveryEnvironment.watch((event) => events.push(event));
  document.dispatchEvent(new Event('visibilitychange')); // Already visible: no resume.
  document.visibilityState = 'hidden'; document.dispatchEvent(new Event('visibilitychange'));
  document.visibilityState = 'visible'; document.dispatchEvent(new Event('visibilitychange'));
  surface.dispatchEvent(Object.assign(new Event('pageshow'), { persisted: false }));
  surface.dispatchEvent(Object.assign(new Event('pageshow'), { persisted: true }));
  surface.dispatchEvent(new Event('offline')); surface.dispatchEvent(new Event('online'));
  expect(events).toEqual(['resume', 'resume', 'offline', 'online']);
  stop();
  document.visibilityState = 'hidden'; document.dispatchEvent(new Event('visibilitychange'));
  document.visibilityState = 'visible'; document.dispatchEvent(new Event('visibilitychange'));
  surface.dispatchEvent(Object.assign(new Event('pageshow'), { persisted: true }));
  surface.dispatchEvent(new Event('offline')); surface.dispatchEvent(new Event('online'));
  expect(events).toHaveLength(4);
});

test('only an explicit browser offline hint is false; unknown support is not treated as disconnected', () => {
  for (const [navigator, expected] of [[{ onLine: false }, false], [{ onLine: true }, true], [{}, true], [undefined, true]] as const) {
    vi.stubGlobal('navigator', navigator);
    expect(browserRecoveryEnvironment.online()).toBe(expected);
  }
});

test('server/non-browser rendering can subscribe and clean up without browser APIs', () => {
  vi.stubGlobal('window', undefined); vi.stubGlobal('document', undefined);
  const changed = vi.fn(); const stop = browserRecoveryEnvironment.watch(changed);
  expect(() => stop()).not.toThrow(); expect(changed).not.toHaveBeenCalled();
});
