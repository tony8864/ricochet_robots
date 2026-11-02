import { vi } from 'vitest';
import { roomRecoveryStore } from './roomRecovery';
import type { LifecycleEvent, RecoveryEnvironment } from './recoveryEnvironment';

export function recoveryFixture() {
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null,
    setItem: vi.fn((key: string, value: string) => { values.set(key, value); }),
    removeItem: vi.fn((key: string) => { values.delete(key); }) };
  const listeners = new Set<(event: LifecycleEvent) => void>();
  let online = true;
  const environment: RecoveryEnvironment = { online: () => online,
    watch: (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; } };
  return { values, storage, environment, listeners, recovery: roomRecoveryStore(() => storage),
    emit(event: LifecycleEvent) { if (event === 'offline') online = false; if (event === 'online') online = true; for (const listener of [...listeners]) listener(event); } };
}
