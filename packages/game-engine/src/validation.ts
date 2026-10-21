import {
  BOARD_SIZE,
  CENTER_BLOCKED_CELLS,
  COLORED_TARGET_SYMBOLS,
  ROBOT_IDS,
  type Board,
  type Coordinate,
  type GameState,
  type RobotId,
} from './model';

export type ValidationIssueCode =
  | 'invalid_type'
  | 'invalid_coordinate'
  | 'duplicate_blocked_cell'
  | 'missing_center_blocked_cell'
  | 'malformed_wall'
  | 'duplicate_wall'
  | 'wall_touches_blocked_cell'
  | 'invalid_robot_set'
  | 'overlapping_robots'
  | 'occupied_blocked_cell'
  | 'invalid_target';

export interface ValidationIssue {
  readonly code: ValidationIssueCode;
  readonly path: string;
  readonly message: string;
}

export interface ValidationResult {
  readonly valid: boolean;
  readonly issues: readonly ValidationIssue[];
}

type UnknownRecord = Record<string, unknown>;

const ROBOT_ID_SET: ReadonlySet<string> = new Set(ROBOT_IDS);
const COLORED_SYMBOL_SET: ReadonlySet<string> = new Set(COLORED_TARGET_SYMBOLS);

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function coordinateKey(coordinate: Coordinate): string {
  return `${coordinate.row},${coordinate.column}`;
}

function isCoordinate(value: unknown): value is Coordinate {
  if (!isRecord(value)) {
    return false;
  }

  return (
    Number.isInteger(value.row) &&
    Number.isInteger(value.column) &&
    (value.row as number) >= 0 &&
    (value.row as number) < BOARD_SIZE &&
    (value.column as number) >= 0 &&
    (value.column as number) < BOARD_SIZE
  );
}

function precedes(first: Coordinate, second: Coordinate): boolean {
  return (
    first.row < second.row ||
    (first.row === second.row && first.column < second.column)
  );
}

function isAdjacent(first: Coordinate, second: Coordinate): boolean {
  return (
    Math.abs(first.row - second.row) +
      Math.abs(first.column - second.column) ===
    1
  );
}

function validateCoordinate(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
): value is Coordinate {
  if (isCoordinate(value)) {
    return true;
  }

  issues.push({
    code: 'invalid_coordinate',
    path,
    message: `Expected integer row and column between 0 and ${BOARD_SIZE - 1}.`,
  });
  return false;
}

function validateBoardInto(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
): value is Board {
  if (!isRecord(value)) {
    issues.push({
      code: 'invalid_type',
      path,
      message: 'Expected a board object.',
    });
    return false;
  }

  const blockedKeys = new Set<string>();
  if (!Array.isArray(value.blockedCells)) {
    issues.push({
      code: 'invalid_type',
      path: `${path}.blockedCells`,
      message: 'Expected an array of blocked-cell coordinates.',
    });
  } else {
    value.blockedCells.forEach((cell, index) => {
      if (!validateCoordinate(cell, `${path}.blockedCells[${index}]`, issues)) {
        return;
      }

      const key = coordinateKey(cell);
      if (blockedKeys.has(key)) {
        issues.push({
          code: 'duplicate_blocked_cell',
          path: `${path}.blockedCells[${index}]`,
          message: `Blocked cell ${key} is listed more than once.`,
        });
      }
      blockedKeys.add(key);
    });
  }

  for (const centerCell of CENTER_BLOCKED_CELLS) {
    if (!blockedKeys.has(coordinateKey(centerCell))) {
      issues.push({
        code: 'missing_center_blocked_cell',
        path: `${path}.blockedCells`,
        message: `Central cell ${coordinateKey(centerCell)} must be blocked.`,
      });
    }
  }

  const wallKeys = new Set<string>();
  if (!Array.isArray(value.walls)) {
    issues.push({
      code: 'invalid_type',
      path: `${path}.walls`,
      message: 'Expected an array of blocked edges.',
    });
  } else {
    value.walls.forEach((wall, index) => {
      const wallPath = `${path}.walls[${index}]`;
      if (!isRecord(wall)) {
        issues.push({
          code: 'malformed_wall',
          path: wallPath,
          message: 'Expected a wall with first and second coordinates.',
        });
        return;
      }

      const first = wall.first;
      const second = wall.second;
      const firstValid = validateCoordinate(
        first,
        `${wallPath}.first`,
        issues,
      );
      const secondValid = validateCoordinate(
        second,
        `${wallPath}.second`,
        issues,
      );
      if (!firstValid || !secondValid) {
        issues.push({
          code: 'malformed_wall',
          path: wallPath,
          message: 'Both wall endpoints must be valid board coordinates.',
        });
        return;
      }

      if (!isAdjacent(first, second) || !precedes(first, second)) {
        issues.push({
          code: 'malformed_wall',
          path: wallPath,
          message:
            'Wall endpoints must be orthogonally adjacent and ordered row-major.',
        });
        return;
      }

      const key = `${coordinateKey(first)}|${coordinateKey(second)}`;
      if (wallKeys.has(key)) {
        issues.push({
          code: 'duplicate_wall',
          path: wallPath,
          message: `Wall ${key} is listed more than once.`,
        });
      }
      wallKeys.add(key);

      if (
        blockedKeys.has(coordinateKey(first)) ||
        blockedKeys.has(coordinateKey(second))
      ) {
        issues.push({
          code: 'wall_touches_blocked_cell',
          path: wallPath,
          message: 'Walls adjacent to blocked cells are implicit and must be omitted.',
        });
      }
    });
  }

  return issues.length === 0;
}

