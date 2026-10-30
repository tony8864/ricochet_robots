export { Registry } from './registry';
export { Room } from './room';
import { handleSessionRequest } from './sessionRoute';
import { handleCreateRoomRequest } from './createRoomRoute';
import { handleMembershipRequest } from './membershipRoute';
import { handleSocketRequest } from './socketRoute';

// Live lobby and initial Preparing match only; target preparation/gameplay are later checkpoints.
export default {
  fetch(request: Request, env: Env): Response | Promise<Response> {
    const { pathname } = new URL(request.url);
    const headers = { 'Cache-Control': 'no-store' };

    if (env.APP_ENV === 'local' && pathname === '/api/health') {
      if (request.method !== 'GET') {
        return new Response(null, { status: 405, headers: { ...headers, Allow: 'GET' } });
      }
      return Response.json({ status: 'ok', checkpoint: 'T14.1' }, { headers });
    }

    if (pathname === '/api/session') return handleSessionRequest(request, env);
    if (pathname === '/api/rooms') return handleCreateRoomRequest(request, env);
    if (pathname === '/api/rooms/join') return handleMembershipRequest(request, env);
    const resume = /^\/api\/rooms\/([^/]+)\/resume$/.exec(pathname);
    if (resume) return handleMembershipRequest(request, env, resume[1]);

    const socket = /^\/api\/rooms\/([^/]+)\/socket$/.exec(pathname);
    if (socket) return handleSocketRequest(request, env, socket[1]);

    return new Response('Not found', {
      status: 404,
      headers,
    });
  },
} satisfies ExportedHandler<Env>;
