// Test-only entry: never referenced by wrangler.jsonc or the public Worker.
import { Registry as RegistryBase } from '../src/registry';
import { Room as RoomBase } from '../src/room';
import { SessionStore } from '../src/sessions';
import worker from '../src/index';
import { CreationStore } from '../src/creations';
import { parseClientRequest } from '@robot-puzzle/shared';
import { readSessionCookie } from '../src/sessions';

async function markerResponse(request: Request, storage: DurableObjectStorage, version: number | null) {
  if (request.method === 'PUT') await storage.put('test-marker', await request.text());
  return Response.json({ version, marker: await storage.get('test-marker') ?? null });
}

export class Registry extends RegistryBase {
  fetch(request: Request): Promise<Response> {
    if (new URL(request.url).pathname === '/test-reserve') return this.reserveForTest(request);
    if (new URL(request.url).pathname === '/test-session') {
      // Controlled clock/input exists only in this isolated test bundle.
      const store = new SessionStore(this.ctx.storage, {
        now: () => Number(request.headers.get('X-Test-Time')),
        credential: () => 'b'.repeat(64),
        sessionId: () => crypto.randomUUID(),
      });
      const result = request.method === 'POST'
        ? store.open(null) : store.verify(request.headers.get('X-Test-Credential') ?? '');
      return result.then((value) => Response.json(value));
    }
    return markerResponse(request, this.ctx.storage, this.getStorageVersion());
  }

  private async reserveForTest(request: Request): Promise<Response> {
    const cookie = readSessionCookie(request.headers.get('Cookie'));
    const session = !cookie.ambiguous && cookie.credential ? await this.verifySession(cookie.credential) : null;
    const parsed = parseClientRequest(await request.json());
    if (!session || !parsed.ok || parsed.value.command.type !== 'room.create') throw new Error('Invalid test reservation');
    const value = new CreationStore(this.ctx.storage).reserve(session.sessionId, session.expiresAt,
      parsed.value as import('../src/creations').CreateRequest);
    if (value.status !== 'rejected' && request.headers.get('X-Test-Initialize') === 'true') {
      using state = await this.env.ROOMS.get(this.env.ROOMS.idFromName(value.initialization.roomId)).initialize(value.initialization);
    }
    return Response.json(value);
  }
}

export class Room extends RoomBase {
  fetch(request: Request): Promise<Response> {
    if (new URL(request.url).pathname === '/socket') return super.fetch(request);
    return markerResponse(request, this.ctx.storage, this.getStorageVersion());
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const pathname = new URL(request.url).pathname;
    if (pathname.startsWith('/api/')) return worker.fetch(request, env);
    if (pathname === '/test-reserve') return env.REGISTRY.get(env.REGISTRY.idFromName('registry-v1')).fetch(request);
    const binding = pathname === '/registry' || pathname === '/test-session' ? env.REGISTRY : env.ROOMS;
    return binding.get(binding.idFromName('restart-smoke')).fetch(request);
  },
};
