import { PROTOCOL_VERSION, parsePublicRoomState } from '@robot-puzzle/shared';
import type { BootstrapRejectionReason } from '@robot-puzzle/shared';
import type { CreateRequest } from './creations';
import { parseBootstrapPost, protocolError, reply } from './bootstrapHttp';
import { readSessionCookie } from './sessions';

export async function handleCreateRoomRequest(request: Request, env: Env): Promise<Response> {
  const input = await parseBootstrapPost(request, env);
  if (input instanceof Response) return input;
  if (input.command.type !== 'room.create') return protocolError('invalid-message', 400, input.commandId);
  const reject = (reason: BootstrapRejectionReason) => reply({
    version: PROTOCOL_VERSION, type: 'request.rejected', commandId: input.commandId,
    reason, serverTimeMs: Date.now(),
  }, reason === 'not-authenticated' ? 401 : reason === 'command-id-conflict' ? 409 : reason === 'rate-limited' ? 429 : 503);
  const cookie = readSessionCookie(request.headers.get('Cookie'));
  if (cookie.ambiguous || !cookie.credential) return reject('not-authenticated');
  try {
    const registry = env.REGISTRY.get(env.REGISTRY.idFromName('registry-v1'));
    using result = await registry.createRoom(cookie.credential, input as CreateRequest);
    if (result.status === 'rejected') return reject(result.reason);
    const state = parsePublicRoomState(result.state);
    if (!state.ok) return reject('temporarily-unavailable');
    return reply({
      version: PROTOCOL_VERSION, type: 'room.entered', commandId: input.commandId,
      roomId: state.value.roomId, seatId: result.seatId, membership: 'created',
      state: state.value, serverTimeMs: Date.now(),
    });
  } catch {
    // Pending creation stays recoverable. Never disclose raw RPC/storage errors.
    return reject('temporarily-unavailable');
  }
}
