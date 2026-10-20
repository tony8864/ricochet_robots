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

export interface BoardSvgProps {
  readonly board: Board;
  readonly robots: RobotPositions;
  readonly target: Target;
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

export function BoardSvg({ board, robots, target }: BoardSvgProps): ReactElement {
  const titleId = useId();
  const descriptionId = useId();
  const gridLines = Array.from({ length: BOARD_SIZE - 1 }, (_, index) => index + 1);
  const robotDescription = ROBOT_IDS.map((robotId) => {
    const position = robots[robotId];
    return `${robotId} robot at row ${position.row + 1}, column ${position.column + 1}`;
  }).join('; ');
  const targetDescription =
    target.kind === 'colored'
      ? `${target.robotId} target at row ${target.position.row + 1}, column ${target.position.column + 1}`
      : `wildcard target at row ${target.position.row + 1}, column ${target.position.column + 1}`;
  const targetStyle =
    target.kind === 'colored' ? target.robotId : 'wildcard';
  const targetLabel =
    target.kind === 'colored' ? ROBOT_LABELS[target.robotId] : '★';

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
        walls. {robotDescription}. Active {targetDescription}.
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

      <g aria-hidden="true" className="game-board__robots">
        {ROBOT_IDS.map((robotId) => {
          const position = robots[robotId];

          return (
            <g
              className={`game-board__robot game-board__robot--${robotId}`}
              key={robotId}
              transform={`translate(${position.column + 0.5} ${position.row + 0.5})`}
            >
              <circle className="game-board__robot-piece" r={0.34} />
              <text className="game-board__robot-label" x={0} y={0}>
                {ROBOT_LABELS[robotId]}
              </text>
            </g>
          );
        })}
      </g>

      <g
        aria-hidden="true"
        className={`game-board__target game-board__target--${targetStyle}`}
        transform={`translate(${target.position.column + 0.5} ${target.position.row + 0.5})`}
      >
        <circle
          className="game-board__target-ring game-board__target-ring--outer"
          r={0.35}
          vectorEffect="non-scaling-stroke"
        />
        <circle
          className="game-board__target-ring game-board__target-ring--inner"
          r={0.28}
          vectorEffect="non-scaling-stroke"
        />
        <text className="game-board__target-label" x={0} y={0}>
          {targetLabel}
        </text>
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
        height={BOARD_SIZE - 0.12}
        vectorEffect="non-scaling-stroke"
        width={BOARD_SIZE - 0.12}
        x={0.06}
        y={0.06}
      />
    </svg>
  );
}
