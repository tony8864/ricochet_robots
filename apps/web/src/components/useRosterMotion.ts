import { useLayoutEffect, useRef, type RefObject } from 'react';
import { createRosterMotion } from './rosterMotion';

export function useRosterMotion(listRef: RefObject<HTMLUListElement | null>, orderKey: string, enabled: boolean) {
  const motion = useRef<ReturnType<typeof createRosterMotion> | null>(null);

  useLayoutEffect(() => {
    if (!enabled) return;
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    const animator = createRosterMotion(() => preference.matches);
    motion.current = animator;
    const preferenceChanged = () => { if (preference.matches) animator.cancel(); };
    preference.addEventListener('change', preferenceChanged);
    return () => {
      preference.removeEventListener('change', preferenceChanged);
      animator.cancel();
      motion.current = null;
    };
  }, [enabled]);

  useLayoutEffect(() => {
    const list = listRef.current;
    if (!enabled || !list || !motion.current) return;
    // Measure all rows first, including any currently running translation.
    const rows = Array.from(list.children).map((element) => {
      const node = element as HTMLLIElement;
      let visualOffset = 0;
      const transform = window.getComputedStyle(node).transform;
      if (transform && transform !== 'none') {
        try { visualOffset = new DOMMatrixReadOnly(transform).m42; } catch { /* No motion interpolation support. */ }
      }
      return {
        seatId: node.dataset.seatId!, top: node.offsetTop, visualOffset,
        animate: (fromY: number) => typeof node.animate === 'function' ? node.animate(
          [{ transform: `translateY(${fromY}px)` }, { transform: 'translateY(0)' }],
          { duration: 180, easing: 'ease-out' },
        ) : null,
      };
    });
    motion.current.update(rows);
  }, [listRef, orderKey, enabled]);
}
