import { DIRECTIONS, ROBOT_IDS } from '@robot-puzzle/game-engine';
import {
  MAX_CLIENT_MESSAGE_BYTES, PROTOCOL_VERSION,
  type ClientRequest, type ClientRequestParseResult, type RoomRequest,
} from './clientRequests';
import {
  attemptContext, exactKeys, isBoardId, isId, isNonnegativeInteger, isRecord,
  lobbyContext, matchContext, nickname, roomCode, roundContext, utf8Length,
} from './requestValidation';

const BOOTSTRAP_KEYS = ['version', 'commandId', 'command'];
const ROOM_KEYS = [...BOOTSTRAP_KEYS, 'roomId', 'context'];
const invalid = (): ClientRequestParseResult => ({ ok: false, error: 'invalid-message' });

function parseRoom(value: Record<string, unknown>, command: Record<string, unknown>): RoomRequest | undefined {
  if (!exactKeys(value, ROOM_KEYS) || !isId(value.roomId) || !isId(value.commandId)) return undefined;
  const base = { version: PROTOCOL_VERSION, commandId: value.commandId, roomId: value.roomId };
  switch (command.type) {
    case 'state.request':
      return exactKeys(command, ['type']) && isRecord(value.context) && exactKeys(value.context, [])
        ? { ...base, context: {}, command: { type: 'state.request' } } : undefined;
    case 'board.shuffle': {
      const context = lobbyContext(value.context);
      return context && exactKeys(command, ['type'])
        ? { ...base, context, command: { type: 'board.shuffle' } } : undefined;
    }
    case 'room.start': {
      const context = lobbyContext(value.context);
      return context && exactKeys(command, ['type', 'boardId']) && isBoardId(command.boardId)
        ? { ...base, context, command: { type: 'room.start', boardId: command.boardId } } : undefined;
    }
    case 'bid.submit': {
      const context = roundContext(value.context);
      return context && exactKeys(command, ['type', 'value']) && isNonnegativeInteger(command.value) && command.value > 0
        ? { ...base, context, command: { type: 'bid.submit', value: command.value } } : undefined;
    }
    case 'attempt.move': {
      const context = attemptContext(value.context);
      const robotId = ROBOT_IDS.find((id) => id === command.robotId);
      const direction = DIRECTIONS.find((direction) => direction === command.direction);
      return context && exactKeys(command, ['type', 'robotId', 'direction']) && robotId && direction
        ? { ...base, context, command: { type: 'attempt.move', robotId, direction } } : undefined;
    }
    case 'attempt.undo': {
      const context = attemptContext(value.context);
      return context && exactKeys(command, ['type'])
        ? { ...base, context, command: { type: 'attempt.undo' } } : undefined;
    }
    case 'attempt.reset': {
      const context = attemptContext(value.context);
      return context && exactKeys(command, ['type'])
        ? { ...base, context, command: { type: 'attempt.reset' } } : undefined;
    }
    case 'attempt.giveUp': {
      const context = attemptContext(value.context);
      return context && exactKeys(command, ['type'])
        ? { ...base, context, command: { type: 'attempt.giveUp' } } : undefined;
    }
    case 'round.skip': {
      const context = roundContext(value.context);
      return context && exactKeys(command, ['type', 'confirmed']) && typeof command.confirmed === 'boolean'
        ? { ...base, context, command: { type: 'round.skip', confirmed: command.confirmed } } : undefined;
    }
    case 'round.continue': {
      const context = roundContext(value.context);
      return context && exactKeys(command, ['type'])
        ? { ...base, context, command: { type: 'round.continue' } } : undefined;
    }
    case 'match.returnToLobby': {
      const context = matchContext(value.context);
      return context && exactKeys(command, ['type'])
        ? { ...base, context, command: { type: 'match.returnToLobby' } } : undefined;
    }
    default: return undefined;
  }
}

function parse(value: unknown): ClientRequestParseResult {
  // Inspect descriptors before values: arbitrary unknown input may contain accessors.
  if (!isRecord(value) || !(exactKeys(value, BOOTSTRAP_KEYS) || exactKeys(value, ROOM_KEYS))) return invalid();
  if (!isNonnegativeInteger(value.version)) return invalid();
  if (value.version !== PROTOCOL_VERSION) return { ok: false, error: 'unsupported-version' };
  if (!isId(value.commandId) || !isRecord(value.command)) return invalid();
  const command = value.command;
  // Check command descriptors before reading its discriminator or payload.
  if (Reflect.ownKeys(command).some((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(command, key);
    return typeof key !== 'string' || !descriptor?.enumerable || !('value' in descriptor);
  })) return invalid();
  const base = { version: PROTOCOL_VERSION, commandId: value.commandId };
  let request: ClientRequest | undefined;
  switch (command.type) {
    case 'session.open':
      if (exactKeys(value, BOOTSTRAP_KEYS) && exactKeys(command, ['type'])) request = { ...base, command: { type: 'session.open' } };
      break;
    case 'room.create': {
      if (!exactKeys(value, BOOTSTRAP_KEYS) || !exactKeys(command, ['type', 'nickname'])) break;
      const name = nickname(command.nickname);
      if (name !== undefined) request = { ...base, command: { type: 'room.create', nickname: name } };
      break;
    }
    case 'room.join': {
      if (!exactKeys(value, BOOTSTRAP_KEYS) || !exactKeys(command, ['type', 'nickname', 'roomCode'])) break;
      const name = nickname(command.nickname);
      const code = roomCode(command.roomCode);
      if (name !== undefined && code !== undefined) request = { ...base, command: { type: 'room.join', nickname: name, roomCode: code } };
      break;
    }
    case 'session.resume':
      if (exactKeys(value, BOOTSTRAP_KEYS) && exactKeys(command, ['type', 'roomId']) && isId(command.roomId)) {
        request = { ...base, command: { type: 'session.resume', roomId: command.roomId } };
      }
      break;
    default: request = parseRoom(value, command);
  }
  return request ? { ok: true, value: request } : invalid();
}

/** Structural validation only. Does not authenticate, authorize, or apply an action.
 * Accepts already-decoded, transport-bounded JSON-like data; returns an owned copy.
 */
export function parseClientRequest(value: unknown): ClientRequestParseResult {
  try { return parse(value); } catch { return invalid(); }
}

/** JSON text entry point; checks UTF-8 size before parsing, without platform APIs.
 * Transport must additionally bound raw HTTP/WS bytes before allocating/decoding text.
 */
export function parseClientRequestJson(text: unknown): ClientRequestParseResult {
  if (typeof text !== 'string') return invalid();
  if (text.length > MAX_CLIENT_MESSAGE_BYTES || utf8Length(text) > MAX_CLIENT_MESSAGE_BYTES) {
    return { ok: false, error: 'message-too-large' };
  }
  let value: unknown;
  try { value = JSON.parse(text); } catch { return { ok: false, error: 'invalid-json' }; }
  return parseClientRequest(value);
}
