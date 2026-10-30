'use strict';

const Database = require('better-sqlite3');
const { MIGRATIONS } = require('./schema');

const columnCache = new WeakMap();

function openDatabase(file) {
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  migrate(db);
  return db;
}

function migrate(db) {
  const current = db.pragma('user_version', { simple: true });
  for (let version = current; version < MIGRATIONS.length; version += 1) {
    db.transaction(() => {
      db.exec(MIGRATIONS[version]);
      db.pragma(`user_version = ${version + 1}`);
    })();
  }
}

function columnsOf(db, table) {
  let tables = columnCache.get(db);
  if (!tables) {
    tables = new Map();
    columnCache.set(db, tables);
  }
  if (!tables.has(table)) {
    const columns = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
    if (columns.length === 0) throw new Error(`Unknown table: ${table}`);
    tables.set(table, columns);
  }
  return tables.get(table);
}

function toSql(value) {
  if (value === undefined) return null;
  if (typeof value === 'boolean') return value ? 1 : 0;
  return value;
}

/**
 * Inserts or replaces a row. Only columns that exist on the table are written,
 * so records from a newer server schema cannot break an older desktop.
 * `dirty` controls whether the row must be pushed to the server on next sync.
 */
function writeRow(db, table, row, { dirty = true } = {}) {
  const allowed = columnsOf(db, table);
  const columns = Object.keys(row).filter((c) => allowed.includes(c) && c !== 'dirty');
  const params = { __dirty: dirty ? 1 : 0 };
  for (const column of columns) params[column] = toSql(row[column]);

  const names = columns.join(', ');
  const values = columns.map((c) => `@${c}`).join(', ');
  const updates = columns.filter((c) => c !== 'id').map((c) => `${c} = excluded.${c}`);
  updates.push('dirty = excluded.dirty');

  db.prepare(
    `INSERT INTO ${table} (${names}, dirty) VALUES (${values}, @__dirty)
     ON CONFLICT (id) DO UPDATE SET ${updates.join(', ')}`,
  ).run(params);
}

function getRow(db, table, id) {
  if (!id) return null;
  return db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id) ?? null;
}

module.exports = { openDatabase, writeRow, getRow, columnsOf };
