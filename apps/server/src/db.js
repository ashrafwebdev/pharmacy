'use strict';

const Database = require('better-sqlite3');

/**
 * Opens the server database. Every synced row is stored as a JSON document in
 * `records`, keyed by branch, table and id, so the server does not need to know
 * the desktop schema. `seq` is a global, increasing cursor used by pull.
 */
function openDatabase(file) {
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS records (
      branch_id  TEXT    NOT NULL,
      table_name TEXT    NOT NULL,
      id         TEXT    NOT NULL,
      seq        INTEGER NOT NULL,
      updated_at TEXT    NOT NULL,
      deleted    INTEGER NOT NULL DEFAULT 0,
      device_id  TEXT,
      data       TEXT    NOT NULL,
      PRIMARY KEY (branch_id, table_name, id)
    );
    CREATE INDEX IF NOT EXISTS records_branch_seq ON records (branch_id, seq);
    CREATE TABLE IF NOT EXISTS meta (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
  return db;
}

module.exports = { openDatabase };
