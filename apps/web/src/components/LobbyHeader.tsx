import type { ReactNode } from 'react';
import { RoomCode } from './RoomCode';
import { MatchActions } from './MatchActions';

/** Lobby presentation only; room actions and connection recovery stay with the caller. */
export function LobbyHeader({ boardName, roomCode, connectionLabel, recovery, onLeave, onEnd, endDisabled = false }: {
  readonly boardName: string;
  readonly roomCode: string;
  readonly connectionLabel: string;
  readonly recovery?: ReactNode;
  readonly onLeave?: () => void;
  readonly onEnd?: () => void;
  readonly endDisabled?: boolean;
}) {
  return <header className="lobby-header">
    <div className="lobby-header__top">
      <div className="lobby-header__heading">
        <h1>Match setup</h1>
        <p className="lobby-header__board" title={boardName} aria-live="polite">{boardName}</p>
      </div>
      <div className="active-match-header__actions">
        <RoomCode code={roomCode} compact /><MatchActions onLeave={onLeave} onEnd={onEnd} endDisabled={endDisabled} />
      </div>
    </div>
    <div className="lobby-header__bottom">
      <p className="lobby-header__waiting">Lobby · Waiting for players</p>
      <span className="lobby-header__connection" role="status">{connectionLabel}</span>
    </div>
    {recovery}
  </header>;
}
