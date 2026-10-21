export {
  BOARD_SIZE,
  CENTER_BLOCKED_CELLS,
  COLORED_TARGET_SYMBOLS,
  DIRECTIONS,
  ROBOT_IDS,
  TARGET_KINDS,
} from './model';
export type {
  BlockedEdge,
  Board,
  ColoredTarget,
  ColoredTargetSymbol,
  Coordinate,
  Direction,
  GameState,
  RobotId,
  RobotPositions,
  Target,
  TargetKind,
  TargetSymbol,
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
export {
  createAttempt,
  getAttemptMoveCount,
  isTargetComplete,
  moveAttemptRobot,
  resetAttempt,
  undoAttempt,
} from './attempt';
export type {
  AttemptMove,
  AttemptMoveResult,
  AttemptState,
} from './attempt';
