import {
  MAX_CLIENT_MESSAGE_BYTES, MAX_SERVER_MESSAGE_BYTES, PROTOCOL_VERSION,
  parseClientRequestJson, parsePublicRoomState, parsePublicServerMessage,
} from '@robot-puzzle/shared';
import type { PrivateServerMessage, PublicServerMessage, RoomRequest } from '@robot-puzzle/shared';
import { consumeSocketBudget, executeLobbyCommand, expireBidding, saveRoom, storedRoom } from './lobbyCommands';
import { ensurePreparationJob, runPreparationAlarm } from './roomPreparation';
import { preparationDue } from './preparationJob';

interface SocketBinding {
  readonly version: 1;
  readonly sessionId: string;
  readonly seatId: string;
  readonly roomId: string;
  readonly issuedAt: number;
  readonly expiresAt: number;
}

/** Private transport controller; never exposed through a public/debug route. */
export class LiveLobby {
  private tail: Promise<unknown> = Promise.resolve();
  private deadlineChanged = false;
  constructor(private readonly ctx: DurableObjectState, private readonly env: Env) {}

  // Awaited Registry checks must not let Room events publish out-of-order state.
  run<T>(work: () => Promise<T>): Promise<T> {
    const result = this.tail.then(work);
    this.tail = result.catch(() => undefined);
    return result;
  }
  idle(): Promise<unknown> { return this.tail; }

  private binding(ws: WebSocket): SocketBinding | null {
    const value = ws.deserializeAttachment() as Partial<SocketBinding> | null;
    if (!value || value.version !== 1 || typeof value.sessionId !== 'string' || typeof value.seatId !== 'string'
      || typeof value.roomId !== 'string' || !Number.isSafeInteger(value.issuedAt) || !Number.isSafeInteger(value.expiresAt)) return null;
    return value as SocketBinding;
  }
  private drop(ws: WebSocket, code: number): void {
    ws.serializeAttachment(null);
    try { ws.close(code, code === 1008 ? 'Session unavailable' : 'Connection closed'); } catch { /* already closed */ }
  }
  private async authorized(ws: WebSocket): Promise<SocketBinding | null> {
    const binding = this.binding(ws);
    if (ws.readyState !== WebSocket.OPEN) return null;
    if (!binding) { this.drop(ws, 1008); return null; }
    if (Date.now() < binding.issuedAt || Date.now() >= binding.expiresAt) { this.drop(ws, 1008); return null; }
    const saved = storedRoom(this.ctx.storage);
    if (!saved || saved.state.roomId !== binding.roomId || saved.members[binding.sessionId] !== binding.seatId
      || !saved.state.players.some((p) => p.seatId === binding.seatId)) { this.drop(ws, 1008); return null; }
    try {
      using current = await this.env.REGISTRY.get(this.env.REGISTRY.idFromName('registry-v1')).verifySessionIdentity(binding.sessionId);
      if (!current || current.issuedAt !== binding.issuedAt || current.expiresAt !== binding.expiresAt
        || Date.now() >= current.expiresAt) { this.drop(ws, 1008); return null; }
      return binding;
    } catch { this.drop(ws, 1013); return null; }
  }
  private raw(ws: WebSocket, message: PrivateServerMessage | PublicServerMessage): boolean {
    const json = JSON.stringify(message);
    if (new TextEncoder().encode(json).byteLength > MAX_SERVER_MESSAGE_BYTES) { this.drop(ws, 1011); return false; }
    try { ws.send(json); return true; } catch { this.drop(ws, 1013); return false; }
  }
  private async privateMessage(ws: WebSocket, message: () => PrivateServerMessage): Promise<boolean> {
    if (!await this.authorized(ws)) return false;
    if (expireBidding(this.ctx.storage, Date.now())) this.deadlineChanged = true;
    return this.raw(ws, message());
  }

