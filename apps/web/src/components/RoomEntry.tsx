import { useEffect, useId, useState, useSyncExternalStore } from 'react';
import { MAX_NICKNAME_CODE_POINTS } from '@robot-puzzle/shared';
import { inviteFromPath, normalizeNickname, normalizeRoomCode, readNickname, rememberNickname } from '../entry/entryDraft';
import { roomEntryClient, type RoomEntryClient } from '../entry/roomEntryClient';
import { ConnectedLobby } from './ConnectedLobby';

interface RoomEntryProps {
  readonly pathname: string;
  readonly showSimulator?: boolean;
  readonly initialNickname?: string;
  readonly client?: RoomEntryClient;
}

export function RoomEntry({ pathname, showSimulator = false, initialNickname, client }: RoomEntryProps) {
  const id = useId();
  const [nickname, setNickname] = useState(() => initialNickname ?? readNickname());
  const [invite] = useState(() => inviteFromPath(pathname));
  const [code, setCode] = useState(invite.code);
  const [nicknameTouched, setNicknameTouched] = useState(false);
  const [codeTouched, setCodeTouched] = useState(false);
  const [flow] = useState(() => client ?? roomEntryClient());
  const creation = useSyncExternalStore(flow.subscribe, flow.getSnapshot, flow.getSnapshot);
  const pending = creation.status === 'pending';
  const retryable = creation.status === 'error' && creation.retryable;
  const sessionExpired = creation.status === 'error' && creation.sessionExpired;
  const fieldsLocked = pending || retryable || sessionExpired;
  const joining = (creation.status === 'pending' || creation.status === 'error') && creation.action === 'join';
  const createPending = pending && !joining;
  const joinPending = pending && joining;
  const createRetry = retryable && !joining;
  const joinRetry = retryable && joining;
  const validNickname = normalizeNickname(nickname);
  const validCode = normalizeRoomCode(code);
  const nicknameError = nicknameTouched && !validNickname;
  const codeError = (codeTouched && !validCode) || (invite.invalid && !code);

  useEffect(() => { rememberNickname(nickname); }, [nickname]);

  const create = () => { void (createRetry ? flow.retry() : flow.create(nickname)); };
  const join = () => { void (joinRetry ? flow.retry() : flow.join(nickname, code)); };
  const errorFeedback = creation.status === 'error' && <>
    <p id={`${id}-${joining ? 'join' : 'create'}-error`} role="alert" className="room-entry__hint room-entry__error">{creation.message}</p>
    {retryable && <p className="room-entry__hint">Retry keeps the same nickname, room code and request to avoid duplicate rooms or seats. Keep this page open until it completes.</p>}
    {sessionExpired && <button type="button" className="room-entry__button room-entry__button--secondary" onClick={flow.startNewSession}>Start a new session</button>}
  </>;

  if (creation.status === 'entered') {
    return <ConnectedLobby entry={creation.entry} />;
  }

  return (
    <main className="room-entry">
      <div className="room-entry__content">
        <header className="room-entry__brand">
          <div className="room-entry__dots" aria-hidden="true">
            {(['red', 'blue', 'green', 'yellow'] as const).map((color) => <span key={color} className={`room-entry__dot room-entry__dot--${color}`} />)}
          </div>
          <h1>Robot Puzzle</h1>
          <p>Play together. Solve the puzzle.</p>
        </header>

        <form className="room-entry__form" noValidate onSubmit={(event) => {
          event.preventDefault();
          if (fieldsLocked) { if (retryable) void flow.retry(); return; }
          if (validNickname && (!code || validCode)) { if (code) join(); else create(); }
        }}>
          <div className="room-entry__field">
            <label htmlFor={`${id}-nickname`}>YOUR NICKNAME</label>
            <input id={`${id}-nickname`} name="nickname" type="text" autoComplete="nickname"
              placeholder="Enter your nickname" value={nickname} aria-invalid={nicknameError} disabled={fieldsLocked}
              aria-describedby={`${id}-nickname-help`} enterKeyHint="next"
              onChange={(event) => setNickname(event.target.value)}
              onBlur={() => { setNicknameTouched(true); if (validNickname) setNickname(validNickname); }} />
            <p id={`${id}-nickname-help`} aria-live="polite" className={`room-entry__hint${nicknameError ? ' room-entry__error' : ''}`}>
              {nicknameError ? `Enter a nickname of 1–${MAX_NICKNAME_CODE_POINTS} characters.` : `Up to ${MAX_NICKNAME_CODE_POINTS} characters. Remembered on this device.`}
            </p>
          </div>

          <div className="room-entry__action">
            <button type="button" className="room-entry__button room-entry__button--primary" disabled={pending || sessionExpired || joinRetry || (!createRetry && !validNickname)}
              aria-busy={createPending} aria-describedby={creation.status === 'error' && !joining ? `${id}-create-error` : undefined} onClick={create}>
              {createPending ? <span className="room-entry__spinner" aria-hidden="true" /> : <svg className="room-entry__button-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M12 5v14M5 12h14" />
              </svg>}
              {createPending ? 'Creating Room…' : createRetry ? 'Retry Create Room' : 'Create Room'}
            </button>
            {createPending && <p role="status" className="room-entry__hint">Creating your room…</p>}
            {!joining && errorFeedback}
          </div>

          <div className="room-entry__divider"><span>OR</span></div>

          <section className="room-entry__join" aria-labelledby={`${id}-join-label`}>
            <div className="room-entry__field">
              <label id={`${id}-join-label`} htmlFor={`${id}-code`}>ROOM CODE</label>
              {invite.code && <p className="room-entry__hint">You’re invited! Enter your nickname, then join this room.</p>}
              <input id={`${id}-code`} name="room-code" type="text" autoComplete="off" autoCapitalize="characters"
                spellCheck={false} placeholder="Enter room code" value={code} enterKeyHint="go" disabled={fieldsLocked}
                aria-invalid={codeError} aria-describedby={codeError ? `${id}-code-error` : undefined}
                onChange={(event) => setCode(event.target.value.trim().toUpperCase())}
                onBlur={() => setCodeTouched(true)} />
              {codeError && <p id={`${id}-code-error`} role="alert" className="room-entry__hint room-entry__error">Enter a valid six-character room code.</p>}
            </div>
            <button type="button" className="room-entry__button room-entry__button--secondary"
              disabled={pending || sessionExpired || createRetry || (!joinRetry && (!validNickname || !validCode))}
              aria-busy={joinPending} aria-describedby={creation.status === 'error' && joining ? `${id}-join-error` : undefined} onClick={join}>
              {joinPending ? <span className="room-entry__spinner" aria-hidden="true" /> : <svg className="room-entry__button-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 4h6v16h-6M4 12h11m-4-4 4 4-4 4" />
              </svg>}
              {joinPending ? 'Joining Room…' : joinRetry ? 'Retry Join Room' : 'Join Room'}
            </button>
            {joinPending && <p role="status" className="room-entry__hint">Joining your room…</p>}
            {joining && errorFeedback}
          </section>
        </form>

        <p className="room-entry__preview">Private rooms for 2–6 players. Internet connection required.</p>
        {showSimulator && <a className="room-entry__simulator" href="/?preview=local">Open local simulator (development)</a>}
      </div>
    </main>
  );
}
