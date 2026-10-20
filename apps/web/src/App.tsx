import { useState } from 'react';
import {
  createAttempt,
  getAttemptMoveCount,
  isTargetComplete,
  moveAttemptRobot,
  ROBOT_IDS,
  resetAttempt,
  undoAttempt,
  type Direction,
  type RobotId,
} from '@robot-puzzle/game-engine';
import { BoardSvg } from './components/BoardSvg';
import {
  DEMO_BID_LIMIT,
  DEMO_GAME_STATE,
} from './fixtures/demoGameState';

const ROBOT_LABELS: Readonly<Record<RobotId, string>> = {
  red: 'R',
  blue: 'B',
  green: 'G',
  yellow: 'Y',
};

const ROBOT_NAMES: Readonly<Record<RobotId, string>> = {
  red: 'Red',
  blue: 'Blue',
  green: 'Green',
  yellow: 'Yellow',
};

function getDefaultRobot(): RobotId {
  return DEMO_GAME_STATE.target.kind === 'colored'
    ? DEMO_GAME_STATE.target.robotId
    : 'red';
}

export function App() {
  const [selectedRobot, setSelectedRobot] = useState<RobotId>(getDefaultRobot);
  const [attempt, setAttempt] = useState(() =>
    createAttempt(DEMO_GAME_STATE.robots),
  );
  const [givenUp, setGivenUp] = useState(false);
  const moveCount = getAttemptMoveCount(attempt);
  const targetReached = isTargetComplete(attempt.robots, DEMO_GAME_STATE.target);

  function moveSelectedRobot(direction: Direction) {
    setAttempt((currentAttempt) => {
      if (
        getAttemptMoveCount(currentAttempt) >= DEMO_BID_LIMIT ||
        givenUp ||
        isTargetComplete(currentAttempt.robots, DEMO_GAME_STATE.target)
      ) {
        return currentAttempt;
      }

      return moveAttemptRobot(
        DEMO_GAME_STATE.board,
        currentAttempt,
        selectedRobot,
        direction,
      ).attempt;
    });
  }

  function handleUndo() {
    if (targetReached || givenUp) return;
    setAttempt((currentAttempt) => undoAttempt(currentAttempt));
  }

  function handleReset() {
    setAttempt((currentAttempt) => resetAttempt(currentAttempt));
    setGivenUp(false);
  }

  function handleGiveUp() {
    if (targetReached || givenUp) return;
    setAttempt((currentAttempt) => resetAttempt(currentAttempt));
    setGivenUp(true);
  }

  return (
    <main className="board-preview">
      <header className="board-preview__header">
        <div>
          <p className="board-preview__eyebrow">Local demonstration</p>
          <h1>Your turn</h1>
        </div>
        <p
          aria-label={`${moveCount} of ${DEMO_BID_LIMIT} moves used`}
          className="board-preview__move-count"
        >
          <span>Moves</span>
          <strong>{moveCount} / {DEMO_BID_LIMIT}</strong>
        </p>
      </header>

      <div className="demo-layout">
        <div className="board-preview__canvas">
          <BoardSvg
            board={DEMO_GAME_STATE.board}
            onRobotSelect={setSelectedRobot}
            robots={attempt.robots}
            selectedRobot={selectedRobot}
            target={DEMO_GAME_STATE.target}
          />
        </div>

        <section aria-label="Demonstration controls" className="demo-controls">
          <div
            aria-labelledby="robot-selector-label"
            className="robot-selection"
            role="group"
          >
            <p className="robot-selection__label" id="robot-selector-label">
              Select robot
            </p>
            <div className="robot-selector">
              {ROBOT_IDS.map((robotId) => (
                <button
                  aria-label={`Select ${robotId} robot`}
                  aria-pressed={selectedRobot === robotId}
                  className={`robot-selector__button robot-selector__button--${robotId}`}
                  key={robotId}
                  onClick={() => setSelectedRobot(robotId)}
                  type="button"
                >
                  {ROBOT_LABELS[robotId]}
                </button>
              ))}
            </div>
          </div>

          <div aria-label="Movement controls" className="direction-pad" role="group">
            <button
              aria-label="Move selected robot up"
              className="direction-pad__button direction-pad__button--up"
              disabled={moveCount >= DEMO_BID_LIMIT || targetReached || givenUp}
              onClick={() => moveSelectedRobot('up')}
              type="button"
            >
              <span aria-hidden="true">↑</span>
            </button>
            <button
              aria-label="Move selected robot left"
              className="direction-pad__button direction-pad__button--left"
              disabled={moveCount >= DEMO_BID_LIMIT || targetReached || givenUp}
              onClick={() => moveSelectedRobot('left')}
              type="button"
            >
              <span aria-hidden="true">←</span>
            </button>
            <button
              aria-label="Move selected robot down"
              className="direction-pad__button direction-pad__button--down"
              disabled={moveCount >= DEMO_BID_LIMIT || targetReached || givenUp}
              onClick={() => moveSelectedRobot('down')}
              type="button"
            >
              <span aria-hidden="true">↓</span>
            </button>
            <button
              aria-label="Move selected robot right"
              className="direction-pad__button direction-pad__button--right"
              disabled={moveCount >= DEMO_BID_LIMIT || targetReached || givenUp}
              onClick={() => moveSelectedRobot('right')}
              type="button"
            >
              <span aria-hidden="true">→</span>
            </button>
          </div>

          <div aria-label="Attempt actions" className="attempt-actions" role="group">
            <button
          aria-label="Undo last move"
          className="attempt-actions__button"
          disabled={moveCount === 0 || targetReached || givenUp}
          onClick={handleUndo}
          type="button"
        >
              <span aria-hidden="true" className="attempt-actions__icon">
                ↶
              </span>
              <span>Undo</span>
            </button>
            <button
          aria-label="Reset attempt"
          className="attempt-actions__button"
          onClick={handleReset}
          type="button"
        >
              <span aria-hidden="true" className="attempt-actions__icon">
                ⟲
              </span>
              <span>Reset</span>
            </button>
            <button
          aria-label="Give up"
          className="attempt-actions__button attempt-actions__button--give-up"
          disabled={targetReached || givenUp}
          onClick={handleGiveUp}
          type="button"
        >
              <span aria-hidden="true" className="attempt-actions__icon">
                ×
              </span>
              <span>Give Up</span>
            </button>
          </div>

          <p aria-live="polite" className="board-preview__status">
            {targetReached
              ? `Target reached in ${moveCount} moves`
              : givenUp
                ? 'Demonstration given up'
                : `${ROBOT_NAMES[selectedRobot]} robot selected`}
          </p>
        </section>
      </div>
    </main>
  );
}
