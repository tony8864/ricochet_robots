/** The board is always a 16 by 16 grid. */
export const BOARD_SIZE = 16 as const;

/**
 * Zero-based board position. (0, 0) is the top-left cell. Rows increase
 * downward and columns increase rightward.
 */
export interface Coordinate {
  readonly row: number;
  readonly column: number;
}

/** The four cells unavailable in the center of every board. */
export const CENTER_BLOCKED_CELLS = [
  { row: 7, column: 7 },
  { row: 7, column: 8 },
  { row: 8, column: 7 },
  { row: 8, column: 8 },
] as const satisfies readonly Coordinate[];

/**
 * One undirected interior wall between orthogonally adjacent cells.
 * `first` must precede `second` in row-major order. Storing an edge only once
 * prevents the two sides of a wall from disagreeing.
 */
export interface BlockedEdge {
  readonly first: Coordinate;
  readonly second: Coordinate;
}

export interface Board {
  readonly blockedCells: readonly Coordinate[];
  readonly walls: readonly BlockedEdge[];
}

export const ROBOT_IDS = ['red', 'blue', 'green', 'yellow'] as const;

export type RobotId = (typeof ROBOT_IDS)[number];

/** Exactly one position for each of the four robots. */
export type RobotPositions = Readonly<Record<RobotId, Coordinate>>;

export const TARGET_KINDS = ['colored', 'wildcard'] as const;

export type TargetKind = (typeof TARGET_KINDS)[number];

interface TargetBase {
  readonly id: string;
  readonly position: Coordinate;
}

export interface ColoredTarget extends TargetBase {
  readonly kind: 'colored';
  readonly robotId: RobotId;
}

export interface WildcardTarget extends TargetBase {
  readonly kind: 'wildcard';
}

export type Target = ColoredTarget | WildcardTarget;

/** Immutable geometry and the current robot/target state used by the engine. */
export interface GameState {
  readonly board: Board;
  readonly robots: RobotPositions;
  readonly target: Target;
}
