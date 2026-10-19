export {
  BOARD_SIZE,
  CENTER_BLOCKED_CELLS,
  DIRECTIONS,
  ROBOT_IDS,
  TARGET_KINDS,
} from './model';
export type {
  BlockedEdge,
  Board,
  ColoredTarget,
  Coordinate,
  Direction,
  GameState,
  RobotId,
  RobotPositions,
  Target,
  TargetKind,
  WildcardTarget,
} from './model';
export {
  assertValidBoard,
  assertValidGameState,
  isValidBoard,
  isValidGameState,
  validateBoard,
  validateGameState,
} from './validation';
export type {
  ValidationIssue,
  ValidationIssueCode,
  ValidationResult,
} from './validation';
export { moveRobot } from './movement';
export type { MoveResult } from './movement';
