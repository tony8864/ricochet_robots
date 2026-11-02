import { useEffect, useId, useRef, useState } from 'react';
import { flushSync } from 'react-dom';

/** Administrative actions only; callers own permissions and confirmation. */
export function MatchActions({ onSkip, skipDisabled = false, onLeave, onEnd, endDisabled = false }: {
  readonly onSkip?: () => void;
  readonly skipDisabled?: boolean;
  readonly onLeave?: () => void;
  readonly onEnd?: () => void;
  readonly endDisabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); setOpen(false); trigger.current?.focus(); }
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);
  if (!onSkip && !onLeave && !onEnd) return null;
  const select = (action: () => void) => {
    flushSync(() => setOpen(false));
    trigger.current?.focus();
    action();
  };
  return <div className="match-actions" ref={root} onBlur={(event) => {
    if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
  }}>
    <button ref={trigger} type="button" className="match-actions__toggle" aria-label="More actions"
      aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>
      <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">
        <circle cx="5" cy="12" r="1.5" /><circle cx="12" cy="12" r="1.5" /><circle cx="19" cy="12" r="1.5" />
      </svg>
    </button>
    <div id={id} className="match-actions__panel" hidden={!open} role="group" aria-label="Match actions">
      {onSkip && <button type="button" disabled={skipDisabled} onClick={() => select(onSkip)}>
        <svg className="match-actions__skip-icon" width="16" height="16" viewBox="0 0 24 24"
          fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
          aria-hidden="true" focusable="false"><path d="m5 4 12 8-12 8V4Z" /><path d="M19 4v16" /></svg>Skip Round
      </button>}
      {onLeave && <button type="button" onClick={() => select(onLeave)}>
        <svg className="match-actions__leave-icon" width="16" height="16" viewBox="0 0 24 24"
          fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
          aria-hidden="true" focusable="false"><path d="M9 5H4v14h5M14 8l4 4-4 4M8 12h10" /></svg>Leave Room
      </button>}
      {onEnd && <>
        <div className="match-actions__separator" role="separator" />
        <button type="button" className="match-actions__end" disabled={endDisabled} onClick={() => select(onEnd)}>
          {/* Lucide DoorClosed, ISC; see public/lucide-license.txt. */}
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
            strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
            <path d="M19 21V5a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2v16" /><path d="M2 21h20" /><path d="M9 12h.01" />
          </svg>End Room
        </button>
      </>}
    </div>
  </div>;
}
