import {
  MAX_CLIENT_MESSAGE_BYTES, MAX_SERVER_MESSAGE_BYTES, PROTOCOL_VERSION, parseClientRequestJson,
} from '@robot-puzzle/shared';
import type { ClientRequest, PrivateServerMessage, ProtocolErrorReason } from '@robot-puzzle/shared';

export function reply(message: PrivateServerMessage, status = 200, cookie?: string): Response {
  const headers = new Headers({ 'Cache-Control': 'no-store' });
  if (cookie) headers.set('Set-Cookie', cookie);
  const json = JSON.stringify(message);
  if (new TextEncoder().encode(json).byteLength > MAX_SERVER_MESSAGE_BYTES) throw new Error('Server message too large');
  headers.set('Content-Type', 'application/json');
  return new Response(json, { status, headers });
}

export function protocolError(reason: ProtocolErrorReason, status: number, commandId: string | null = null): Response {
  return reply({ version: PROTOCOL_VERSION, type: 'protocol.error', commandId, reason, serverTimeMs: Date.now() }, status);
}

export function isAllowedOrigin(origin: string | null, configured: string): boolean {
  if (!origin) return false;
  return configured.split(',').some((entry) => {
    const allowed = entry.trim();
    try {
      const url = new URL(allowed);
      return url.protocol === 'https:' && url.origin === allowed && origin === allowed;
    } catch {
      return false;
    }
  });
}

async function readBody(request: Request): Promise<
  { text: string } | { error: 'too-large' | 'invalid-encoding' }
> {
  const reader = request.body?.getReader();
  if (!reader) return { text: '' };
  const bytes = new Uint8Array(MAX_CLIENT_MESSAGE_BYTES);
  let length = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      if (length + chunk.value.byteLength > bytes.length) {
        await reader.cancel();
        return { error: 'too-large' };
      }
      bytes.set(chunk.value, length);
      length += chunk.value.byteLength;
    }
    return { text: new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes.subarray(0, length)) };
  } catch {
    return { error: 'invalid-encoding' };
  } finally {
    reader.releaseLock();
  }
}

export async function parseBootstrapPost(request: Request, env: Env): Promise<ClientRequest | Response> {
  if (request.method !== 'POST') {
    return new Response(null, { status: 405, headers: { Allow: 'POST', 'Cache-Control': 'no-store' } });
  }
  if (!isAllowedOrigin(request.headers.get('Origin'), env.ALLOWED_ORIGINS)) {
    return protocolError('invalid-message', 403);
  }
  const contentType = request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase();
  if (contentType !== 'application/json') return protocolError('invalid-message', 415);
  const declaredLength = request.headers.get('Content-Length');
  if (declaredLength !== null && (!/^\d+$/.test(declaredLength) || Number(declaredLength) > MAX_CLIENT_MESSAGE_BYTES)) {
    return protocolError('message-too-large', 413);
  }
  const body = await readBody(request);
  if ('error' in body) {
    return body.error === 'too-large'
      ? protocolError('message-too-large', 413) : protocolError('invalid-message', 400);
  }
  const parsed = parseClientRequestJson(body.text);
  if (!parsed.ok) return protocolError(parsed.error, 400);
  return parsed.value;
}
