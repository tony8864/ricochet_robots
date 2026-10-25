import { ROBOT_IDS, type Direction, type RobotId } from '@robot-puzzle/game-engine';

const ROBOT_NAMES = { red: 'Red', blue: 'Blue', green: 'Green', yellow: 'Yellow' } as const;
const ARROWS = [
  ['up', '↑'], ['left', '←'], ['down', '↓'], ['right', '→'],
] as const;

export function DemonstrationControls(props: {
  readonly selectedRobot: RobotId;
  readonly moveCount: number;
  readonly onSelect: (robotId: RobotId) => void;
  readonly onMove: (direction: Direction) => void;
  readonly onUndo: () => void;
  readonly onReset: () => void;
  readonly onGiveUp: () => void;
  readonly feedback: string | null;
}) {
  return (
    <section aria-label="Demonstration controls" className="demo-controls">
      <div aria-label="Robot selection" className="robot-selection" role="group">
        <div className="robot-selector">
          {ROBOT_IDS.map((robotId) => (
            <button
              aria-label={`Select ${robotId} robot`}
              aria-pressed={props.selectedRobot === robotId}
              className={`robot-selector__button robot-selector__button--${robotId}`}
              key={robotId}
              onClick={() => props.onSelect(robotId)}
              type="button"
            >{ROBOT_NAMES[robotId][0]}</button>
          ))}
        </div>
      </div>
      <div aria-label="Movement controls" className="direction-pad" role="group">
        {ARROWS.map(([direction, arrow]) => (
          <button
            aria-label={`Move selected robot ${direction}`}
            className={`direction-pad__button direction-pad__button--${direction}`}
            key={direction}
            onClick={() => props.onMove(direction)}
            type="button"
          ><span aria-hidden="true">{arrow}</span></button>
        ))}
      </div>
      <div aria-label="Attempt actions" className="attempt-actions" role="group">
        <button aria-label="Undo last move" className="attempt-actions__button" disabled={props.moveCount === 0} onClick={props.onUndo} type="button">
          <span aria-hidden="true" className="attempt-actions__icon">↶</span><span>Undo</span>
        </button>
        <button aria-label="Reset attempt" className="attempt-actions__button" disabled={props.moveCount === 0} onClick={props.onReset} type="button">
          <span aria-hidden="true" className="attempt-actions__icon">⟲</span><span>Reset</span>
        </button>
        <button aria-label="Give up" className="attempt-actions__button attempt-actions__button--give-up" onClick={props.onGiveUp} type="button">
          <span aria-hidden="true" className="attempt-actions__icon">×</span><span>Give Up</span>
        </button>
      </div>
      <p aria-live="polite" className="board-preview__status">{props.feedback ?? `${ROBOT_NAMES[props.selectedRobot]} robot selected`}</p>
    </section>
  );
}
