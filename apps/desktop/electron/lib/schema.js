'use strict';

/**
 * Ordered schema migrations. Append new entries once a version has shipped; until
 * then the first migration is edited in place.
 *
 * Sync rules that shape this schema:
 *  - Every business table has `updated_at`, `deleted` (soft delete) and `dirty`
 *    (1 = not yet pushed to the server).
 *  - Stock is an append-only ledger (`stock_movements`), never a mutable counter,
 *    so two offline devices selling the same batch cannot overwrite each other.
 *  - No foreign-key constraints: synced rows can arrive in any order.
 *
 * India-specific fields:
 *  - Money is stored in paise (integers). MRP is GST-inclusive.
 *  - Every product has an HSN code, a GST rate and a drug schedule (OTC, H, H1, X).
 *  - Every sale line stores its GST split so GST returns can be produced from the ledger.
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
    gstin      TEXT,
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
    gstin      TEXT,
    notes      TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted    INTEGER NOT NULL DEFAULT 0,
    dirty      INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE products (
    id            TEXT PRIMARY KEY,
    sku           TEXT,
    name          TEXT NOT NULL,
    generic_name  TEXT,
    category      TEXT,
    manufacturer  TEXT,
    hsn_code      TEXT,
    gst_rate      INTEGER NOT NULL DEFAULT 12,
    schedule      TEXT NOT NULL DEFAULT 'OTC' CHECK (schedule IN ('OTC', 'H', 'H1', 'X')),
    mrp           INTEGER NOT NULL,
    reorder_level INTEGER NOT NULL DEFAULT 0,
    created_at    TEXT NOT NULL,
    updated_at    TEXT NOT NULL,
    deleted       INTEGER NOT NULL DEFAULT 0,
    dirty         INTEGER NOT NULL DEFAULT 1
  );
  CREATE INDEX products_sku ON products (sku);

  CREATE TABLE batches (
    id             TEXT PRIMARY KEY,
    product_id     TEXT NOT NULL,
    supplier_id    TEXT,
    batch_no       TEXT NOT NULL,
    expiry_date    TEXT NOT NULL,
    mrp            INTEGER NOT NULL,
    purchase_price INTEGER NOT NULL DEFAULT 0,
    created_at     TEXT NOT NULL,
    updated_at     TEXT NOT NULL,
    deleted        INTEGER NOT NULL DEFAULT 0,
    dirty          INTEGER NOT NULL DEFAULT 1
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
    id                  TEXT PRIMARY KEY,
    invoice_no          TEXT NOT NULL,
    invoice_fy          TEXT NOT NULL,
    bill_type           TEXT NOT NULL DEFAULT 'tax_invoice' CHECK (bill_type IN ('tax_invoice', 'bill_of_supply')),
    device_id           TEXT NOT NULL,
    customer_id         TEXT,
    cashier_name        TEXT NOT NULL,
    subtotal            INTEGER NOT NULL,
    discount            INTEGER NOT NULL DEFAULT 0,
    round_off           INTEGER NOT NULL DEFAULT 0,
    total               INTEGER NOT NULL,
    taxable_value       INTEGER NOT NULL,
    cgst                INTEGER NOT NULL,
    sgst                INTEGER NOT NULL,
    payment_method      TEXT NOT NULL CHECK (payment_method IN ('cash', 'upi', 'card', 'credit')),
    amount_paid         INTEGER NOT NULL,
    change_given        INTEGER NOT NULL DEFAULT 0,
    rx_doctor_name      TEXT,
    rx_doctor_reg_no    TEXT,
    rx_prescription_no  TEXT,
    rx_prescription_date TEXT,
    rx_patient_name     TEXT,
    rx_patient_address  TEXT,
    status              TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('completed', 'voided')),
    void_reason         TEXT,
    created_at          TEXT NOT NULL,
    updated_at          TEXT NOT NULL,
    deleted             INTEGER NOT NULL DEFAULT 0,
    dirty               INTEGER NOT NULL DEFAULT 1
  );
  CREATE INDEX sales_created ON sales (created_at);
  CREATE INDEX sales_counter ON sales (device_id, invoice_fy);

  CREATE TABLE sale_items (
    id             TEXT PRIMARY KEY,
    sale_id        TEXT NOT NULL,
    product_id     TEXT NOT NULL,
    batch_id       TEXT NOT NULL,
    product_name   TEXT NOT NULL,
    hsn_code       TEXT,
    schedule       TEXT NOT NULL,
    gst_rate       INTEGER NOT NULL,
    qty            INTEGER NOT NULL,
    mrp            INTEGER NOT NULL,
    gross_amount   INTEGER NOT NULL,
    discount_share INTEGER NOT NULL DEFAULT 0,
    line_total     INTEGER NOT NULL,
    taxable_value  INTEGER NOT NULL,
    cgst           INTEGER NOT NULL,
    sgst           INTEGER NOT NULL,
    created_at     TEXT NOT NULL,
    updated_at     TEXT NOT NULL,
    deleted        INTEGER NOT NULL DEFAULT 0,
    dirty          INTEGER NOT NULL DEFAULT 1
  );
  CREATE INDEX sale_items_sale ON sale_items (sale_id);
  `,
];

module.exports = { MIGRATIONS };
