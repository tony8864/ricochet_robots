import type { ReactNode } from 'react';
import type { MatchPlayer } from '@robot-puzzle/match';
import type { PuzzleBoard } from '@robot-puzzle/puzzles';
import { BoardSvg } from './BoardSvg';
import { LobbyRoster } from './LobbyRoster';
import { LobbyActions } from './LobbyActions';

/** Shared lobby presentation; local and authenticated state owners remain separate. */
export function LobbyPreview({ puzzle, players, hostSeatId, currentSeatId, headerAside, status,
  onShuffle, onStart, shuffleDisabled, startDisabled, shuffleLabel }: {
  readonly puzzle: PuzzleBoard;
  readonly players: readonly MatchPlayer[];
  readonly hostSeatId: string;
  readonly currentSeatId: string;
  readonly headerAside?: ReactNode;
  readonly status?: ReactNode;
  readonly onShuffle: () => void;
  readonly onStart: () => void;
  readonly shuffleDisabled?: boolean;
  readonly startDisabled?: boolean;
  readonly shuffleLabel?: string;
}) {
  return <>
    <header className="board-preview__header">
      <div><h1>Match setup</h1><p className="setup-preview__board-name" aria-live="polite">{puzzle.name}</p></div>
      {headerAside}
    </header>
    {status}
    <div className="board-preview__canvas">
      <BoardSvg board={puzzle.board} robots={puzzle.initialRobots} targets={puzzle.targets} activeTargetId={null} />
    </div>
    <LobbyRoster players={players} hostSeatId={hostSeatId} currentSeatId={currentSeatId} />
    <LobbyActions isHost={currentSeatId === hostSeatId}
      hostNickname={players.find((player) => player.seatId === hostSeatId)!.nickname}
      onShuffle={onShuffle} onStart={onStart} shuffleDisabled={shuffleDisabled}
      startDisabled={startDisabled} shuffleLabel={shuffleLabel} />
  </>;
}