export function validateBoard(value: unknown): ValidationResult {
  const issues: ValidationIssue[] = [];
  validateBoardInto(value, 'board', issues);
  return { valid: issues.length === 0, issues };
}

function validateRobots(
  value: unknown,
  blockedKeys: ReadonlySet<string>,
  issues: ValidationIssue[],
): void {
  if (!isRecord(value)) {
    issues.push({
      code: 'invalid_robot_set',
      path: 'state.robots',
      message: 'Expected positions for exactly red, blue, green, and yellow.',
    });
    return;
  }

  const keys = Object.keys(value);
  if (
    keys.length !== ROBOT_IDS.length ||
    keys.some((key) => !ROBOT_ID_SET.has(key)) ||
    ROBOT_IDS.some((robotId) => !(robotId in value))
  ) {
    issues.push({
      code: 'invalid_robot_set',
      path: 'state.robots',
      message: 'Expected positions for exactly red, blue, green, and yellow.',
    });
  }

  const occupied = new Map<string, RobotId>();
  for (const robotId of ROBOT_IDS) {
    const position = value[robotId];
    if (!validateCoordinate(position, `state.robots.${robotId}`, issues)) {
      continue;
    }

    const key = coordinateKey(position);
    const existingRobot = occupied.get(key);
    if (existingRobot !== undefined) {
      issues.push({
        code: 'overlapping_robots',
        path: `state.robots.${robotId}`,
        message: `${robotId} overlaps ${existingRobot} at ${key}.`,
      });
    } else {
      occupied.set(key, robotId);
    }

    if (blockedKeys.has(key)) {
      issues.push({
        code: 'occupied_blocked_cell',
        path: `state.robots.${robotId}`,
        message: `${robotId} cannot occupy blocked cell ${key}.`,
      });
    }
  }
}

function validateTarget(
  value: unknown,
  blockedKeys: ReadonlySet<string>,
  issues: ValidationIssue[],
): void {
  if (!isRecord(value)) {
    issues.push({
      code: 'invalid_target',
      path: 'state.target',
      message: 'Expected a colored or wildcard target.',
    });
    return;
  }

  if (typeof value.id !== 'string' || value.id.trim().length === 0) {
    issues.push({
      code: 'invalid_target',
      path: 'state.target.id',
      message: 'Target id must be a non-empty string.',
    });
  }

  const position = value.position;
  const positionValid = validateCoordinate(
    position,
    'state.target.position',
    issues,
  );
  if (
    positionValid &&
    blockedKeys.has(coordinateKey(position))
  ) {
    issues.push({
      code: 'invalid_target',
      path: 'state.target.position',
      message: 'A target cannot occupy a blocked cell.',
    });
  }

  if (value.kind === 'colored') {
    if (typeof value.symbol !== 'string' || !COLORED_SYMBOL_SET.has(value.symbol)) {
      issues.push({
        code: 'invalid_target',
        path: 'state.target.symbol',
        message: 'A colored target must use star, crescent, triangle, or square.',
      });
    }
    if (typeof value.robotId !== 'string' || !ROBOT_ID_SET.has(value.robotId)) {
      issues.push({
        code: 'invalid_target',
        path: 'state.target.robotId',
        message: 'A colored target must require one of the four robot IDs.',
      });
    }
  } else if (value.kind === 'wildcard') {
    if (value.symbol !== 'vortex') {
      issues.push({
        code: 'invalid_target',
        path: 'state.target.symbol',
        message: 'A wildcard target must use the vortex symbol.',
      });
    }
    if ('robotId' in value) {
      issues.push({
        code: 'invalid_target',
        path: 'state.target.robotId',
        message: 'A wildcard target accepts any robot and must not specify a robot ID.',
      });
    }
  } else {
    issues.push({
      code: 'invalid_target',
      path: 'state.target.kind',
      message: 'Target kind must be colored or wildcard.',
    });
  }
}

export function validateGameState(value: unknown): ValidationResult {
  const issues: ValidationIssue[] = [];
  if (!isRecord(value)) {
    return {
      valid: false,
      issues: [
        {
          code: 'invalid_type',
          path: 'state',
          message: 'Expected a game-state object.',
        },
      ],
    };
  }

  validateBoardInto(value.board, 'state.board', issues);

  const blockedKeys = new Set<string>();
  if (isRecord(value.board) && Array.isArray(value.board.blockedCells)) {
    for (const cell of value.board.blockedCells) {
      if (isCoordinate(cell)) {
        blockedKeys.add(coordinateKey(cell));
      }
    }
  }

  validateRobots(value.robots, blockedKeys, issues);
  validateTarget(value.target, blockedKeys, issues);

  return { valid: issues.length === 0, issues };
}

export function isValidBoard(value: unknown): value is Board {
  return validateBoard(value).valid;
}

export function isValidGameState(value: unknown): value is GameState {
  return validateGameState(value).valid;
}

function formatIssues(issues: readonly ValidationIssue[]): string {
  return issues.map((issue) => `${issue.path}: ${issue.message}`).join('; ');
}

export function assertValidBoard(value: unknown): asserts value is Board {
  const result = validateBoard(value);
  if (!result.valid) {
    throw new TypeError(`Invalid board: ${formatIssues(result.issues)}`);
  }
}

export function assertValidGameState(value: unknown): asserts value is GameState {
  const result = validateGameState(value);
  if (!result.valid) {
    throw new TypeError(`Invalid game state: ${formatIssues(result.issues)}`);
  }
}
