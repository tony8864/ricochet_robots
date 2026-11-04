import type { Page, WebSocketRoute } from '@playwright/test';
import type { PublicRoomState } from '../../../packages/shared/src';
import type { E2eEnvironment } from './environment';
import { expect } from './fixtures';

/** Real-server proxy: only an explicitly armed move acknowledgment is dropped. */
export async function recoveryTransport(page: Page) {
  let server: WebSocketRoute | undefined; let bound = false;
  let room: PublicRoomState | undefined; let now = 0;
  let armed = false; let dropped = 0; let duplicate = false; let moveId = '';
  const moves: string[] = [];
  const reads = new Map<string, { resolve(): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>();
  await page.routeWebSocket(/\/api\/rooms\/[^/]+\/socket$/, (client) => {
    server = client.connectToServer(); const upstream = server; bound = false;
    client.onMessage((data) => {
      const input = JSON.parse(String(data));
      if (input.command?.type === 'attempt.move' && moves.length < 20) {
        moves.push(String(data));
        if (armed) { moveId = input.commandId; armed = false; }
      }
      upstream.send(data);
    });
    upstream.onMessage((data) => {
      const message = JSON.parse(String(data));
      now = message.serverTimeMs ?? now;
      if (message.type === 'session.bound') bound = true;
      if (message.type === 'room.snapshot' || message.type === 'session.bound') room = message.state;
      if (message.type === 'command.result') {
        const read = reads.get(message.commandId);
        if (read) { clearTimeout(read.timer); reads.delete(message.commandId); read.resolve(); }
        if (message.commandId === moveId) {
          if (!dropped) { dropped++; return; }
          duplicate ||= message.duplicate === true;
        }
      }
      client.send(data);
    });
  });
  return {
    room: () => room,
    now: () => now,
    moves: () => [...moves],
    dropped: () => dropped,
    duplicate: () => duplicate,
    dropNextMoveReply() { armed = true; },
    disconnect() { bound = false; server?.close({ code: 1001, reason: 'Test transport interrupted' }); },
    async snapshot() {
      await expect.poll(() => bound).toBe(true);
      if (!room || !server) throw new Error('No real bound transport');
      const commandId = crypto.randomUUID();
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => { reads.delete(commandId); reject(new Error('No authenticated snapshot acknowledgment')); }, 10_000);
        reads.set(commandId, { resolve, reject, timer });
        server!.send(JSON.stringify({ version: 2, commandId, roomId: room!.roomId, context: {}, command: { type: 'state.request' } }));
      });
    },
  };
}

export async function advanceServer(environment: E2eEnvironment, roomId: string, target: number,
  alive: ReadonlyArray<Awaited<ReturnType<typeof recoveryTransport>>> = []) {
  if (!environment.clock) throw new Error('Controlled server time is not enabled');
  let now = await environment.clock.now();
  while (now < target) {
    // Ordinary authenticated reads keep genuinely open transports responsive.
    // Do not fake lease state, heartbeat sequences or outgoing-traffic renewal.
    for (const transport of alive) await transport.snapshot();
    now = await environment.clock.advanceTo(alive.length ? Math.min(target, now + 20_000) : target, roomId);
  }
}
