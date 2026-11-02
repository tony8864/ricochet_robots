import { env, SELF, runInDurableObject } from 'cloudflare:test';
import { describe, expect, test, vi } from 'vitest';
import { parseServerMessage } from '@robot-puzzle/shared';
import {
  SESSION_COOKIE, SESSION_LIFETIME_MS, SessionStore, credentialVerifier, readSessionCookie,
} from '../src/sessions';
import { handleSessionRequest } from '../src/sessionRoute';
import { isAllowedOrigin } from '../src/bootstrapHttp';

const commandId = '10000000-0000-4000-8000-000000000001';
const token = 'a'.repeat(64);
const origin = 'https://localhost:5173';
const input = { version: 2, commandId, command: { type: 'session.open' } };
const registry = () => env.REGISTRY.get(env.REGISTRY.idFromName('registry-v1'));

function request(body = JSON.stringify(input), headers: Record<string, string> = {}) {
  return new Request('https://localhost:5173/api/session', {
    method: 'POST', body,
    headers: { Origin: origin, 'Content-Type': 'application/json', ...headers },
  });
}

async function assertReply(response: Response, status: number, type: string, reason?: string) {
  expect(response.status).toBe(status);
  const body = await response.json();
  const parsed = parseServerMessage(body);
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) throw new Error('Expected valid server message');
  expect(body).toMatchObject({ type, ...(reason ? { reason } : {}) });
  expect(JSON.stringify(body)).not.toContain(token);
  expect(response.headers.get('Cache-Control')).toBe('no-store');
  expect(response.headers.has('Access-Control-Allow-Origin')).toBe(false);
  return parsed.value;
}

