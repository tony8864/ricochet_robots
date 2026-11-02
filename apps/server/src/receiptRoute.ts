import { PROTOCOL_VERSION } from '@robot-puzzle/shared';
import { parseBootstrapPost, protocolError, reply } from './bootstrapHttp';
import { readSessionCookie } from './sessions';

/** Read-only exact receipt recovery, including after transport/room closure. */
export async function handleReceiptRequest(request: Request, env: Env, roomId: string): Promise<Response> {
  const input = await parseBootstrapPost(request, env);
  if (input instanceof Response) return input;
  if (!('roomId' in input) || input.roomId !== roomId) return protocolError('invalid-message', 400, input.commandId);
  const reject = (reason: 'not-authenticated' | 'seat-not-found' | 'rate-limited' | 'temporarily-unavailable') => reply({ version: PROTOCOL_VERSION,
    type: 'request.rejected', commandId: input.commandId, reason, serverTimeMs: Date.now() },
    reason === 'not-authenticated' ? 401 : reason === 'seat-not-found' ? 403 : reason === 'rate-limited' ? 429 : 503);
  const cookie = readSessionCookie(request.headers.get('Cookie'));
  if (cookie.ambiguous || !cookie.credential) return reject('not-authenticated');
  try {
    using response = await env.REGISTRY.get(env.REGISTRY.idFromName('registry-v1')).roomReceipt(cookie.credential, input);
    if (response.status === 'rejected') return reject(response.reason);
    return reply({ version: PROTOCOL_VERSION, type: 'command.result', commandId: input.commandId, roomId,
      outcome: response.result.outcome, processedRevision: response.result.processedRevision,
      currentRevision: response.result.currentRevision,
      duplicate: response.result.duplicate, serverTimeMs: Date.now() });
  } catch { return reject('temporarily-unavailable'); }
}
