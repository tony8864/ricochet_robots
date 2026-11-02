import { MAX_CLIENT_MESSAGE_BYTES, PROTOCOL_VERSION, type ClientRequest, type ClientRequestError } from './clientRequests';
import { parseClientRequest } from './parseClientRequest';
import { exactKeys, isId, isNonnegativeInteger, isRecord, utf8Length } from './requestValidation';

export const HEARTBEAT_INTERVAL_MS = 10_000;
export const CONNECTION_LEASE_MS = 30_000;
export interface ConnectionPing {
  readonly version: typeof PROTOCOL_VERSION;
  readonly type: 'connection.ping';
  readonly roomId: string;
  readonly connectionId: string;
  readonly sequence: number;
}
type SocketParseResult = { readonly ok: true; readonly value: ClientRequest | ConnectionPing }
  | { readonly ok: false; readonly error: ClientRequestError };

/** Transport-only heartbeat: never accepted as HTTP bootstrap or game action. */
export function parseSocketMessageJson(text: unknown): SocketParseResult {
  if (typeof text !== 'string') return { ok: false, error: 'invalid-message' };
  if (text.length > MAX_CLIENT_MESSAGE_BYTES || utf8Length(text) > MAX_CLIENT_MESSAGE_BYTES) return { ok: false, error: 'message-too-large' };
  let value: unknown;
  try { value = JSON.parse(text); } catch { return { ok: false, error: 'invalid-json' }; }
  if (!isRecord(value) || !exactKeys(value, ['version', 'type', 'roomId', 'connectionId', 'sequence'])) return parseClientRequest(value);
  if (!isNonnegativeInteger(value.version)) return { ok: false, error: 'invalid-message' };
  if (value.version !== PROTOCOL_VERSION) return { ok: false, error: 'unsupported-version' };
  if (value.type !== 'connection.ping' || !isId(value.roomId) || !isId(value.connectionId)
    || !isNonnegativeInteger(value.sequence) || value.sequence === 0) return { ok: false, error: 'invalid-message' };
  return { ok: true, value: { version: PROTOCOL_VERSION, type: 'connection.ping', roomId: value.roomId,
    connectionId: value.connectionId, sequence: value.sequence } };
}