  private async reconcile(): Promise<{ sockets: WebSocket[]; changed: boolean }> {
    const saved = storedRoom(this.ctx.storage);
    if (!saved) return { sockets: [], changed: false };
    const sockets: WebSocket[] = [];
    const seats = new Set<string>();
    for (const ws of this.ctx.getWebSockets()) {
      const binding = await this.authorized(ws);
      if (binding) { sockets.push(ws); seats.add(binding.seatId); }
    }
    const players = saved.state.players.map((p) => ({ ...p, connected: seats.has(p.seatId) }));
    const changed = players.some((p, i) => p.connected !== saved.state.players[i].connected);
    if (changed) {
      const parsed = parsePublicRoomState({ ...saved.state, revision: saved.state.revision + 1, players });
      if (!parsed.ok) throw new Error('Invalid connection snapshot');
      saveRoom(this.ctx.storage, { ...saved, state: parsed.value });
    }
    return { sockets, changed };
  }
  private async scheduleExpiry(): Promise<void> {
    const deadlines = this.ctx.getWebSockets().filter((ws) => ws.readyState === WebSocket.OPEN)
      .map((ws) => this.binding(ws)?.expiresAt).filter((value): value is number => value !== undefined);
    const match = storedRoom(this.ctx.storage)?.match;
    const duePreparation = preparationDue(match?.version === 2 ? match.job : undefined);
    if (duePreparation !== undefined) deadlines.push(duePreparation);
    if (match?.state.phase === 'bidding') deadlines.push(match.state.deadlineAtMs);
    if (!deadlines.length) { await this.ctx.storage.deleteAlarm(); return; }
    const due = Math.min(...deadlines);
    if (await this.ctx.storage.getAlarm() !== due) await this.ctx.storage.setAlarm(due);
  }

  /** Validate each recipient immediately before delivery. Failed sends never undo state. */
  async publish(force = true): Promise<void> {
    if (ensurePreparationJob(this.ctx.storage, Date.now())) force = true;
    if (expireBidding(this.ctx.storage, Date.now())) force = true;
    if (this.deadlineChanged) { force = true; this.deadlineChanged = false; }
    let repeat: boolean;
    do {
      repeat = false;
      const { sockets, changed } = await this.reconcile();
      if (force || changed) {
        for (const ws of sockets) {
          if (!await this.authorized(ws)) { repeat = true; continue; }
          if (expireBidding(this.ctx.storage, Date.now())) repeat = true;
          const saved = storedRoom(this.ctx.storage);
          if (!saved) continue;
          const message: PublicServerMessage = { version: PROTOCOL_VERSION, type: 'room.snapshot',
            state: saved.state, serverTimeMs: Date.now() };
          const parsed = parsePublicServerMessage(message);
          if (!parsed.ok) throw new Error('Invalid broadcast');
          if (!this.raw(ws, parsed.value)) repeat = true;
        }
      }
      force = repeat;
    } while (repeat);
    await this.scheduleExpiry();
  }

