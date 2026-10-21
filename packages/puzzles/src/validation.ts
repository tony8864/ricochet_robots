import {
  BOARD_SIZE,
  ROBOT_IDS,
  validateBoard,
  validateGameState,
  type Board,
  type Coordinate,
  type RobotId,
  type Target,
} from '@robot-puzzle/game-engine';
import { cornerWalls } from './geometry';
import type { CatalogIssue, CatalogValidationResult, PuzzleBoard, WallCorner } from './types';

function coordinateKey(position: Coordinate): string {
  return `${position.row},${position.column}`;
}

function edgeSegment(edge: Board['walls'][number]): readonly [string, string, 'horizontal' | 'vertical'] {
  if (edge.first.row !== edge.second.row) {
    const vertexRow = edge.second.row;
    return [
      `${vertexRow},${edge.first.column}`,
      `${vertexRow},${edge.first.column + 1}`,
      'horizontal',
    ];
  }
  const vertexColumn = edge.second.column;
  return [
    `${edge.first.row},${vertexColumn}`,
    `${edge.first.row + 1},${vertexColumn}`,
    'vertical',
  ];
}

function parseVertex(key: string): Coordinate {
  const [row, column] = key.split(',').map(Number);
  return { row: row!, column: column! };
}

function isBorderVertex(key: string): boolean {
  const { row, column } = parseVertex(key);
  return row === 0 || row === BOARD_SIZE || column === 0 || column === BOARD_SIZE;
}

function hasTargetCorner(board: Board, target: Target): boolean {
  const keys = new Set(board.walls.map((wall) => `${coordinateKey(wall.first)}|${coordinateKey(wall.second)}`));
  const corners: readonly WallCorner[] = ['top-left', 'top-right', 'bottom-right', 'bottom-left'];
  return corners.some((corner) => cornerWalls(target.position, corner).every((wall) =>
    keys.has(`${coordinateKey(wall.first)}|${coordinateKey(wall.second)}`)));
}

export function validateCatalog(value: unknown): CatalogValidationResult {
  const issues: CatalogIssue[] = [];
  if (!Array.isArray(value) || value.length === 0) {
    return { valid: false, issues: [{ path: 'catalog', message: 'Expected a non-empty board catalog.' }] };
  }

  const boardIds = new Set<string>();
  value.forEach((candidate: unknown, index: number) => {
    const path = `catalog[${index}]`;
    if (typeof candidate !== 'object' || candidate === null) {
      issues.push({ path, message: 'Expected a board entry.' });
      return;
    }
    const entry = candidate as Partial<PuzzleBoard>;
    if (typeof entry.id !== 'string' || entry.id.trim() === '') {
      issues.push({ path: `${path}.id`, message: 'Board ID must be a non-empty string.' });
    } else if (boardIds.has(entry.id)) {
      issues.push({ path: `${path}.id`, message: `Duplicate board ID "${entry.id}".` });
    } else {
      boardIds.add(entry.id);
    }
    if (typeof entry.name !== 'string' || entry.name.trim() === '') {
      issues.push({ path: `${path}.name`, message: 'Board name must be a non-empty string.' });
    }
    const boardResult = validateBoard(entry.board);
    for (const issue of boardResult.issues) {
      issues.push({ path: `${path}.${issue.path}`, message: issue.message });
    }
    if (!boardResult.valid) return;
    if (!Array.isArray(entry.targets) || entry.targets.length !== 17) {
      issues.push({ path: `${path}.targets`, message: 'Each board must define exactly 17 targets.' });
    }
    const board = entry.board;
    if (!board || !Array.isArray(board.walls) || !Array.isArray(entry.targets)) return;

    const ids = new Set<string>();
    const positions = new Set<string>();
    const combinations = new Set<string>();
    let wildcardCount = 0;
    entry.targets.forEach((target, targetIndex) => {
      const targetPath = `${path}.targets[${targetIndex}]`;
      if (typeof target !== 'object' || target === null) {
        issues.push({ path: targetPath, message: 'Expected a target.' });
        return;
      }
      const targetId = (target as Target).id;
      if (typeof targetId !== 'string' || targetId.trim() === '') {
        issues.push({ path: `${targetPath}.id`, message: 'Target ID must be a non-empty string.' });
      } else if (ids.has(targetId)) {
        issues.push({ path: `${targetPath}.id`, message: `Duplicate target ID "${targetId}".` });
      } else {
        ids.add(targetId);
      }
      const gameStateResult = validateGameState({ board, robots: entry.initialRobots, target });
      for (const issue of gameStateResult.issues) {
        issues.push({ path: `${targetPath}.${issue.path}`, message: issue.message });
      }
      const hasCoordinate = target.position &&
        Number.isInteger(target.position.row) && Number.isInteger(target.position.column) &&
        target.position.row >= 0 && target.position.row < BOARD_SIZE &&
        target.position.column >= 0 && target.position.column < BOARD_SIZE;
      if (hasCoordinate) {
        const key = coordinateKey(target.position);
        if (positions.has(key)) issues.push({ path: `${targetPath}.position`, message: `Duplicate target position ${key}.` });
        positions.add(key);
      }
      if (hasCoordinate && !hasTargetCorner(board, target)) {
        issues.push({ path: `${targetPath}.position`, message: 'Target must have two perpendicular walls meeting at one cell corner.' });
      }
      if (target.kind === 'colored' && ROBOT_IDS.includes(target.robotId as RobotId)) {
        combinations.add(`${target.robotId}:${target.symbol}`);
      } else if (target.kind === 'wildcard' && target.symbol === 'vortex') {
        wildcardCount += 1;
      }
    });

    if (combinations.size !== 16) {
      issues.push({ path: `${path}.targets`, message: 'Targets must contain each robot/color-symbol combination exactly once.' });
    }
    if (wildcardCount !== 1) {
      issues.push({ path: `${path}.targets`, message: 'Targets must contain exactly one vortex wildcard.' });
    }

    const segments = board.walls.map(edgeSegment);
    segments.forEach(([first, second, orientation], wallIndex) => {
      const paired = segments.some(([otherFirst, otherSecond, otherOrientation], otherIndex) =>
        otherIndex !== wallIndex && otherOrientation !== orientation &&
        [first, second].some((vertex) => vertex === otherFirst || vertex === otherSecond));
      const borderEnds = Number(isBorderVertex(first)) + Number(isBorderVertex(second));
      if (!paired && borderEnds !== 1) {
        issues.push({ path: `${path}.board.walls[${wallIndex}]`, message: 'A wall must form a perpendicular angle or have exactly one endpoint on the outer border.' });
      }
    });
  });

  return { valid: issues.length === 0, issues };
}