describe('session HTTP boundary', () => {
  test('issues only a secure host cookie and persists its verifier, not its credential', async () => {
    const response = await SELF.fetch(request());
    const body = await assertReply(response, 200, 'session.ready');
    expect(Object.keys(body).sort()).toEqual(['commandId', 'serverTimeMs', 'type', 'version']);
    const cookie = response.headers.get('Set-Cookie')!;
    expect(cookie).toMatch(/^__Host-rr-session=[0-9a-f]{64}; Path=\/; Secure; HttpOnly; SameSite=Lax; Max-Age=86400$/);
    expect(cookie).not.toContain('Domain=');
    const credential = cookie.split(';')[0].split('=')[1];
    const verifier = await credentialVerifier(credential);
    const verified = await registry().verifySession(credential);
    expect(verified).not.toBeNull();
    expect(verified!.expiresAt - verified!.issuedAt).toBe(SESSION_LIFETIME_MS);
    await runInDurableObject(registry(), async (_instance, ctx) => {
      const rows = ctx.storage.sql.exec('SELECT * FROM browser_sessions').toArray();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ verifier, revoked_at: null });
      expect(JSON.stringify(rows)).not.toContain(credential);
      expect(ctx.storage.sql.exec("SELECT name FROM sqlite_master WHERE type = 'table'").toArray())
        .not.toContainEqual({ name: 'seats' });
    });
  });

  test('same jar/retried command reuses identity without Set-Cookie or extending expiry; another jar is distinct', async () => {
    const first = await SELF.fetch(request());
    const cookie = first.headers.get('Set-Cookie')!.split(';')[0];
    const credential = cookie.split('=')[1];
    const before = await registry().verifySession(credential);
    const retry = await SELF.fetch(request(JSON.stringify(input), { Cookie: cookie }));
    await assertReply(retry, 200, 'session.ready');
    expect(retry.headers.has('Set-Cookie')).toBe(false);
    expect(await registry().verifySession(credential)).toEqual(before);
    const other = await SELF.fetch(request());
    const otherCredential = other.headers.get('Set-Cookie')!.split(';')[0].split('=')[1];
    expect(otherCredential).not.toBe(credential);
    expect((await registry().verifySession(otherCredential))!.sessionId).not.toBe(before!.sessionId);
  });

  test.each(['bad', token])('invalid/unknown single cookie establishes a fresh anonymous identity: %s', async (value) => {
    const response = await SELF.fetch(request(JSON.stringify(input), { Cookie: `${SESSION_COOKIE}=${value}` }));
    await assertReply(response, 200, 'session.ready');
    expect(response.headers.get('Set-Cookie')).not.toContain(value === token ? token : '=bad;');
    expect(await registry().verifySession(value)).toBeNull();
  });

  test.each([
    `${SESSION_COOKIE}=${token}; ${SESSION_COOKIE}=${token}`,
    `${SESSION_COOKIE}=bad; ${SESSION_COOKIE}=${token}`,
    `${SESSION_COOKIE}=${token}, ${SESSION_COOKIE}=${token}`,
  ])('rejects ambiguous cookies without issuing another identity', async (cookie) => {
    const response = await SELF.fetch(request(JSON.stringify(input), { Cookie: cookie }));
    await assertReply(response, 401, 'request.rejected', 'not-authenticated');
    expect(response.headers.has('Set-Cookie')).toBe(false);
  });

  test.each(['', 'null', 'http://localhost:5173', 'https://localhost:5173.evil.test',
    'https://evil.test', 'https://localhost:5174', 'https://localhost:5173/'])(
    'rejects untrusted Origin %s before issuance', async (value) => {
      const response = await SELF.fetch(request(JSON.stringify(input), { Origin: value }));
      await assertReply(response, 403, 'protocol.error', 'invalid-message');
      expect(response.headers.has('Set-Cookie')).toBe(false);
    },
  );

  test('missing Origin is rejected', async () => {
    const req = request();
    req.headers.delete('Origin');
    await assertReply(await SELF.fetch(req), 403, 'protocol.error', 'invalid-message');
  });

  test.each(['text/plain', 'application/x-www-form-urlencoded', 'application/jsonp', ''])(
    'rejects Content-Type %s', async (value) => {
      await assertReply(await SELF.fetch(request(JSON.stringify(input), { 'Content-Type': value })),
        415, 'protocol.error', 'invalid-message');
    },
  );

  test('accepts JSON with a charset parameter', async () => {
    await assertReply(await SELF.fetch(request(JSON.stringify(input), { 'Content-Type': 'application/json; charset=utf-8' })),
      200, 'session.ready');
  });

  test.each(['GET', 'PUT', 'DELETE', 'OPTIONS'])('rejects method %s without CORS or mutation', async (method) => {
    const response = await SELF.fetch('https://localhost:5173/api/session', { method });
    expect(response.status).toBe(405);
    expect(response.headers.get('Allow')).toBe('POST');
    expect(response.headers.has('Set-Cookie')).toBe(false);
    expect(response.headers.has('Access-Control-Allow-Origin')).toBe(false);
  });

  test.each([
    ['{', 'invalid-json'], ['too-large', 'invalid-json'],
    [JSON.stringify({ ...input, version: 1 }), 'unsupported-version'],
    [JSON.stringify({ ...input, credential: token }), 'invalid-message'],
    [JSON.stringify({ ...input, command: { type: 'room.create', nickname: 'Maria' } }), 'invalid-message'],
  ])('rejects malformed/wrong command without echoing input', async (body, reason) => {
    const response = await SELF.fetch(request(body));
    await assertReply(response, 400, 'protocol.error', reason);
    expect(response.headers.has('Set-Cookie')).toBe(false);
  });

  test('bounds streamed UTF-8 bytes even without Content-Length', async () => {
    const encoder = new TextEncoder();
    const req = new Request('https://localhost:5173/api/session', {
      method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' },
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode(' '.repeat(2048)));
          controller.enqueue(encoder.encode('é'.repeat(2048)));
          controller.close();
        },
      }),
    });
    await assertReply(await handleSessionRequest(req, env), 413, 'protocol.error', 'message-too-large');
  });

  test('rejects oversized declared length before reading the body', async () => {
    await assertReply(await handleSessionRequest(request('{}', { 'Content-Length': '4097' }), env),
      413, 'protocol.error', 'message-too-large');
  });

  test('rejects invalid UTF-8', async () => {
    const req = new Request('https://localhost:5173/api/session', {
      method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: new Uint8Array([255]),
    });
    await assertReply(await handleSessionRequest(req, env), 400, 'protocol.error', 'invalid-message');
  });

  test('registry failure returns a bounded private error without exception details', async () => {
    const brokenEnv = { ...env, REGISTRY: { idFromName() { throw new Error(token); } } } as unknown as Env;
    const response = await handleSessionRequest(request(), brokenEnv);
    await assertReply(response, 503, 'request.rejected', 'temporarily-unavailable');
    expect(response.headers.has('Set-Cookie')).toBe(false);
  });

  test('HTTP issuance rate exhaustion returns the approved private reason without setting a cookie', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
    try {
      await runInDurableObject(registry(), async (_instance, ctx) => {
        ctx.storage.sql.exec('INSERT INTO session_issuance_budget VALUES (1, 960000, 60)');
      });
      const response = await SELF.fetch(request());
      await assertReply(response, 429, 'request.rejected', 'rate-limited');
      expect(response.headers.has('Set-Cookie')).toBe(false);
    } finally {
      clock.mockRestore();
    }
  });
});

