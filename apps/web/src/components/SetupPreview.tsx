import { useState } from 'react';
import { getPuzzleBoard, type PuzzleBoard } from '@robot-puzzle/puzzles';
import { DEMO_BOARD_ID, LOCAL_HOST_SEAT_ID, LOCAL_PLAYERS } from '../local/config';
import { LocalPlayerSwitcher } from './LocalPlayerSwitcher';
import { LobbyPreview } from './LobbyPreview';
import { shufflePreviewBoard } from '../local/shufflePreviewBoard';
import { App } from '../App';
import { createLobbyMatchStarter } from '../local/startLobbyMatch';
import type { LocalMatchController } from '../local/controller';

const configuredBoard = getPuzzleBoard(DEMO_BOARD_ID);
if (!configuredBoard) throw new Error(`Unknown preview board: ${DEMO_BOARD_ID}`);
const defaultBoard: PuzzleBoard = configuredBoard;

/** Pre-match state stays outside T11 until an explicit host start action. */
export function SetupPreview({ puzzle = defaultBoard }: { readonly puzzle?: PuzzleBoard }) {
  const [actingSeatId, setActingSeatId] = useState<string>(LOCAL_HOST_SEAT_ID);
  const [previewPuzzle, setPreviewPuzzle] = useState(puzzle);
  const [starter] = useState(() => createLobbyMatchStarter({
    players: LOCAL_PLAYERS, hostSeatId: LOCAL_HOST_SEAT_ID, now: () => Date.now(),
  }));
  const [controller, setController] = useState<LocalMatchController | null>(null);

  function shuffleBoard() {
    if (controller) return;
    // Sample once in the event handler, never inside a React state updater.
    setPreviewPuzzle(shufflePreviewBoard(previewPuzzle, actingSeatId, LOCAL_HOST_SEAT_ID));
  }

  function startMatch() {
    const started = starter.start(previewPuzzle, actingSeatId);
    if (started) setController(started);
  }

  function newMatch() {
    if (!controller || !starter.returnToLobby(controller)) return;
    const snapshot = controller.getSnapshot();
    setActingSeatId(snapshot.actingSeatId);
    setPreviewPuzzle(snapshot.match.puzzle);
    setController(null);
  }

  if (controller) return <App controller={controller} onNewMatch={newMatch} />;

  return (
    <main className="board-preview">
      <LocalPlayerSwitcher
        players={LOCAL_PLAYERS}
        hostSeatId={LOCAL_HOST_SEAT_ID}
        actingSeatId={actingSeatId}
        onActAs={setActingSeatId}
      />
      <LobbyPreview puzzle={previewPuzzle} players={LOCAL_PLAYERS} hostSeatId={LOCAL_HOST_SEAT_ID}
        currentSeatId={actingSeatId} onShuffle={shuffleBoard} onStart={startMatch} />
    </main>
  );
}
