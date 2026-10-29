const SCHEMA_VERSION = 1;

/** Only schema metadata exists at T14.1. Session and room data come later. */
export function initializeStorage(storage: DurableObjectStorage): void {
  storage.transactionSync(() => {
    storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS app_metadata (
        key TEXT PRIMARY KEY,
        value INTEGER NOT NULL
      )
    `);
    const stored = getSchemaVersion(storage);
    if (stored !== null && stored !== SCHEMA_VERSION) {
      throw new Error('Unsupported persisted schema version');
    }
    if (stored === null) {
      storage.sql.exec(
        'INSERT INTO app_metadata (key, value) VALUES (?, ?)',
        'schema_version', SCHEMA_VERSION,
      );
    }
  });
}

export function getSchemaVersion(storage: DurableObjectStorage): number | null {
  const rows = storage.sql.exec<{ value: number }>(
    'SELECT value FROM app_metadata WHERE key = ?', 'schema_version',
  ).toArray();
  return rows[0]?.value ?? null;
}
