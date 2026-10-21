import { ROBOT_IDS, type Coordinate, type RobotPositions } from '@robot-puzzle/game-engine';

// The engine board is fixed at 16x16: each cell fits in one byte. Robot identity
// is preserved in four distinct byte slots; >>> 0 avoids signed-number aliases.
export function cellIndex(position: Coordinate): number {
  return position.row * 16 + position.column;
}

export function robotCell(state: number, robotIndex: number): number {
  return (state >>> (robotIndex * 8)) & 255;
}

export function replaceRobotCell(state: number, robotIndex: number, cell: number): number {
  const shift = robotIndex * 8;
  return ((state & ~(255 << shift)) | (cell << shift)) >>> 0;
}

export function encodeRobots(robots: RobotPositions): number {
  return ROBOT_IDS.reduce(
    (state, id, index) => replaceRobotCell(state, index, cellIndex(robots[id])),
    0,
  );
}

export function decodeRobots(state: number): RobotPositions {
  const position = (index: number): Coordinate => {
    const cell = robotCell(state, index);
    return { row: cell >>> 4, column: cell & 15 };
  };
  return { red: position(0), blue: position(1), green: position(2), yellow: position(3) };
}
