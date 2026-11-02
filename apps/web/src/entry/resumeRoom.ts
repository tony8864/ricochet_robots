import { MAX_SERVER_MESSAGE_BYTES, PROTOCOL_VERSION, parseClientRequest, parseServerMessageJson, type RoomEnteredMessage } from '@robot-puzzle/shared';

export type ResumeResult = { readonly status: 'resumed'; readonly entry: RoomEnteredMessage }
  | { readonly status: 'transient' | 'expired' | 'closed' | 'error'; readonly message: string };

/** Authenticated resume only: never opens an identity or allocates a seat. */
export async function resumeRoom(roomId: string, signal: AbortSignal, fetcher: typeof fetch = fetch,
  commandId: string = crypto.randomUUID()): Promise<ResumeResult> {
  if (!parseClientRequest({ version: PROTOCOL_VERSION, commandId, command: { type: 'session.resume', roomId } }).ok
    || (typeof location !== 'undefined' && location.protocol !== 'https:')) return { status: 'error', message: 'A valid HTTPS room address is required for recovery.' };
  const controller = new AbortController();
  const cancel = () => controller.abort();
  signal.addEventListener('abort', cancel, { once: true });
  if (signal.aborted) controller.abort();
  const timeout = setTimeout(cancel, 10000);
  try {
    const response = await fetcher(`/api/rooms/${roomId}/resume`, { method: 'POST', credentials: 'same-origin',
      cache: 'no-store', redirect: 'error', signal: controller.signal, headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ version: PROTOCOL_VERSION, commandId, command: { type: 'session.resume', roomId } }) });
    if (response.headers.get('Content-Type')?.split(';')[0]?.trim().toLowerCase() !== 'application/json' || !response.body) {
      return { status: response.status >= 500 || response.status === 429 ? 'transient' : 'error', message: 'The server returned an unexpected response. Reconnect to synchronize.' };
    }
    const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
    try {
      while (true) {
        const chunk = await reader.read(); if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > MAX_SERVER_MESSAGE_BYTES) { await reader.cancel(); return { status: 'error', message: 'Invalid server response. Reconnect to synchronize.' }; }
        chunks.push(chunk.value);
      }
    } finally { reader.releaseLock(); }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    let text: string;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
    catch { return { status: 'error', message: 'Invalid server response. Reconnect to synchronize.' }; }
    const parsed = parseServerMessageJson(text);
    if (!parsed.ok) return { status: 'error', message: parsed.error === 'unsupported-version' ? 'Update required. Reload the game.' : 'Invalid server response. Reconnect to synchronize.' };
    const message = parsed.value;
    if (message.type === 'protocol.error' && message.reason === 'unsupported-version') return { status: 'error', message: 'Update required. Reload the game.' };
    if (!('commandId' in message) || message.commandId !== commandId) return { status: 'error', message: 'The server response did not match this recovery request.' };
    if (message.type === 'request.rejected') {
      const reason = message.reason;
      if (reason === 'not-authenticated') return { status: 'expired', message: 'Your session is unavailable or expired. Your previous seat cannot be restored with a new identity.' };
      if (reason === 'room-not-found') return { status: 'closed', message: 'This room is no longer available.' };
      if (reason === 'room-closed') return { status: 'closed', message: 'The host ended this room.' };
      if (reason === 'room-expired') return { status: 'closed', message: 'This room has expired.' };
      if (reason === 'seat-not-found') return { status: 'expired', message: 'Your seat could not be restored with this browser session.' };
      return { status: reason === 'temporarily-unavailable' || reason === 'rate-limited' ? 'transient' : 'error', message: 'The room could not be restored. Please reconnect.' };
    }
    if (!response.ok || message.type !== 'room.entered' || message.membership !== 'resumed' || message.roomId !== roomId) {
      return { status: 'error', message: 'The room recovery response did not match the requested seat.' };
    }
    return { status: 'resumed', entry: message };
  } catch (error) {
    return { status: error instanceof TypeError && !controller.signal.aborted ? 'transient' : controller.signal.aborted ? 'transient' : 'error',
      message: controller.signal.aborted ? 'Recovery timed out. Reconnecting…' : 'Connection lost. Reconnecting…' };
  } finally { clearTimeout(timeout); signal.removeEventListener('abort', cancel); }
}
