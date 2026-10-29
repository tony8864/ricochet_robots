export const SESSION_LIFETIME_MS = 86_400_000;
export const SESSION_CAPACITY = 10_000;
export const SESSION_ISSUANCE_PER_MINUTE = 60;
export const SESSION_COOKIE = '__Host-rr-session';

const CREDENTIAL_PATTERN = /^[0-9a-f]{64}$/;

export interface VerifiedSession {
  readonly sessionId: string;
  readonly issuedAt: number;
  readonly expiresAt: number;
}

type SessionRow = {
  session_id: string;
  issued_at: number;
  expires_at: number;
  revoked_at: number | null;
};

interface SessionDependencies {
  readonly now: () => number;
  readonly credential: () => string;
  readonly sessionId: () => string;
}

export type OpenSessionResult =
  | { readonly status: 'ready'; readonly session: VerifiedSession; readonly credential?: string }
  | { readonly status: 'rejected'; readonly reason: 'rate-limited' | 'temporarily-unavailable' };

export function isSessionCredential(value: unknown): value is string {
  return typeof value === 'string' && CREDENTIAL_PATTERN.test(value);
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function credentialVerifier(credential: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(credential));
  return hex(new Uint8Array(digest));
}

export function initializeSessions(storage: DurableObjectStorage): void {
  storage.sql.exec(`CREATE TABLE IF NOT EXISTS browser_sessions (
    verifier TEXT PRIMARY KEY,
    session_id TEXT NOT NULL UNIQUE,
    issued_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    revoked_at INTEGER
  )`);
  storage.sql.exec('CREATE INDEX IF NOT EXISTS sessions_expiry ON browser_sessions (expires_at)');
  storage.sql.exec(`CREATE TABLE IF NOT EXISTS session_issuance_budget (
    singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
    window_start INTEGER NOT NULL,
    count INTEGER NOT NULL
  )`);
}

/** Registry-private storage service. Tests inject clocks/randomness, never clients. */
export class SessionStore {
  constructor(
    private readonly storage: DurableObjectStorage,
    private readonly dependencies: SessionDependencies = {
      now: () => Date.now(),
      credential: () => hex(crypto.getRandomValues(new Uint8Array(32))),
      sessionId: () => crypto.randomUUID(),
    },
  ) {}

  private read(verifier: string, now: number): VerifiedSession | null {
    const row = this.storage.sql.exec<SessionRow>(
      'SELECT session_id, issued_at, expires_at, revoked_at FROM browser_sessions WHERE verifier = ?',
      verifier,
    ).toArray()[0];
    if (!row || row.revoked_at !== null || now < row.issued_at || now >= row.expires_at) return null;
    return { sessionId: row.session_id, issuedAt: row.issued_at, expiresAt: row.expires_at };
  }

  async verify(credential: string): Promise<VerifiedSession | null> {
    if (!isSessionCredential(credential)) return null;
    const verifier = await credentialVerifier(credential);
    return this.read(verifier, this.dependencies.now());
  }

  /** Server-binding-only lookup for an already authenticated socket attachment. */
  byId(sessionId: string): VerifiedSession | null {
    const row = this.storage.sql.exec<SessionRow>(
      'SELECT session_id, issued_at, expires_at, revoked_at FROM browser_sessions WHERE session_id = ?', sessionId,
    ).toArray()[0];
    const now = this.dependencies.now();
    if (!row || row.revoked_at !== null || now < row.issued_at || now >= row.expires_at) return null;
    return { sessionId: row.session_id, issuedAt: row.issued_at, expiresAt: row.expires_at };
  }

  async open(credential: string | null): Promise<OpenSessionResult> {
    // Hashing is outside the transaction; the final time/validity check is inside.
    const existingVerifier = isSessionCredential(credential) ? await credentialVerifier(credential) : null;
    const newCredential = this.dependencies.credential();
    if (!isSessionCredential(newCredential)) throw new Error('Invalid server credential source');
    const newVerifier = await credentialVerifier(newCredential);

    return this.storage.transactionSync(() => {
      const now = this.dependencies.now();
      if (existingVerifier) {
        const session = this.read(existingVerifier, now);
        if (session) return { status: 'ready', session };
      }

      const windowStart = Math.floor(now / 60_000) * 60_000;
      const budget = this.storage.sql.exec<{ window_start: number; count: number }>(
        'SELECT window_start, count FROM session_issuance_budget WHERE singleton = 1',
      ).toArray()[0];
      const count = budget?.window_start === windowStart ? budget.count : 0;
      if (count >= SESSION_ISSUANCE_PER_MINUTE) return { status: 'rejected', reason: 'rate-limited' };

      const active = this.storage.sql.exec<{ count: number }>(
        'SELECT COUNT(*) AS count FROM browser_sessions WHERE expires_at > ?', now,
      ).one().count;
      if (active >= SESSION_CAPACITY) return { status: 'rejected', reason: 'temporarily-unavailable' };
      const collision = this.storage.sql.exec('SELECT 1 FROM browser_sessions WHERE verifier = ?', newVerifier).toArray();
      if (collision.length) return { status: 'rejected', reason: 'temporarily-unavailable' };

      const session = {
        sessionId: this.dependencies.sessionId(), issuedAt: now, expiresAt: now + SESSION_LIFETIME_MS,
      };
      // Bounded cleanup affects expired private identities only, never room seats.
      this.storage.sql.exec(`DELETE FROM browser_sessions WHERE verifier IN (
        SELECT verifier FROM browser_sessions WHERE expires_at <= ? LIMIT 256
      )`, now);
      this.storage.sql.exec(`INSERT INTO browser_sessions
        (verifier, session_id, issued_at, expires_at, revoked_at) VALUES (?, ?, ?, ?, NULL)`,
      newVerifier, session.sessionId, session.issuedAt, session.expiresAt);
      this.storage.sql.exec(`INSERT INTO session_issuance_budget (singleton, window_start, count)
        VALUES (1, ?, ?) ON CONFLICT(singleton) DO UPDATE SET
        window_start = excluded.window_start, count = excluded.count`, windowStart, count + 1);
      return { status: 'ready', session, credential: newCredential };
    });
  }
}

export type SessionCookieResult =
  | { readonly ambiguous: true }
  | { readonly ambiguous: false; readonly credential: string | null };

/** Never select an arbitrary first/last credential from duplicate cookie fields. */
export function readSessionCookie(header: string | null): SessionCookieResult {
  if (header === null || header === '') return { ambiguous: false, credential: null };
  if (header.length > 8192 || header.includes(',')) return { ambiguous: true };
  let found = false;
  let credential: string | null = null;
  for (const part of header.split(';')) {
    const field = part.trim();
    const separator = field.indexOf('=');
    const name = separator < 0 ? field : field.slice(0, separator).trim();
    if (name !== SESSION_COOKIE) continue;
    if (found) return { ambiguous: true };
    found = true;
    const value = separator < 0 ? '' : field.slice(separator + 1);
    credential = isSessionCredential(value) ? value : null;
  }
  return { ambiguous: false, credential };
}

export function sessionCookie(credential: string): string {
  return `${SESSION_COOKIE}=${credential}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=86400`;
}
