import {
  COLORED_TARGET_SYMBOLS, ROBOT_IDS, type Board, type Coordinate, type RobotPositions,
  type Target,
} from '@robot-puzzle/game-engine';
import { validateCatalog } from '@robot-puzzle/puzzles';
import type { MatchBid, NonEmptyBids, RoundNumber } from '@robot-puzzle/match';
import type { PublicPlayer, PublicPuzzle } from './publicState';
import { exactKeys, isBoardId, isId, isNonnegativeInteger, isRecord, isRoundNumber, nickname, roomCode, utf8Length } from './requestValidation';

const INVALID = Symbol('invalid public state');
export function check(condition: unknown): asserts condition { if (!condition) throw INVALID; }
export function record(value: unknown): Record<string, unknown> {
  check(isRecord(value));
  check(exactKeys(value, Object.keys(value)));
  return value;
}
export function fields(value: unknown, keys: readonly string[]): Record<string, unknown> {
  const result = record(value);
  check(exactKeys(result, keys));
  return result;
}
export function list(value: unknown, min: number, max: number): readonly unknown[] {
  check(Array.isArray(value) && Object.getPrototypeOf(value) === Array.prototype);
  check(value.length >= min && value.length <= max);
  check(Reflect.ownKeys(value).length === value.length + 1);
  for (let index = 0; index < value.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    check(descriptor?.enumerable && 'value' in descriptor);
  }
  return value;
}
export function integer(value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): number {
  check(isNonnegativeInteger(value) && value >= min && value <= max);
  return value;
}
export function id(value: unknown): string { check(isId(value)); return value; }
export function boardId(value: unknown): string { check(isBoardId(value)); return value; }
export function roundNumber(value: unknown): RoundNumber { check(isRoundNumber(value)); return value; }
export function canonicalCode(value: unknown): string { check(typeof value === 'string' && roomCode(value) === value); return value; }
export function canonicalNickname(value: unknown): string { check(typeof value === 'string' && nickname(value) === value); return value; }
export function boolean(value: unknown): boolean { check(typeof value === 'boolean'); return value; }
export function coordinate(value: unknown): Coordinate {
  const item = fields(value, ['row', 'column']);
  return { row: integer(item.row, 0, 15), column: integer(item.column, 0, 15) };
}
const key = (point: Coordinate) => `${point.row},${point.column}`;
export function robots(value: unknown, board: Board): RobotPositions {
  const item = fields(value, ROBOT_IDS);
  const result = { red: coordinate(item.red), blue: coordinate(item.blue), green: coordinate(item.green), yellow: coordinate(item.yellow) };
  const positions = ROBOT_IDS.map((robot) => key(result[robot]));
  check(new Set(positions).size === 4);
  const blocked = new Set(board.blockedCells.map(key));
  check(positions.every((position) => !blocked.has(position)));
  return result;
}
export function sameRobots(first: RobotPositions, second: RobotPositions): boolean {
  return ROBOT_IDS.every((robot) => key(first[robot]) === key(second[robot]));
}
function target(value: unknown): Target {
  const item = record(value);
  if (item.kind === 'colored') {
    check(exactKeys(item, ['id', 'kind', 'symbol', 'robotId', 'position']));
    const robotId = ROBOT_IDS.find((robot) => robot === item.robotId);
    const symbol = COLORED_TARGET_SYMBOLS.find((symbol) => symbol === item.symbol);
    check(robotId && symbol);
    return { id: boardId(item.id), kind: 'colored', symbol, robotId, position: coordinate(item.position) };
  }
  check(item.kind === 'wildcard' && item.symbol === 'vortex' && exactKeys(item, ['id', 'kind', 'symbol', 'position']));
  return { id: boardId(item.id), kind: 'wildcard', symbol: 'vortex', position: coordinate(item.position) };
}
export function puzzle(value: unknown): PublicPuzzle {
  const item = fields(value, ['id', 'name', 'board', 'targets', 'initialRobots']);
  check(typeof item.name === 'string' && item.name.length <= 160 && [...item.name].length >= 1 &&
    [...item.name].length <= 80 && utf8Length(item.name) <= 320 &&
    !/[\p{Cc}\u2028\u2029]/u.test(item.name));
  const geometry = fields(item.board, ['blockedCells', 'walls']);
  const board: Board = {
    blockedCells: list(geometry.blockedCells, 4, 4).map(coordinate),
    walls: list(geometry.walls, 0, 480).map((wall) => {
      const edge = fields(wall, ['first', 'second']);
      return { first: coordinate(edge.first), second: coordinate(edge.second) };
    }),
  };
  const result: PublicPuzzle = {
    id: boardId(item.id), name: item.name, board,
    targets: list(item.targets, 17, 17).map(target), initialRobots: robots(item.initialRobots, board),
  };
  // Reuse bounded catalog geometry/target rules, not a solver or client catalog lookup.
  check(validateCatalog([result]).valid);
  return result;
}
export function players(value: unknown, min: number): readonly PublicPlayer[] {
  const result = list(value, min, 6).map((entry) => {
    const item = fields(entry, ['seatId', 'nickname', 'connected']);
    return { seatId: id(item.seatId), nickname: canonicalNickname(item.nickname), connected: boolean(item.connected) };
  });
  check(new Set(result.map((player) => player.seatId)).size === result.length);
  return result;
}
export function bids(value: unknown, roster: readonly PublicPlayer[], sorted: boolean): NonEmptyBids {
  const result: MatchBid[] = list(value, 1, roster.length).map((entry) => {
    const item = fields(entry, ['seatId', 'value', 'firstAcceptedOrder']);
    const seatId = id(item.seatId);
    check(roster.some((player) => player.seatId === seatId));
    return { seatId, value: integer(item.value, 1), firstAcceptedOrder: integer(item.firstAcceptedOrder, 0, 5) };
  });
  check(new Set(result.map((bid) => bid.seatId)).size === result.length);
  check(new Set(result.map((bid) => bid.firstAcceptedOrder)).size === result.length);
  if (sorted) check(result.every((bid, index) => index === 0 || result[index - 1].value < bid.value ||
    (result[index - 1].value === bid.value && result[index - 1].firstAcceptedOrder < bid.firstAcceptedOrder)));
  const first = result[0];
  check(first);
  return [first, ...result.slice(1)];
}
