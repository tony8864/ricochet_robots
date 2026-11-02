// Isolated full-runtime fixture only; never imported by production routing.
import application, { Room as BaseRoom, Registry } from '../src/index';
import type { LiveLobby } from '../src/liveLobby';
export { Registry };
let now = Date.now();
Date.now = () => now;

export class Room extends BaseRoom {
  fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname !== '/__test/alarm') return super.fetch(request);
    now = Number(url.searchParams.get('now'));
    const live = (this as unknown as { live: LiveLobby }).live;
    return live.run(async () => { await live.alarm(); return new Response(null, { status: 204 }); });
  }
}
export default {
  async fetch(request: Request, env: Env) {
    if (new URL(request.url).pathname !== '/__test/clock') return application.fetch(request, env);
    const input = await request.json() as { now?: number; roomId?: string };
    if (input.now !== undefined) {
      if (!Number.isSafeInteger(input.now) || input.now < now) return new Response(null, { status: 400 });
      now = input.now;
    }
    if (input.roomId) await env.ROOMS.get(env.ROOMS.idFromName(input.roomId))
      .fetch(new Request(`https://room.internal/__test/alarm?now=${now}`));
    return Response.json({ now });
  },
};
