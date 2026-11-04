// Browser-test bundle ONLY. Production entry/routing never imports this module.
import { DurableObject } from 'cloudflare:workers';
import application, { Registry, Room as BaseRoom } from '../src/index';
import type { LiveLobby } from '../src/liveLobby';
export { Registry };
export default application;

const wallNow = Date.now.bind(Date);
let offset = 0;
Date.now = () => wallNow() + offset;

function advance(value: unknown): void {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new Error('Invalid controlled server time');
  offset = Math.max(offset, (value as number) - wallNow());
}

export class Room extends BaseRoom {
  fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.hostname !== 'e2e-clock.internal' || url.pathname !== '/tick' || request.method !== 'POST') return super.fetch(request);
    return (async () => {
      advance((await request.json() as { now: number }).now);
      const live = (this as unknown as { live: LiveLobby }).live;
      return live.run(async () => { await live.alarm(); return Response.json({ now: Date.now() }); });
    })();
  }
}

/** Node obtains this namespace directly from Miniflare, not through HTTP routes. */
export class RecoveryClock extends DurableObject<Env> {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method !== 'POST' || url.hostname !== 'e2e-clock.internal' || url.pathname !== '/control') return new Response(null, { status: 404 });
    const input = await request.json() as { now?: number; roomId?: string };
    if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some((key) => key !== 'now' && key !== 'roomId')
      || (input.now !== undefined && (!Number.isSafeInteger(input.now) || input.now < 0))
      || (input.roomId !== undefined && (typeof input.roomId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(input.roomId)))) {
      return new Response(null, { status: 400 });
    }
    if (input.now !== undefined) advance(input.now);
    if (input.roomId !== undefined) {
      const response = await this.env.ROOMS.get(this.env.ROOMS.idFromName(input.roomId)).fetch(new Request('https://e2e-clock.internal/tick', {
        method: 'POST', body: JSON.stringify({ now: Date.now() }),
      }));
      if (!response.ok) throw new Error('Controlled normalization failed');
      await response.arrayBuffer();
    }
    return Response.json({ now: Date.now() });
  }
}
