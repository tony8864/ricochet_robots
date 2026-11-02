import { useEffect, useId, useRef, type ReactNode } from 'react';
import { openModalDialog } from './modalDialog';

/** Same native modal, sizing and destructive-action styling as Leave Room. */
export function EndRoomDialog({ pending, disabled, feedback, onCancel, onConfirm }: {
  readonly pending: boolean; readonly disabled: boolean; readonly feedback?: ReactNode;
  readonly onCancel: () => void; readonly onConfirm: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null); const cancel = useRef<HTMLButtonElement>(null); const id = useId();
  useEffect(() => { const cleanup = openModalDialog(dialog.current!); cancel.current?.focus(); return cleanup; }, []);
  return <dialog ref={dialog} className="leave-room-dialog end-room-dialog" aria-modal="true" aria-labelledby={`${id}-heading`}
    aria-describedby={`${id}-details`} onCancel={(event) => { event.preventDefault(); if (!pending) onCancel(); }}>
    <h2 id={`${id}-heading`}>End this room for everyone?</h2>
    <p id={`${id}-details`}>Everyone will return to the entry screen. This room cannot be reopened.</p>
    {feedback}
    <div className="leave-room-dialog__actions">
      <button ref={cancel} type="button" disabled={pending} onClick={onCancel}>Cancel</button>
      <button type="button" className="leave-room-dialog__confirm" disabled={disabled || pending} onClick={onConfirm}>{pending ? 'Ending…' : 'End Room'}</button>
    </div>
  </dialog>;
}
