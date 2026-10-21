import type {
  BlockedEdge,
  Board,
  ColoredTargetSymbol,
  Coordinate,
  RobotId,
  RobotPositions,
  Target,
} from '@robot-puzzle/game-engine';

export interface PuzzleBoard {
  readonly id: string;
  readonly name: string;
  readonly board: Board;
  readonly initialRobots: RobotPositions;
  readonly targets: readonly Target[];
}

/** The two sides of a target cell that have walls, not the opening direction. */
export type WallCorner = 'top-left' | 'top-right' | 'bottom-right' | 'bottom-left';

/** Explicit identity makes placement order independent of target identity. */
export type TargetPlacement = Coordinate & {
  readonly corner: WallCorner;
} & (
  | { readonly robotId: RobotId; readonly symbol: ColoredTargetSymbol }
  | { readonly symbol: 'vortex'; readonly robotId?: never }
);

/** Hand-authored data. The builder supplies the fixed center and target walls. */
export interface BoardDefinition {
  readonly id: string;
  readonly name: string;
  readonly initialRobots: RobotPositions;
  readonly targets: readonly TargetPlacement[];
  /** Optional extra blocked cell edges, subject to the same wall-design rules. */
  readonly additionalWalls?: readonly BlockedEdge[];
}

export interface CatalogIssue {
  readonly path: string;
  readonly message: string;
}

export interface CatalogValidationResult {
  readonly valid: boolean;
  readonly issues: readonly CatalogIssue[];
}
