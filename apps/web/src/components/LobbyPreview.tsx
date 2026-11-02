import type { ReactNode } from 'react';
import type { MatchPlayer } from '@robot-puzzle/match';
import type { PuzzleBoard } from '@robot-puzzle/puzzles';
import type { RobotId, RobotPositions } from '@robot-puzzle/game-engine';
import { BoardSvg } from './BoardSvg';
import { LobbyRoster } from './LobbyRoster';
import { LobbyActions } from './LobbyActions';

/** Shared lobby presentation; local and authenticated state owners remain separate. */
export function LobbyPreview({ puzzle, players, hostSeatId, currentSeatId, header, headerAside, status,
  onShuffle, onStart, shuffleDisabled, startDisabled, shuffleLabel, startLabel, showActions = true, heading = 'Match setup',
  robots = puzzle.initialRobots, activeTargetId = null, eyebrow, detail = puzzle.name, roster, selectedRobot, onRobotSelect, boardKey }: {
  readonly puzzle: PuzzleBoard;
  readonly players: readonly MatchPlayer[];
  readonly hostSeatId: string;
  readonly currentSeatId: string;
  readonly headerAside?: ReactNode;
  readonly header?: ReactNode;
  readonly status?: ReactNode;
  readonly onShuffle: () => void;
  readonly onStart: () => void;
  readonly shuffleDisabled?: boolean;
  readonly startDisabled?: boolean;
  readonly shuffleLabel?: string;
  readonly startLabel?: string;
  readonly showActions?: boolean;
  readonly heading?: string;
  readonly robots?: RobotPositions;
  readonly activeTargetId?: string | null;
  readonly eyebrow?: string;
  readonly detail?: string;
  readonly roster?: ReactNode;
  readonly selectedRobot?: RobotId | null;
  readonly onRobotSelect?: (robotId: RobotId) => void;
  readonly boardKey?: number;
}) {
  return <>
    {header ?? <header className="board-preview__header">
      <div>{eyebrow && <p className="board-preview__eyebrow">{eyebrow}</p>}<h1>{heading}</h1><p className="setup-preview__board-name" aria-live="polite">{detail}</p></div>
      {headerAside}
    </header>}
    {status}
    <div className="board-preview__canvas">
      <BoardSvg key={boardKey} board={puzzle.board} robots={robots} targets={puzzle.targets} activeTargetId={activeTargetId}
        selectedRobot={selectedRobot} onRobotSelect={onRobotSelect} />
    </div>
    {roster ?? <LobbyRoster players={players} hostSeatId={hostSeatId} currentSeatId={currentSeatId} />}
    {showActions && <LobbyActions isHost={currentSeatId === hostSeatId}
      hostNickname={players.find((player) => player.seatId === hostSeatId)!.nickname}
      onShuffle={onShuffle} onStart={onStart} shuffleDisabled={shuffleDisabled}
      startDisabled={startDisabled} shuffleLabel={shuffleLabel} startLabel={startLabel} />}
  </>;
}
