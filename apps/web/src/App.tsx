import { BoardSvg } from './components/BoardSvg';
import { DEMO_GAME_STATE } from './fixtures/demoGameState';

export function App() {
  return (
    <main className="board-preview">
      <header className="board-preview__header">
        <p className="board-preview__eyebrow">Board preview</p>
        <h1>Robot Puzzle</h1>
        <p>Temporary board geometry for visual review.</p>
      </header>

      <div className="board-preview__canvas">
        <BoardSvg
          board={DEMO_GAME_STATE.board}
          robots={DEMO_GAME_STATE.robots}
          target={DEMO_GAME_STATE.target}
        />
      </div>

      <p className="board-preview__status">
        Read-only · Board, robots, and target
      </p>
    </main>
  );
}
