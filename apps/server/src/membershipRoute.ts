import { PROTOCOL_VERSION, parsePublicRoomState } from '@robot-puzzle/shared';
import type { BootstrapRejectionReason } from '@robot-puzzle/shared';
import { parseBootstrapPost, protocolError, reply } from './bootstrapHttp';
import type { MembershipRequest } from './roomMembership';
import { readSessionCookie } from './sessions';

export async function handleMembershipRequest(request: Request, env: Env, routeRoomId?: string): Promise<Response> {
  const input = await parseBootstrapPost(request, env);
  if (input instanceof Response) return input;
  if (routeRoomId === undefined ? input.command.type !== 'room.join'
    : input.command.type !== 'session.resume' || input.command.roomId !== routeRoomId) {
    return protocolError('invalid-message', 400, input.commandId);
  }
  const reject = (reason: BootstrapRejectionReason) => reply({
    version: PROTOCOL_VERSION, type: 'request.rejected', commandId: input.commandId, reason, serverTimeMs: Date.now(),
  }, reason === 'not-authenticated' ? 401 : reason === 'room-not-found' ? 404 : reason === 'seat-not-found' ? 403
    : reason === 'rate-limited' ? 429 : reason === 'temporarily-unavailable' ? 503 : 409);
  const cookie = readSessionCookie(request.headers.get('Cookie'));
  if (cookie.ambiguous || !cookie.credential) return reject('not-authenticated');
  try {
    const registry = env.REGISTRY.get(env.REGISTRY.idFromName('registry-v1'));
    using result = await registry.enterRoom(cookie.credential, input as MembershipRequest);
    if (result.status === 'rejected') return reject(result.reason);
    const state = parsePublicRoomState(result.state);
    if (!state.ok) return reject('temporarily-unavailable');
    return reply({
      version: PROTOCOL_VERSION, type: 'room.entered', commandId: input.commandId,
      roomId: state.value.roomId, seatId: result.seatId, membership: result.membership,
      state: state.value, serverTimeMs: Date.now(),
    });
  } catch {
    return reject('temporarily-unavailable');
  }
}