  async connect(sessionId: string, roomId: string): Promise<Response> {
    await this.publish(false);
    using session = await this.env.REGISTRY.get(this.env.REGISTRY.idFromName('registry-v1')).verifySessionIdentity(sessionId);
    const saved = storedRoom(this.ctx.storage);
    if (!session) return new Response(null, { status: 401 });
    if (!saved || saved.state.roomId !== roomId) return new Response(null, { status: 404 });
    const seatId = saved.members[sessionId];
    if (!seatId || !saved.state.players.some((p) => p.seatId === seatId)) return new Response(null, { status: 403 });
    const count = this.ctx.getWebSockets().filter((ws) => ws.readyState === WebSocket.OPEN && this.binding(ws)?.sessionId === sessionId).length;
    if (count >= 4) return new Response(null, { status: 429 });
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ version: 1, sessionId, seatId, roomId,
      issuedAt: session.issuedAt, expiresAt: session.expiresAt } satisfies SocketBinding);
    await this.reconcile();
    const sent = await this.privateMessage(server, () => ({ version: PROTOCOL_VERSION, type: 'session.bound',
      roomId, seatId, state: storedRoom(this.ctx.storage)!.state, serverTimeMs: Date.now() }));
    if (!sent) { await this.publish(); return new Response(null, { status: 401 }); }
    await this.publish();
    if (server.readyState !== WebSocket.OPEN) return new Response(null, { status: 401 });
    return new Response(null, { status: 101, webSocket: client });
  }

  async message(ws: WebSocket, data: string | ArrayBuffer): Promise<void> {
    try {
      await this.publish(false);
      const binding = await this.authorized(ws);
      if (!binding) { await this.publish(false); return; }
      if (!consumeSocketBudget(this.ctx.storage, binding.sessionId, Date.now())) {
        this.drop(ws, 1013); await this.publish(); return;
      }
      const protocolError = async (reason: 'message-too-large' | 'invalid-message' | 'invalid-json' | 'unsupported-version', commandId: string | null = null) => {
        await this.privateMessage(ws, () => ({ version: PROTOCOL_VERSION, type: 'protocol.error',
          commandId, reason, serverTimeMs: Date.now() }));
      };
      if (typeof data !== 'string') { await protocolError('invalid-message'); this.drop(ws, 1003); await this.publish(); return; }
      // Bound before JSON parsing, without allocating an encoder buffer for huge strings.
      if (data.length > MAX_CLIENT_MESSAGE_BYTES || new TextEncoder().encode(data).byteLength > MAX_CLIENT_MESSAGE_BYTES) {
        await protocolError('message-too-large'); this.drop(ws, 1009); await this.publish(); return;
      }
      const parsed = parseClientRequestJson(data);
      if (!parsed.ok) { await protocolError(parsed.error); return; }
      const input = parsed.value;
      if (!('roomId' in input) || input.roomId !== binding.roomId) { await protocolError('invalid-message', input.commandId); return; }
      if (input.command.type !== 'state.request' && input.command.type !== 'board.shuffle' && input.command.type !== 'room.start' && input.command.type !== 'preparation.retry' && input.command.type !== 'bid.submit' &&
        input.command.type !== 'attempt.move' && input.command.type !== 'attempt.undo' && input.command.type !== 'attempt.reset' && input.command.type !== 'attempt.giveUp' &&
        input.command.type !== 'round.skip' && input.command.type !== 'round.continue' && input.command.type !== 'match.returnToLobby') {
        this.drop(ws, 1013); await this.publish(); return;
      }
      // Recheck immediately before mutation, after any asynchronous boundary.
      if (!await this.authorized(ws)) { await this.publish(); return; }
      const result = executeLobbyCommand(this.ctx.storage, binding.sessionId, binding.seatId, input as RoomRequest);
      if (!result) { this.drop(ws, 1013); await this.publish(); return; }
      await this.scheduleExpiry(); // Durable intent is already committed; arm before acknowledging.
      await this.privateMessage(ws, () => ({ version: PROTOCOL_VERSION, type: 'command.result',
        roomId: binding.roomId, commandId: input.commandId, outcome: result.outcome,
        processedRevision: result.processedRevision, currentRevision: storedRoom(this.ctx.storage)!.state.revision,
        duplicate: result.duplicate, serverTimeMs: Date.now() }));
      if (result.changed) await this.publish();
      else {
        if (await this.authorized(ws)) {
          const saved = storedRoom(this.ctx.storage)!;
          const message: PublicServerMessage = { version: PROTOCOL_VERSION, type: 'room.snapshot', state: saved.state, serverTimeMs: Date.now() };
          const checked = parsePublicServerMessage(message);
          if (!checked.ok) throw new Error('Invalid snapshot');
          this.raw(ws, checked.value);
        }
        await this.publish(false);
      }
    } catch {
      this.drop(ws, 1013);
      // Storage outages may prevent reconciliation; cold restore will repair flags.
      try { await this.publish(); } catch { /* no sensitive diagnostics */ }
    }
  }

  async closed(ws: WebSocket, code: number): Promise<void> {
    if (!this.binding(ws)) return;
    this.drop(ws, code === 1000 ? 1000 : 1001);
    await this.publish();
  }

  async alarm(): Promise<void> {
    await runPreparationAlarm(this.ctx.storage, Date.now());
    await this.publish(); // Also expires sessions and re-arms all remaining work.
  }
}
