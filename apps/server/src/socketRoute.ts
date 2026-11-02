import { parseClientRequest, PROTOCOL_VERSION } from '@robot-puzzle/shared';
import { isAllowedOrigin } from './bootstrapHttp';
import { readSessionCookie } from './sessions';

export async function handleSocketRequest(request: Request, env: Env, roomId: string): Promise<Response> {
  const fail = (status: number) => new Response(null, { status, headers: { 'Cache-Control': 'no-store' } });
  if (request.method !== 'GET') return fail(405);
  if (!isAllowedOrigin(request.headers.get('Origin'), env.ALLOWED_ORIGINS)) return fail(403);
  if (new URL(request.url).search || request.headers.has('Sec-WebSocket-Protocol')) return fail(400);
  if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return fail(426);
    if (!parseClientRequest({ version: PROTOCOL_VERSION, commandId: roomId, command: { type: 'session.open' } }).ok) return fail(400);
  const cookie = readSessionCookie(request.headers.get('Cookie'));
  if (cookie.ambiguous || !cookie.credential) return fail(401);
  try {
    const registry = env.REGISTRY.get(env.REGISTRY.idFromName('registry-v1'));
    using authorization = await registry.authorizeSocket(cookie.credential, roomId);
    if (authorization.status === 'rejected') return fail(authorization.reason === 'not-authenticated' ? 401
      : authorization.reason === 'room-not-found' ? 404 : authorization.reason === 'room-closed' || authorization.reason === 'room-expired' ? 410 : 503);
    // Construct a NEW binding-only request. Never forward client authority headers,
    // raw cookies, URL parameters or protocols to the Room.
    return await env.ROOMS.get(env.ROOMS.idFromName(roomId)).fetch(new Request('https://room.internal/socket', {
      headers: { Upgrade: 'websocket', 'X-RR-Session': authorization.sessionId, 'X-RR-Room': roomId },
    }));
  } catch { return fail(503); }
}
