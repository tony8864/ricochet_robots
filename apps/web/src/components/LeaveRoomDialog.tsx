import { useEffect, useId, useRef } from 'react';
import { openModalDialog } from './modalDialog';

export function LeaveRoomDialog({ unresolved, error, onCancel, onConfirm }: {
  readonly unresolved: boolean;
  readonly error: string;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const id = useId();
  useEffect(() => {
    const close = openModalDialog(dialog.current!);
    cancel.current?.focus();
    return close;
  }, []);
  return <dialog ref={dialog} className="leave-room-dialog" aria-modal="true" aria-labelledby={`${id}-heading`}
    aria-describedby={`${id}-details`} onCancel={(event) => { event.preventDefault(); onCancel(); }}>
    <h2 id={`${id}-heading`}>Leave this room?</h2>
    <div id={`${id}-details`}>
      <p>Your seat, bids and points will be kept. You can return with this browser while your session and the room remain available.</p>
      <p>Only this tab will leave. Other tabs stay connected.</p>
      {unresolved && <p>Your pending request may already have been accepted. Leaving does not cancel it; you can retry it after rejoining.</p>}
    </div>
    {error && <p role="alert">{error}</p>}
    <div className="leave-room-dialog__actions">
      <button ref={cancel} type="button" onClick={onCancel}>Cancel</button>
      <button type="button" className="leave-room-dialog__confirm" onClick={onConfirm}>Leave Room</button>
    </div>
  </dialog>;
}
