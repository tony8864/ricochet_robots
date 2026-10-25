export interface RosterMotionRow {
  readonly seatId: string;
  readonly top: number;
  readonly visualOffset: number;
  readonly animate: (fromY: number) => Animation | null;
}

/** FLIP presentation: the DOM/model order is already correct before any animation. */
export function createRosterMotion(reducedMotion: () => boolean) {
  let previous = new Map<string, number>();
  const active = new Map<string, Animation>();

  function cancel() {
    for (const animation of active.values()) animation.cancel();
    active.clear();
  }

  return {
    cancel,
    update(rows: readonly RosterMotionRow[]) {
      const before = previous;
      previous = new Map(rows.map((row) => [row.seatId, row.top]));
      // Offsets are read by the caller before cancellation, so rapid updates can
      // continue from the current visual position rather than snap to an old slot.
      cancel();
      if (reducedMotion()) return;
      for (const row of rows) {
        const oldTop = before.get(row.seatId);
        if (oldTop === undefined) continue; // Never animate the initial roster.
        const delta = oldTop - row.top + row.visualOffset;
        if (Math.abs(delta) < 0.5) continue;
        const animation = row.animate(delta);
        if (!animation) continue;
        active.set(row.seatId, animation);
        const done = () => { if (active.get(row.seatId) === animation) active.delete(row.seatId); };
        void animation.finished.then(done, done);
      }
    },
  };
}
