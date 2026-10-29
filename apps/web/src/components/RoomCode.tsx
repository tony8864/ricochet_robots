import { useEffect, useState, useSyncExternalStore } from 'react';
import { roomCodeCopyFeedback, type RoomCodeCopyState } from '../lobby/copyRoomCode';

export function RoomCode({ code }: { readonly code: string }) {
  const [feedback] = useState(() => roomCodeCopyFeedback());
  const state = useSyncExternalStore(feedback.subscribe, feedback.getSnapshot, feedback.getSnapshot);
  useEffect(() => () => feedback.reset(), [feedback, code]);
  return <RoomCodeControl code={code} state={state} onCopy={() => void feedback.copy(code)} />;
}

export function RoomCodeControl({ code, state, onCopy }: {
  readonly code: string;
  readonly state: RoomCodeCopyState;
  readonly onCopy: () => void;
}) {
  return <div className="room-code">
    <span className="room-code__label">ROOM CODE</span>
    <button type="button" className="room-code__button" onClick={onCopy} disabled={state === 'copying'}
      aria-label={`Copy room code ${code}`} aria-busy={state === 'copying'}>
      <strong className="room-code__value">{code}</strong>
      <svg className="room-code__icon" data-copy-state={state} aria-hidden="true" focusable="false" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        {state === 'copied' ? <path d="m5 12 4 4L19 6" /> : <>
          <rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V4H4v12h4" />
        </>}
      </svg>
    </button>
    <span className={state === 'failed' ? 'room-code__feedback' : 'room-code__announcement'} role="status">
      {state === 'copied' ? 'Room code copied.' : state === 'failed' ? 'Couldn’t copy.' : ''}
    </span>
  </div>;
}
