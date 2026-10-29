import { PROTOCOL_VERSION } from '@robot-puzzle/shared';
import { parseBootstrapPost, protocolError, reply } from './bootstrapHttp';
import { readSessionCookie, sessionCookie } from './sessions';

export async function handleSessionRequest(request: Request, env: Env): Promise<Response> {
  const input = await parseBootstrapPost(request, env);
  if (input instanceof Response) return input;
  if (input.command.type !== 'session.open') return protocolError('invalid-message', 400, input.commandId);
  const cookie = readSessionCookie(request.headers.get('Cookie'));
  if (cookie.ambiguous) {
    return reply({ version: PROTOCOL_VERSION, type: 'request.rejected', commandId: input.commandId,
      reason: 'not-authenticated', serverTimeMs: Date.now() }, 401);
  }
  try {
    const registry = env.REGISTRY.get(env.REGISTRY.idFromName('registry-v1'));
    const result = await registry.openSession(cookie.credential);
    if (result.status === 'rejected') {
      return reply({ version: PROTOCOL_VERSION, type: 'request.rejected', commandId: input.commandId,
        reason: result.reason, serverTimeMs: Date.now() }, result.reason === 'rate-limited' ? 429 : 503);
    }
    return reply({ version: PROTOCOL_VERSION, type: 'session.ready', commandId: input.commandId,
      serverTimeMs: Date.now() }, 200, result.credential ? sessionCookie(result.credential) : undefined);
  } catch {
    return reply({ version: PROTOCOL_VERSION, type: 'request.rejected', commandId: input.commandId,
      reason: 'temporarily-unavailable', serverTimeMs: Date.now() }, 503);
  }
}
