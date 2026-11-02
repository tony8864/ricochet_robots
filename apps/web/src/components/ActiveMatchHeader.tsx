import type { ReactNode } from 'react';
import { RoomCode } from './RoomCode';
import { MatchActions } from './MatchActions';

/** Presentation only: the caller retains phase permissions and confirmation. */
export function ActiveMatchHeader({ round, phase, boardName, targetLabel, targetColor,
  roomCode, connectionLabel, recovery, countdown, onSkip, skipDisabled = false, onLeave, onEnd, endDisabled = false }: {
  readonly round: number;
  readonly phase: string;
  readonly boardName: string;
  readonly targetLabel: string | null;
  readonly targetColor?: string;
  readonly roomCode: string;
  readonly connectionLabel: string;
  readonly recovery?: ReactNode;
  readonly countdown?: ReactNode;
  readonly onSkip?: () => void;
  readonly skipDisabled?: boolean;
  readonly onLeave?: () => void;
  readonly onEnd?: () => void;
  readonly endDisabled?: boolean;
}) {
  return <header className="active-match-header">
    <div className="active-match-header__top">
      <div className="active-match-header__heading">
        <p className="active-match-header__round">ROUND {round} / 10</p>
        <div className="active-match-header__phase"><h1>{phase}</h1>{countdown}</div>
      </div>
      <div className="active-match-header__actions">
        <RoomCode code={roomCode} compact />
        <MatchActions onSkip={onSkip} skipDisabled={skipDisabled} onLeave={onLeave} onEnd={onEnd} endDisabled={endDisabled} />
      </div>
    </div>
    <div className="active-match-header__bottom">
      <p className="active-match-header__detail" title={targetLabel ? `${boardName} · ${targetLabel}` : boardName}>
        {boardName}{targetLabel && <> · <span style={{ color: targetColor }}>{targetLabel}</span></>}
      </p>
      <span className="active-match-header__connection" role="status">{connectionLabel}</span>
    </div>
    {recovery}
  </header>;
}