describe('controlled-clock durable session service', () => {
  test('hard expiry, revocation, malformed/tampered tokens and replacement identities', async () => {
    await runInDurableObject(registry(), async (_instance, ctx) => {
      let now = 1_000_000;
      let sequence = 0;
      const store = new SessionStore(ctx.storage, {
        now: () => now,
        credential: () => (++sequence).toString(16).padStart(64, '0'),
        sessionId: () => crypto.randomUUID(),
      });
      const opened = await store.open(null);
      if (opened.status !== 'ready' || !opened.credential) throw new Error('Expected issuance');
      const first = opened.session;
      const raw = opened.credential;
      now = first.expiresAt - 1;
      expect(await store.verify(raw)).toEqual(first);
      expect(await store.open(raw)).toEqual({ status: 'ready', session: first });
      now = first.expiresAt;
      expect(await store.verify(raw)).toBeNull();
      const replacement = await store.open(raw);
      if (replacement.status !== 'ready' || !replacement.credential) throw new Error('Expected replacement');
      expect(replacement.session.sessionId).not.toBe(first.sessionId);
      expect(replacement.session.expiresAt).toBe(now + SESSION_LIFETIME_MS);
      now += 1;
      expect(await store.verify(raw)).toBeNull();
      expect(await store.verify('bad')).toBeNull();
      expect(await store.verify(token)).toBeNull();
      const altered = `${replacement.credential.slice(0, 63)}f`;
      expect(await store.verify(altered)).toBeNull();
      const hash = await credentialVerifier(replacement.credential);
      ctx.storage.sql.exec('UPDATE browser_sessions SET revoked_at = ? WHERE verifier = ?', now, hash);
      expect(await store.verify(replacement.credential)).toBeNull();
      const afterRevocation = await store.open(replacement.credential);
      expect(afterRevocation.status).toBe('ready');
      if (afterRevocation.status === 'ready') expect(afterRevocation.session.sessionId).not.toBe(replacement.session.sessionId);
    });
  });

  test('concurrent issuance is capped at 60/minute, persists across service recreation, and valid reuse still works', async () => {
    await runInDurableObject(registry(), async (_instance, ctx) => {
      let now = 60_000;
      const dependencies = { now: () => now, credential: () => crypto.randomUUID().replaceAll('-', '') + crypto.randomUUID().replaceAll('-', ''), sessionId: () => crypto.randomUUID() };
      const store = new SessionStore(ctx.storage, dependencies);
      const results = await Promise.all(Array.from({ length: 61 }, () => store.open(null)));
      expect(results.filter((result) => result.status === 'ready')).toHaveLength(60);
      expect(results.filter((result) => result.status === 'rejected')).toEqual([{ status: 'rejected', reason: 'rate-limited' }]);
      const coldService = new SessionStore(ctx.storage, dependencies);
      expect(await coldService.open(null)).toEqual({ status: 'rejected', reason: 'rate-limited' });
      const first = results[0];
      if (first.status !== 'ready' || !first.credential) throw new Error('Expected first session');
      expect(await coldService.open(first.credential)).toEqual({ status: 'ready', session: first.session });
      now = 120_000;
      expect((await coldService.open(null)).status).toBe('ready');
    });
  });

  test('capacity fails closed without evicting live identities; expired private records can be reclaimed', async () => {
    await runInDurableObject(registry(), async (_instance, ctx) => {
      const now = 1_000_000;
      ctx.storage.sql.exec(`WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM n WHERE x < 10000)
        INSERT INTO browser_sessions (verifier, session_id, issued_at, expires_at)
        SELECT printf('%064x', x), printf('fixture-%d', x), ?, ? FROM n`, now, now + SESSION_LIFETIME_MS);
      const store = new SessionStore(ctx.storage, { now: () => now, credential: () => token, sessionId: () => crypto.randomUUID() });
      expect(await store.open(null)).toEqual({ status: 'rejected', reason: 'temporarily-unavailable' });
      expect(ctx.storage.sql.exec('SELECT COUNT(*) AS count FROM browser_sessions').one()).toEqual({ count: 10000 });
      ctx.storage.sql.exec('UPDATE browser_sessions SET expires_at = ? WHERE session_id = ?', now, 'fixture-1');
      expect((await store.open(null)).status).toBe('ready');
      expect(ctx.storage.sql.exec('SELECT COUNT(*) AS count FROM browser_sessions').one()).toEqual({ count: 10000 });
    });
  });

  test('credential collision fails without overwriting another session', async () => {
    await runInDurableObject(registry(), async (_instance, ctx) => {
      const store = new SessionStore(ctx.storage, { now: () => 1_000_000, credential: () => token, sessionId: () => crypto.randomUUID() });
      const first = await store.open(null);
      expect(first.status).toBe('ready');
      expect(await store.open(null)).toEqual({ status: 'rejected', reason: 'temporarily-unavailable' });
      expect(ctx.storage.sql.exec('SELECT COUNT(*) AS count FROM browser_sessions').one()).toEqual({ count: 1 });
    });
  });
});

describe('cookie and Origin parsing', () => {
  test('reads the exact cookie name without decoding or accepting a forged prefix', () => {
    expect(readSessionCookie(`other=x; ${SESSION_COOKIE}=${token}; preference=y`)).toEqual({ ambiguous: false, credential: token });
    for (const header of [null, '', `prefix-${SESSION_COOKIE}=${token}`, `${SESSION_COOKIE}="${token}"`, `${SESSION_COOKIE}=%61`]) {
      expect(readSessionCookie(header)).toEqual({ ambiguous: false, credential: null });
    }
    expect(readSessionCookie('x'.repeat(8193))).toEqual({ ambiguous: true });
  });

  test('only canonical HTTPS allowlist entries match, not wildcard or URL paths', () => {
    expect(isAllowedOrigin('https://192.168.1.65:5173', `${origin}, https://192.168.1.65:5173`)).toBe(true);
    for (const configured of ['*', 'https://localhost:5173/path', 'http://localhost:5173', '', 'https://user@localhost:5173']) {
      expect(isAllowedOrigin(origin, configured)).toBe(false);
    }
  });
});
