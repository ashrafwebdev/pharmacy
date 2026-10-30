'use strict';

/**
 * Ordered schema migrations. Append new entries; never edit a shipped one.
 *
 * Sync rules that shape this schema:
 *  - Every business table has `updated_at`, `deleted` (soft delete) and `dirty`
 *    (1 = not yet pushed to the server).
 *  - Stock is an append-only ledger (`stock_movements`), never a mutable counter,
 *    so two offline devices selling the same batch cannot overwrite each other.
 *  - No foreign-key constraints: synced rows can arrive in any order.
 */
const MIGRATIONS = [
  `
  CREATE TABLE users (
    id            TEXT PRIMARY KEY,
    username      TEXT NOT NULL UNIQUE,
    name          TEXT NOT NULL,
    role          TEXT NOT NULL CHECK (role IN ('admin', 'pharmacist', 'cashier')),
    password_hash TEXT NOT NULL,
    active        INTEGER NOT NULL DEFAULT 1,
    created_at    TEXT NOT NULL
  );

  CREATE TABLE settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE suppliers (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    phone      TEXT,
    email      TEXT,
    address    TEXT,
    notes      TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted    INTEGER NOT NULL DEFAULT 0,
    dirty      INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE customers (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    phone      TEXT,
    email      TEXT,
    address    TEXT,
    notes      TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted    INTEGER NOT NULL DEFAULT 0,
    dirty      INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE products (
    id                    TEXT PRIMARY KEY,
    sku                   TEXT,
    name                  TEXT NOT NULL,
    generic_name          TEXT,
    category              TEXT,
    manufacturer          TEXT,
    unit_price            INTEGER NOT NULL DEFAULT 0,
    cost_price            INTEGER NOT NULL DEFAULT 0,
    reorder_level         INTEGER NOT NULL DEFAULT 0,
    requires_prescription INTEGER NOT NULL DEFAULT 0,
    created_at            TEXT NOT NULL,
    updated_at            TEXT NOT NULL,
    deleted               INTEGER NOT NULL DEFAULT 0,
    dirty                 INTEGER NOT NULL DEFAULT 1
  );
  CREATE INDEX products_sku ON products (sku);

  CREATE TABLE batches (
    id          TEXT PRIMARY KEY,
    product_id  TEXT NOT NULL,
    supplier_id TEXT,
    batch_no    TEXT NOT NULL,
    expiry_date TEXT NOT NULL,
    cost_price  INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL,
    deleted     INTEGER NOT NULL DEFAULT 0,
    dirty       INTEGER NOT NULL DEFAULT 1
  );
  CREATE INDEX batches_product ON batches (product_id, expiry_date);

  CREATE TABLE stock_movements (
    id         TEXT PRIMARY KEY,
    batch_id   TEXT NOT NULL,
    product_id TEXT NOT NULL,
    qty        INTEGER NOT NULL,
    type       TEXT NOT NULL CHECK (type IN ('receive', 'sale', 'void', 'adjust', 'expired')),
    ref_id     TEXT,
    note       TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted    INTEGER NOT NULL DEFAULT 0,
    dirty      INTEGER NOT NULL DEFAULT 1
  );
  CREATE INDEX movements_batch ON stock_movements (batch_id);
  CREATE INDEX movements_product ON stock_movements (product_id);

  CREATE TABLE sales (
    id                    TEXT PRIMARY KEY,
    invoice_no            TEXT NOT NULL,
    device_id             TEXT NOT NULL,
    customer_id          TEXT,
    cashier_name          TEXT NOT NULL,
    subtotal              INTEGER NOT NULL,
    discount              INTEGER NOT NULL DEFAULT 0,
    total                 INTEGER NOT NULL,
    payment_method        TEXT NOT NULL,
    amount_paid           INTEGER NOT NULL,
    change_given          INTEGER NOT NULL DEFAULT 0,
    prescription_verified INTEGER NOT NULL DEFAULT 0,
    status                TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('completed', 'voided')),
    void_reason           TEXT,
    created_at            TEXT NOT NULL,
    updated_at            TEXT NOT NULL,
    deleted               INTEGER NOT NULL DEFAULT 0,
    dirty                 INTEGER NOT NULL DEFAULT 1
  );
  CREATE INDEX sales_created ON sales (created_at);

  CREATE TABLE sale_items (
    id           TEXT PRIMARY KEY,
    sale_id      TEXT NOT NULL,
    product_id   TEXT NOT NULL,
    batch_id     TEXT NOT NULL,
    product_name TEXT NOT NULL,
    qty          INTEGER NOT NULL,
    unit_price   INTEGER NOT NULL,
    line_total   INTEGER NOT NULL,
    created_at   TEXT NOT NULL,
    updated_at   TEXT NOT NULL,
    deleted      INTEGER NOT NULL DEFAULT 0,
    dirty        INTEGER NOT NULL DEFAULT 1
  );
  CREATE INDEX sale_items_sale ON sale_items (sale_id);
  `,
];

module.exports = { MIGRATIONS };
