import { useId, type ReactElement } from 'react';
import {
  BOARD_SIZE,
  ROBOT_IDS,
  type BlockedEdge,
  type Board,
  type RobotId,
  type RobotPositions,
  type Target,
} from '@robot-puzzle/game-engine';
import { TargetSymbol } from './TargetSymbol';

export interface BoardSvgProps {
  readonly board: Board;
  readonly onRobotSelect?: (robotId: RobotId) => void;
  readonly robots: RobotPositions;
  readonly selectedRobot?: RobotId | null;
  readonly targets: readonly Target[];
  readonly activeTargetId: string | null;
}

const ROBOT_LABELS: Readonly<Record<RobotId, string>> = {
  red: 'R',
  blue: 'B',
  green: 'G',
  yellow: 'Y',
};

interface WallLine {
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
}

function toWallLine(wall: BlockedEdge): WallLine {
  if (wall.first.row === wall.second.row) {
    return {
      x1: wall.second.column,
      y1: wall.first.row,
      x2: wall.second.column,
      y2: wall.first.row + 1,
    };
  }

  return {
    x1: wall.first.column,
    y1: wall.second.row,
    x2: wall.first.column + 1,
    y2: wall.second.row,
  };
}

function wallKey(wall: BlockedEdge): string {
  return `${wall.first.row},${wall.first.column}-${wall.second.row},${wall.second.column}`;
}

function describeTarget(target: Target): string {
  const name =
    target.kind === 'colored'
      ? `${target.robotId} ${target.symbol}`
      : 'wildcard vortex';
  return `${name} target at row ${target.position.row + 1}, column ${target.position.column + 1}`;
}

export function BoardSvg({
  board,
  onRobotSelect,
  robots,
  selectedRobot,
  targets,
  activeTargetId,
}: BoardSvgProps): ReactElement {
  const titleId = useId();
  const descriptionId = useId();
  const gridLines = Array.from({ length: BOARD_SIZE - 1 }, (_, index) => index + 1);
  const robotDescription = ROBOT_IDS.map((robotId) => {
    const position = robots[robotId];
    return `${robotId} robot at row ${position.row + 1}, column ${position.column + 1}`;
  }).join('; ');
  const activeTarget = targets.find((target) => target.id === activeTargetId);

  return (
    <svg
      aria-labelledby={`${titleId} ${descriptionId}`}
      className="game-board"
      role="img"
      shapeRendering="geometricPrecision"
      viewBox={`0 0 ${BOARD_SIZE} ${BOARD_SIZE}`}
    >
      <title id={titleId}>Robot puzzle board preview</title>
      <desc id={descriptionId}>
        A sixteen by sixteen board with a blocked two by two center and sample
        walls. {robotDescription}. {targets.map(describeTarget).join('; ')}.
        {activeTarget ? `Active ${describeTarget(activeTarget)}.` : 'No active target.'}
      </desc>

      <rect
        className="game-board__surface"
        height={BOARD_SIZE}
        width={BOARD_SIZE}
        x={0}
        y={0}
      />

      {board.blockedCells.map((cell) => (
        <rect
          className="game-board__blocked-cell"
          height={1}
          key={`${cell.row},${cell.column}`}
          width={1}
          x={cell.column}
          y={cell.row}
        />
      ))}

      <g aria-hidden="true" className="game-board__grid">
        {gridLines.map((position) => (
          <line
            key={`vertical-${position}`}
            vectorEffect="non-scaling-stroke"
            x1={position}
            x2={position}
            y1={0}
            y2={BOARD_SIZE}
          />
        ))}
        {gridLines.map((position) => (
          <line
            key={`horizontal-${position}`}
            vectorEffect="non-scaling-stroke"
            x1={0}
            x2={BOARD_SIZE}
            y1={position}
            y2={position}
          />
        ))}
      </g>

      <g aria-hidden="true" className="game-board__targets">
        {targets.map((target) => {
          const isActive = target.id === activeTargetId;
          const color = target.kind === 'colored' ? target.robotId : 'wildcard';
          return (
            <g
              className={`game-board__target game-board__target--${color}${
                isActive ? ' game-board__target--active' : ''
              }`}
              data-target-id={target.id}
              key={target.id}
              transform={`translate(${target.position.column + 0.5} ${target.position.row + 0.5})`}
            >
              {isActive && (
                <rect
                  className="game-board__target-highlight"
                  height={1}
                  width={1}
                  x={-0.5}
                  y={-0.5}
                />
              )}
              <TargetSymbol symbol={target.symbol} />
            </g>
          );
        })}
      </g>

      <g aria-hidden="true" className="game-board__robots">
        {ROBOT_IDS.map((robotId) => {
          const position = robots[robotId];
          const isSelected = selectedRobot === robotId;

          return (
            <g
              className={`game-board__robot game-board__robot--${robotId}${
                isSelected ? ' game-board__robot--selected' : ''
              }${onRobotSelect ? ' game-board__robot--interactive' : ''}`}
              key={robotId}
              onClick={
                onRobotSelect ? () => onRobotSelect(robotId) : undefined
              }
              transform={`translate(${position.column + 0.5} ${position.row + 0.5})`}
            >
              <circle className="game-board__robot-hit-area" r={0.48} />
              <circle
                className="game-board__robot-selection"
                r={0.43}
                vectorEffect="non-scaling-stroke"
              />
              <circle className="game-board__robot-piece" r={0.34} />
              <text className="game-board__robot-label" x={0} y={0}>
                {ROBOT_LABELS[robotId]}
              </text>
            </g>
          );
        })}
      </g>

      <g aria-hidden="true" className="game-board__walls">
        {board.walls.map((wall) => {
          const line = toWallLine(wall);

          return (
            <line
              key={wallKey(wall)}
              vectorEffect="non-scaling-stroke"
              {...line}
            />
          );
        })}
      </g>

      <rect
        aria-hidden="true"
        className="game-board__boundary"
        height={BOARD_SIZE}
        vectorEffect="non-scaling-stroke"
        width={BOARD_SIZE}
        x={0}
        y={0}
      />
    </svg>
  );
}
