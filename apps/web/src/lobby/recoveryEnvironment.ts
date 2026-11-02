export type LifecycleEvent = 'offline' | 'online' | 'resume';
export interface RecoveryEnvironment {
  online(): boolean;
  watch(listener: (event: LifecycleEvent) => void): () => void;
}
export const browserRecoveryEnvironment: RecoveryEnvironment = {
  online: () => typeof navigator === 'undefined' || navigator.onLine !== false,
  watch(listener) {
    if (typeof window === 'undefined' || typeof document === 'undefined') return () => {};
    let hidden = document.visibilityState === 'hidden';
    const offline = () => listener('offline');
    const online = () => listener('online');
    const visibility = () => {
      const wasHidden = hidden; hidden = document.visibilityState === 'hidden';
      if (wasHidden && !hidden) listener('resume');
    };
    const pageshow = (event: PageTransitionEvent) => { if (event.persisted) listener('resume'); };
    window.addEventListener('offline', offline); window.addEventListener('online', online);
    window.addEventListener('pageshow', pageshow); document.addEventListener('visibilitychange', visibility);
    return () => {
      window.removeEventListener('offline', offline); window.removeEventListener('online', online);
      window.removeEventListener('pageshow', pageshow); document.removeEventListener('visibilitychange', visibility);
    };
  },
};
export function reconnectDelay(step: number, random: () => number): number {
  const base = [0, 1000, 2000, 4000, 8000, 15000][Math.min(step, 5)];
  return Math.min(15000, Math.round(base * (0.8 + Math.max(0, Math.min(1, random())) * 0.4)));
}
