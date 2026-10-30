'use strict';

const { writeRow } = require('../lib/db');
const { nowIso } = require('../lib/util');
const { getSetting, setSetting, getDeviceId } = require('./settings');

/** Tables replicated to the server, in dependency order (parents before children). */
const SYNC_TABLES = [
  'suppliers',
  'customers',
  'products',
  'batches',
  'stock_movements',
  'sales',
  'sale_items',
];
const PAGE_SIZE = 500;
const REQUEST_TIMEOUT_MS = 20_000;

class SyncError extends Error {
  constructor(kind, message) {
    super(message);
    this.kind = kind;
  }
}

/** Used when no OS-level secret store is available (tests, non-Windows dev machines). */
const plainSecrets = {
  encrypt: (text) => `plain:${text}`,
  decrypt: (value) => value.slice('plain:'.length),
};

function toRecord(table, row) {
  const { dirty, ...data } = row;
  return { table, id: row.id, updated_at: row.updated_at, deleted: row.deleted === 1, data };
}

/**
 * Offline-first sync. Local writes never wait for the network.
 *  - Push: sends rows with dirty = 1; the server answers with what it accepted.
 *  - Pull: fetches server changes after our cursor and applies them with last-write-wins.
 */
function createSyncService({
  db,
  fetchImpl = globalThis.fetch,
  secrets = plainSecrets,
  now = nowIso,
}) {
  let running = null;
  let lastError = null;
  const markClean = Object.fromEntries(
    SYNC_TABLES.map((table) => [
      table,
      db.prepare(`UPDATE ${table} SET dirty = 0 WHERE id = ? AND updated_at = ?`),
    ]),
  );

  function getConfig() {
    return {
      url: getSetting(db, 'sync_url', ''),
      deviceName: getSetting(db, 'device_name', ''),
      enabled: getSetting(db, 'sync_enabled', '0') === '1',
      hasApiKey: Boolean(getSetting(db, 'sync_api_key')),
      deviceId: getDeviceId(db),
    };
  }

  function isConfigured() {
    const config = getConfig();
    return config.enabled && Boolean(config.url) && config.hasApiKey;
  }

  function readApiKey() {
    const stored = getSetting(db, 'sync_api_key');
    return stored ? secrets.decrypt(stored) : '';
  }

  function configure({ url, apiKey, deviceName, enabled }) {
    const trimmed = String(url ?? '').trim().replace(/\/+$/, '');
    if (trimmed && !/^https?:\/\/[^\s]+$/i.test(trimmed)) {
      throw new Error('Server address must start with http:// or https://');
    }
    if (enabled && !trimmed) throw new Error('Enter the server address before enabling sync');
    setSetting(db, 'sync_url', trimmed);
    setSetting(db, 'device_name', String(deviceName ?? '').trim().slice(0, 60));
    setSetting(db, 'sync_enabled', enabled ? '1' : '0');
    if (apiKey && String(apiKey).trim()) {
      setSetting(db, 'sync_api_key', secrets.encrypt(String(apiKey).trim()));
    }
    if (enabled && !getSetting(db, 'sync_api_key')) throw new Error('Enter the branch API key');
    return getConfig();
  }

  function pendingCount() {
    return SYNC_TABLES.reduce(
      (sum, table) => sum + db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE dirty = 1`).get().n,
      0,
    );
  }

  function status() {
    return {
      configured: isConfigured(),
      running: running !== null,
      pending: pendingCount(),
      lastSyncAt: getSetting(db, 'last_sync_at', null),
      lastError,
      ...getConfig(),
    };
  }

  async function request(path, { method = 'GET', body } = {}) {
    const url = getSetting(db, 'sync_url', '');
    let response;
    try {
      response = await fetchImpl(url + path, {
        method,
        headers: {
          authorization: `Bearer ${readApiKey()}`,
          'content-type': 'application/json',
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      throw new SyncError('offline', `Cannot reach the sync server (${err.message})`);
    }
    if (response.status === 401) throw new SyncError('auth', 'The branch API key was rejected');
    if (!response.ok) throw new SyncError('server', `Sync server returned HTTP ${response.status}`);
    return response.json();
  }

  async function pushPending() {
    const deviceId = getDeviceId(db);
    let pushed = 0;
    for (;;) {
      const records = [];
      for (const table of SYNC_TABLES) {
        const rows = db
          .prepare(`SELECT * FROM ${table} WHERE dirty = 1 ORDER BY updated_at LIMIT ?`)
          .all(PAGE_SIZE - records.length);
        for (const row of rows) records.push(toRecord(table, row));
        if (records.length >= PAGE_SIZE) break;
      }
      if (records.length === 0) return pushed;

      const { accepted } = await request('/api/sync/push', {
        method: 'POST',
        body: { deviceId, records },
      });
      if (!Array.isArray(accepted) || accepted.length !== records.length) {
        throw new SyncError('server', 'Sync server did not accept every record');
      }
      db.transaction(() => {
        for (const item of accepted) markClean[item.table].run(item.id, item.updated_at);
      })();
      pushed += records.length;
    }
  }

  function applyRecord(record) {
    if (!SYNC_TABLES.includes(record.table) || typeof record.id !== 'string') return false;
    const local = db.prepare(`SELECT updated_at FROM ${record.table} WHERE id = ?`).get(record.id);
    // Local version is newer: keep it. It will be pushed on the next cycle.
    if (local && local.updated_at > record.updated_at) return false;
    writeRow(
      db,
      record.table,
      { ...record.data, id: record.id, deleted: record.deleted ? 1 : 0 },
      { dirty: false },
    );
    return true;
  }

  async function pullChanges() {
    let applied = 0;
    for (;;) {
      const since = Number(getSetting(db, 'sync_cursor', '0'));
      const page = await request(`/api/sync/pull?since=${since}&limit=${PAGE_SIZE}`);
      db.transaction(() => {
        for (const record of page.records) {
          if (applyRecord(record)) applied += 1;
        }
        setSetting(db, 'sync_cursor', page.cursor);
      })();
      if (!page.hasMore) return applied;
    }
  }

  /** Runs one push-then-pull cycle. Concurrent calls share the same run. */
  function syncNow() {
    if (running) return running;
    if (!isConfigured()) return Promise.resolve({ ok: false, skipped: true, error: 'Sync is not configured' });
    running = (async () => {
      try {
        const pushed = await pushPending();
        const pulled = await pullChanges();
        setSetting(db, 'last_sync_at', now());
        lastError = null;
        return { ok: true, pushed, pulled };
      } catch (err) {
        lastError = err.message;
        return { ok: false, kind: err.kind ?? 'error', error: err.message };
      } finally {
        running = null;
      }
    })();
    return running;
  }

  return { configure, getConfig, status, syncNow, isConfigured, pendingCount };
}

module.exports = { createSyncService, SYNC_TABLES, plainSecrets };
