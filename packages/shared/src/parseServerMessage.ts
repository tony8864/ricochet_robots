import { MAX_SERVER_MESSAGE_BYTES, type PublicRoomState } from './publicState';
import { PROTOCOL_VERSION } from './clientRequests';
import { parsePublicRoomState } from './parsePublicRoomState';
import { exactKeys, utf8Length } from './requestValidation';
import { boolean, check, id, integer, record } from './stateValidation';
import {
  BOOTSTRAP_REJECTION_REASONS, PROTOCOL_ERROR_REASONS, PUBLIC_NO_OP_REASONS, PUBLIC_REJECTION_REASONS,
  type PublicCommandOutcome, type PublicServerMessage, type ServerMessage, type ServerMessageParseResult,
} from './serverMessages';

const COMMON = ['version', 'type', 'serverTimeMs'];
const invalid = (): ServerMessageParseResult<never> => ({ ok: false, error: 'invalid-message' });

function choice<const Values extends readonly string[]>(value: unknown, values: Values): Values[number] {
  const found = values.find((entry) => entry === value);
  check(found !== undefined);
  return found;
}
function state(value: unknown): PublicRoomState {
  const parsed = parsePublicRoomState(value);
  check(parsed.ok);
  return parsed.value;
}
function outcome(value: unknown): PublicCommandOutcome {
  const item = record(value);
  if (item.status === 'accepted') {
    check(exactKeys(item, ['status']));
    return { status: 'accepted' };
  }
  check(exactKeys(item, ['status', 'reason']));
  if (item.status === 'no-op') return { status: 'no-op', reason: choice(item.reason, PUBLIC_NO_OP_REASONS) };
  check(item.status === 'rejected');
  return { status: 'rejected', reason: choice(item.reason, PUBLIC_REJECTION_REASONS) };
}
function parse(value: unknown): ServerMessageParseResult {
  const item = record(value);
  const version = integer(item.version);
  if (version !== PROTOCOL_VERSION) return { ok: false, error: 'unsupported-version' };
  const base = { version: PROTOCOL_VERSION, serverTimeMs: integer(item.serverTimeMs) };
  let message: ServerMessage;
  switch (item.type) {
    case 'session.ready':
      check(exactKeys(item, [...COMMON, 'commandId']));
      message = { ...base, type: 'session.ready', commandId: id(item.commandId) };
      break;
    case 'room.entered': {
      check(exactKeys(item, [...COMMON, 'commandId', 'roomId', 'seatId', 'membership', 'state']));
      const snapshot = state(item.state);
      const roomId = id(item.roomId);
      const seatId = id(item.seatId);
      check(snapshot.roomId === roomId && snapshot.players.some((player) => player.seatId === seatId));
      message = { ...base, type: 'room.entered', commandId: id(item.commandId), roomId, seatId,
        membership: choice(item.membership, ['created', 'joined', 'resumed']), state: snapshot };
      break;
    }
    case 'session.bound': {
      check(exactKeys(item, [...COMMON, 'roomId', 'seatId', 'connectionId', 'state']));
      const snapshot = state(item.state);
      const roomId = id(item.roomId);
      const seatId = id(item.seatId);
      check(snapshot.roomId === roomId && snapshot.players.some((player) => player.seatId === seatId));
      message = { ...base, type: 'session.bound', roomId, seatId, connectionId: id(item.connectionId), state: snapshot };
      break;
    }
    case 'connection.pong':
      check(exactKeys(item, [...COMMON, 'connectionId', 'sequence']));
      message = { ...base, type: 'connection.pong', connectionId: id(item.connectionId), sequence: integer(item.sequence, 1) };
      break;
    case 'room.snapshot':
      check(exactKeys(item, [...COMMON, 'state']));
      message = { ...base, type: 'room.snapshot', state: state(item.state) };
      break;
    case 'command.result': {
      check(exactKeys(item, [...COMMON, 'roomId', 'commandId', 'outcome', 'processedRevision', 'currentRevision', 'duplicate']));
      const processedRevision = integer(item.processedRevision);
      const currentRevision = integer(item.currentRevision, processedRevision);
      message = { ...base, type: 'command.result', roomId: id(item.roomId), commandId: id(item.commandId),
        outcome: outcome(item.outcome), processedRevision, currentRevision, duplicate: boolean(item.duplicate) };
      break;
    }
    case 'request.rejected':
      check(exactKeys(item, [...COMMON, 'commandId', 'reason']));
      message = { ...base, type: 'request.rejected', commandId: id(item.commandId), reason: choice(item.reason, BOOTSTRAP_REJECTION_REASONS) };
      break;
    case 'protocol.error':
      check(exactKeys(item, [...COMMON, 'commandId', 'reason']));
      message = { ...base, type: 'protocol.error', commandId: item.commandId === null ? null : id(item.commandId), reason: choice(item.reason, PROTOCOL_ERROR_REASONS) };
      break;
    case 'room.closed':
      check(exactKeys(item, [...COMMON, 'roomId', 'lastRevision', 'reason']));
      message = { ...base, type: 'room.closed', roomId: id(item.roomId), lastRevision: integer(item.lastRevision), reason: choice(item.reason, ['expired', 'unavailable', 'host-ended']) };
      break;
    default: return invalid();
  }
  return { ok: true, value: message };
}

/** Validates direction-specific structure, not sender identity or request history. */
export function parseServerMessage(value: unknown): ServerMessageParseResult {
  try { return parse(value); } catch { return invalid(); }
}

/** For future broadcast boundaries: rejects all recipient-specific message kinds. */
export function parsePublicServerMessage(value: unknown): ServerMessageParseResult<PublicServerMessage> {
  const parsed = parseServerMessage(value);
  if (!parsed.ok) return parsed;
  return parsed.value.type === 'room.snapshot' || parsed.value.type === 'room.closed'
    ? { ok: true, value: parsed.value } : invalid();
}

/** Checks total UTF-8 bytes before JSON parsing; transport must bound raw frames too. */
export function parseServerMessageJson(text: unknown): ServerMessageParseResult {
  if (typeof text !== 'string') return invalid();
  if (text.length > MAX_SERVER_MESSAGE_BYTES || utf8Length(text) > MAX_SERVER_MESSAGE_BYTES) {
    return { ok: false, error: 'message-too-large' };
  }
  let value: unknown;
  try { value = JSON.parse(text); } catch { return { ok: false, error: 'invalid-json' }; }
  return parseServerMessage(value);
}
