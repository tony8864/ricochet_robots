export {
  BOARD_SIZE,
  CENTER_BLOCKED_CELLS,
  ROBOT_IDS,
  TARGET_KINDS,
} from './model';
export type {
  BlockedEdge,
  Board,
  ColoredTarget,
  Coordinate,
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
