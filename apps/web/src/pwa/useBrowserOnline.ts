import { useSyncExternalStore } from 'react';
import { browserRecoveryEnvironment } from '../lobby/recoveryEnvironment';

// Reuse lifecycle events, not a second connectivity/recovery state machine.
// `true` only permits a request; it never establishes a server connection.
export const readBrowserOnline = () => browserRecoveryEnvironment.online();
const subscribe = (changed: () => void) => browserRecoveryEnvironment.watch(() => changed());
export function useBrowserOnline(): boolean {
  return useSyncExternalStore(subscribe, readBrowserOnline, readBrowserOnline);
}
