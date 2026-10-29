/** Clipboard denial must never look like a successful copy. */
export async function copyRoomCode(code: string, write: (text: string) => Promise<void> =
  (text) => navigator.clipboard.writeText(text)): Promise<boolean> {
  try { await write(code); return true; }
  catch { return false; }
}

export type RoomCodeCopyState = 'idle' | 'copying' | 'copied' | 'failed';

/** Own the short feedback lifetime independently of the clipboard permission/result. */
export function roomCodeCopyFeedback(write?: (text: string) => Promise<void>) {
  let state: RoomCodeCopyState = 'idle';
  let generation = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const listeners = new Set<() => void>();
  const publish = (next: RoomCodeCopyState) => { state = next; listeners.forEach((listener) => listener()); };
  return {
    getSnapshot: () => state,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    copy: async (code: string) => {
      if (state === 'copying') return;
      const current = ++generation;
      clearTimeout(timer);
      publish('copying');
      const copied = await copyRoomCode(code, write);
      if (generation !== current) return;
      publish(copied ? 'copied' : 'failed');
      if (copied) timer = setTimeout(() => { if (generation === current) publish('idle'); }, 1_500);
    },
    reset: () => {
      ++generation;
      clearTimeout(timer);
      publish('idle');
    },
  };
}
