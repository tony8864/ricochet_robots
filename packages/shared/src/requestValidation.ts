import type { RoundNumber } from '@robot-puzzle/match';
import {
  MAX_NICKNAME_BYTES, MAX_NICKNAME_CODE_POINTS, MAX_RAW_NICKNAME_BYTES,
  MAX_RAW_ROOM_CODE_LENGTH, ROOM_CODE_LENGTH, MAX_BOARD_ID_LENGTH,
  type AttemptContext, type LobbyContext, type MatchContext, type RoundContext,
} from './clientRequests';

type RecordValue = Record<string, unknown>;

export function isRecord(value: unknown): value is RecordValue {
  if (value === null || typeof value !== 'object') return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/** JSON objects have only enumerable own string data properties, not getters. */
export function exactKeys(value: RecordValue, keys: readonly string[]): boolean {
  const ownKeys = Reflect.ownKeys(value);
  return ownKeys.length === keys.length && ownKeys.every((key) => {
    if (typeof key !== 'string' || !keys.includes(key)) return false;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor !== undefined && descriptor.enumerable === true && 'value' in descriptor;
  });
}

export function isId(value: unknown): value is string {
  return typeof value === 'string' && value.length === 36 &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
}

export function isNonnegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

export function isRoundNumber(value: unknown): value is RoundNumber {
  return isNonnegativeInteger(value) && value >= 1 && value <= 10;
}

export function isBoardId(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 1 && value.length <= MAX_BOARD_ID_LENGTH &&
    /^[a-z0-9-]+$/.test(value);
}

/** UTF-8 byte length without a DOM/Node encoder; lone surrogates encode as U+FFFD. */
export function utf8Length(value: string): number {
  let bytes = 0;
  for (const character of value) {
    const point = character.codePointAt(0)!;
    bytes += point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4;
  }
  return bytes;
}

export function nickname(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > MAX_RAW_NICKNAME_BYTES ||
    utf8Length(value) > MAX_RAW_NICKNAME_BYTES ||
    /[\p{Cc}\u2028\u2029\u202a-\u202e\u2066-\u2069]/u.test(value)) return undefined;
  const normalized = value.trim().normalize('NFC');
  const count = [...normalized].length;
  return count >= 1 && count <= MAX_NICKNAME_CODE_POINTS && utf8Length(normalized) <= MAX_NICKNAME_BYTES
    ? normalized : undefined;
}

export function roomCode(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > MAX_RAW_ROOM_CODE_LENGTH || /[^\x00-\x7f]/.test(value)) return undefined;
  const normalized = value.trim().toUpperCase();
  return normalized.length === ROOM_CODE_LENGTH && /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]+$/.test(normalized)
    ? normalized : undefined;
}

export function lobbyContext(value: unknown): LobbyContext | undefined {
  return isRecord(value) && exactKeys(value, ['lobbyId']) && isId(value.lobbyId)
    ? { lobbyId: value.lobbyId } : undefined;
}
export function matchContext(value: unknown): MatchContext | undefined {
  return isRecord(value) && exactKeys(value, ['matchId']) && isId(value.matchId)
    ? { matchId: value.matchId } : undefined;
}
export function roundContext(value: unknown): RoundContext | undefined {
  return isRecord(value) && exactKeys(value, ['matchId', 'roundNumber']) &&
    isId(value.matchId) && isRoundNumber(value.roundNumber)
    ? { matchId: value.matchId, roundNumber: value.roundNumber } : undefined;
}
export function attemptContext(value: unknown): AttemptContext | undefined {
  return isRecord(value) && exactKeys(value, ['matchId', 'roundNumber', 'attemptId', 'attemptVersion']) &&
    isId(value.matchId) && isRoundNumber(value.roundNumber) && isId(value.attemptId) &&
    isNonnegativeInteger(value.attemptVersion)
    ? { matchId: value.matchId, roundNumber: value.roundNumber, attemptId: value.attemptId, attemptVersion: value.attemptVersion }
    : undefined;
}
