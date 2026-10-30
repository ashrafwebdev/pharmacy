'use strict';

const { timingSafeEqual } = require('node:crypto');
const express = require('express');

const SYNC_TABLES = new Set([
  'suppliers',
  'customers',
  'products',
  'batches',
  'stock_movements',
  'sales',
  'sale_items',
]);
const MAX_PUSH_RECORDS = 500;
const MAX_PULL_RECORDS = 1000;
const DEFAULT_SUMMARY_DAYS = 30;

/** Parses "branch-a:secret1,branch-b:secret2" into a Map of secret -> branch id. */
function parseBranchKeys(spec) {
  const keys = new Map();
  for (const entry of String(spec ?? '').split(',').map((s) => s.trim()).filter(Boolean)) {
    const separator = entry.indexOf(':');
    if (separator < 1 || separator === entry.length - 1) {
      throw new Error('BRANCH_KEYS must look like "branch-id:secret,other-branch:secret"');
    }
    keys.set(entry.slice(separator + 1), entry.slice(0, separator));
  }
  return keys;
}

function sameSecret(a, b) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

function branchFor(keys, token) {
  if (!token) return null;
  let branch = null;
  for (const [secret, branchId] of keys) {
    if (sameSecret(secret, token)) branch = branchId;
  }
  return branch;
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isValidRecord(record) {
  return (
    isObject(record) &&
    SYNC_TABLES.has(record.table) &&
    typeof record.id === 'string' &&
    record.id.length > 0 &&
    typeof record.updated_at === 'string' &&
    isObject(record.data)
  );
}

function createApp({ db, keys }) {
  const app = express();
  app.use(express.json({ limit: '5mb' }));

  const readSeq = db.prepare("SELECT value FROM meta WHERE key = 'seq'");
  const writeSeq = db.prepare(
    "INSERT INTO meta (key, value) VALUES ('seq', @value) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  );
  const findRecord = db.prepare(
    'SELECT updated_at FROM records WHERE branch_id = ? AND table_name = ? AND id = ?',
  );
  const saveRecord = db.prepare(`
    INSERT INTO records (branch_id, table_name, id, seq, updated_at, deleted, device_id, data)
    VALUES (@branchId, @tableName, @id, @seq, @updatedAt, @deleted, @deviceId, @data)
    ON CONFLICT (branch_id, table_name, id) DO UPDATE SET
      seq = excluded.seq,
      updated_at = excluded.updated_at,
      deleted = excluded.deleted,
      device_id = excluded.device_id,
      data = excluded.data
  `);
  const pageAfter = db.prepare(`
    SELECT seq, table_name, id, updated_at, deleted, device_id, data
    FROM records WHERE branch_id = ? AND seq > ? ORDER BY seq LIMIT ?
  `);
  const summary = db.prepare(`
    SELECT COUNT(*) AS sales, COALESCE(SUM(json_extract(data, '$.total')), 0) AS revenue
    FROM records
    WHERE branch_id = @branchId AND table_name = 'sales' AND deleted = 0
      AND json_extract(data, '$.status') = 'completed'
      AND json_extract(data, '$.created_at') >= @from
      AND json_extract(data, '$.created_at') < @to
  `);

  function nextSeq() {
    const next = Number(readSeq.get()?.value ?? 0) + 1;
    writeSeq.run({ value: String(next) });
    return next;
  }

  const pushRecords = db.transaction((branchId, deviceId, records) =>
    records.map((record) => {
      const existing = findRecord.get(branchId, record.table, record.id);
      // Last write wins: an older update never replaces a newer stored version.
      if (!existing || record.updated_at >= existing.updated_at) {
        saveRecord.run({
          branchId,
          tableName: record.table,
          id: record.id,
          seq: nextSeq(),
          updatedAt: record.updated_at,
          deleted: record.deleted ? 1 : 0,
          deviceId,
          data: JSON.stringify(record.data),
        });
      }
      return { table: record.table, id: record.id, updated_at: record.updated_at };
    }),
  );

  const requireApiKey = (req, res, next) => {
    const header = req.get('authorization') ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    const branchId = branchFor(keys, token);
    if (!branchId) {
      res.status(401).json({ error: 'Invalid or missing API key' });
      return;
    }
    req.branchId = branchId;
    next();
  };

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, time: new Date().toISOString() });
  });

  app.post('/api/sync/push', requireApiKey, (req, res) => {
    const { deviceId, records } = req.body ?? {};
    if (typeof deviceId !== 'string' || !deviceId || !Array.isArray(records)) {
      res.status(400).json({ error: 'deviceId and records[] are required' });
      return;
    }
    if (records.length > MAX_PUSH_RECORDS) {
      res.status(413).json({ error: `At most ${MAX_PUSH_RECORDS} records per push` });
      return;
    }
    if (!records.every(isValidRecord)) {
      res.status(400).json({ error: 'A record is missing table, id, updated_at or data' });
      return;
    }
    const accepted = pushRecords(req.branchId, deviceId, records);
    res.json({ accepted });
  });

  app.get('/api/sync/pull', requireApiKey, (req, res) => {
    const since = Number(req.query.since ?? 0);
    const limit = Math.min(Number(req.query.limit ?? 500), MAX_PULL_RECORDS);
    if (!Number.isInteger(since) || since < 0 || !Number.isInteger(limit) || limit < 1) {
      res.status(400).json({ error: 'since must be >= 0 and limit must be >= 1' });
      return;
    }
    const rows = pageAfter.all(req.branchId, since, limit + 1);
    const page = rows.slice(0, limit);
    res.json({
      records: page.map((row) => ({
        seq: row.seq,
        table: row.table_name,
        id: row.id,
        updated_at: row.updated_at,
        deleted: row.deleted === 1,
        device_id: row.device_id,
        data: JSON.parse(row.data),
      })),
      cursor: page.length ? page[page.length - 1].seq : since,
      hasMore: rows.length > limit,
    });
  });

  // Central reporting: completed sales for this branch within a time window.
  app.get('/api/summary', requireApiKey, (req, res) => {
    const to = new Date(req.query.to ?? Date.now());
    const from = new Date(req.query.from ?? to.getTime() - DEFAULT_SUMMARY_DAYS * 86_400_000);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      res.status(400).json({ error: 'from and to must be valid dates' });
      return;
    }
    const totals = summary.get({
      branchId: req.branchId,
      from: from.toISOString(),
      to: to.toISOString(),
    });
    res.json({
      branchId: req.branchId,
      from: from.toISOString(),
      to: to.toISOString(),
      sales: totals.sales,
      revenue: totals.revenue,
    });
  });

  app.use((err, _req, res, _next) => {
    const status = err.status ?? 500;
    if (status >= 500) console.error(err);
    res.status(status).json({ error: status >= 500 ? 'Server error' : err.message });
  });

  return app;
}

module.exports = { createApp, parseBranchKeys, SYNC_TABLES };
