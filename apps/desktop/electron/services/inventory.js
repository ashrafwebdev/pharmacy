'use strict';

const { writeRow, getRow } = require('../lib/db');
const { newId, nowIso, localDate, isDate, isInt, cleanText } = require('../lib/util');
const { getSetting } = require('./settings');
const { STOCK_CTE } = require('./products');

const BATCH_STOCK_CTE = `
  WITH stock AS (
    SELECT batch_id, SUM(qty) AS on_hand
    FROM stock_movements WHERE deleted = 0 GROUP BY batch_id
  )`;

/** expired | expiring (within the warning window) | ok, relative to a local date. */
function batchStatus(expiryDate, today, warningDays) {
  if (expiryDate < today) return 'expired';
  const warnUntil = new Date(`${today}T00:00:00`);
  warnUntil.setDate(warnUntil.getDate() + warningDays);
  return expiryDate <= localDate(warnUntil) ? 'expiring' : 'ok';
}

function addMovement(db, { batchId, productId, qty, type, refId = null, note = null }) {
  const now = nowIso();
  writeRow(db, 'stock_movements', {
    id: newId(),
    batch_id: batchId,
    product_id: productId,
    qty,
    type,
    ref_id: refId,
    note,
    created_at: now,
    updated_at: now,
    deleted: 0,
  });
}

function warningDays(db) {
  return Number(getSetting(db, 'expiry_warning_days', '90'));
}

function mapBatch(row, today, days) {
  return {
    id: row.id,
    productId: row.product_id,
    productName: row.product_name,
    productSku: row.product_sku,
    supplierId: row.supplier_id,
    supplierName: row.supplier_name,
    batchNo: row.batch_no,
    expiryDate: row.expiry_date,
    mrp: row.mrp,
    purchasePrice: row.purchase_price,
    onHand: row.on_hand,
    status: batchStatus(row.expiry_date, today, days),
  };
}

function getBatch(db, id) {
  const row = db.prepare(`
    ${BATCH_STOCK_CTE}
    SELECT b.*, p.name AS product_name, p.sku AS product_sku, s.name AS supplier_name,
      COALESCE(stock.on_hand, 0) AS on_hand
    FROM batches b
    JOIN products p ON p.id = b.product_id
    LEFT JOIN suppliers s ON s.id = b.supplier_id
    LEFT JOIN stock ON stock.batch_id = b.id
    WHERE b.id = ?
  `).get(id);
  return row ? mapBatch(row, localDate(), warningDays(db)) : null;
}

function listBatches(db, { productId = null, inStockOnly = false } = {}) {
  const today = localDate();
  const days = warningDays(db);
  return db.prepare(`
    ${BATCH_STOCK_CTE}
    SELECT b.*, p.name AS product_name, p.sku AS product_sku, s.name AS supplier_name,
      COALESCE(stock.on_hand, 0) AS on_hand
    FROM batches b
    JOIN products p ON p.id = b.product_id
    LEFT JOIN suppliers s ON s.id = b.supplier_id
    LEFT JOIN stock ON stock.batch_id = b.id
    WHERE b.deleted = 0
      AND (@productId IS NULL OR b.product_id = @productId)
      AND (@inStockOnly = 0 OR COALESCE(stock.on_hand, 0) > 0)
    ORDER BY b.expiry_date, p.name
    LIMIT 500
  `).all({ productId, inStockOnly: inStockOnly ? 1 : 0 })
    .map((row) => mapBatch(row, today, days));
}

/**
 * Receives a purchase into a new batch. MRP is printed on the pack and can differ
 * between batches; a sale is always billed at the batch MRP, never above it.
 */
function receiveStock(db, input) {
  return db.transaction(() => {
    const product = getRow(db, 'products', input.productId);
    if (!product || product.deleted) throw new Error('Choose a valid product');
    const batchNo = cleanText(input.batchNo);
    if (!batchNo) throw new Error('Batch number is required');
    if (!isDate(input.expiryDate)) throw new Error('Enter a valid expiry date');
    if (input.expiryDate < localDate()) throw new Error('This batch has already expired');
    if (!isInt(input.qty) || input.qty < 1) throw new Error('Quantity must be a whole number above 0');

    const mrp = input.mrp ?? product.mrp;
    const purchasePrice = input.purchasePrice ?? 0;
    if (!isInt(mrp) || mrp <= 0) throw new Error('MRP must be a valid amount above zero');
    if (!isInt(purchasePrice) || purchasePrice < 0) throw new Error('Purchase price must be a valid amount');
    if (purchasePrice > mrp) throw new Error('Purchase price cannot be higher than the MRP');

    let supplierId = null;
    if (input.supplierId) {
      const supplier = getRow(db, 'suppliers', input.supplierId);
      if (!supplier || supplier.deleted) throw new Error('Choose a valid supplier');
      supplierId = supplier.id;
    }

    const id = newId();
    const now = nowIso();
    writeRow(db, 'batches', {
      id,
      product_id: product.id,
      supplier_id: supplierId,
      batch_no: batchNo,
      expiry_date: input.expiryDate,
      mrp,
      purchase_price: purchasePrice,
      created_at: now,
      updated_at: now,
      deleted: 0,
    });
    addMovement(db, {
      batchId: id,
      productId: product.id,
      qty: input.qty,
      type: 'receive',
      note: `Received batch ${batchNo}`,
    });
    return getBatch(db, id);
  })();
}

function adjustStock(db, { batchId, qty, reason }) {
  return db.transaction(() => {
    const batch = getBatch(db, batchId);
    if (!batch) throw new Error('Batch not found');
    if (!isInt(qty) || qty === 0) throw new Error('Adjustment must be a non-zero whole number');
    const note = cleanText(reason);
    if (note.length < 3) throw new Error('Give a reason for the adjustment');
    if (batch.onHand + qty < 0) throw new Error(`Cannot remove more than the ${batch.onHand} on hand`);
    addMovement(db, { batchId, productId: batch.productId, qty, type: 'adjust', note });
    return getBatch(db, batchId);
  })();
}

function writeOffExpired(db, batchId) {
  return db.transaction(() => {
    const batch = getBatch(db, batchId);
    if (!batch) throw new Error('Batch not found');
    if (batch.status !== 'expired') throw new Error('Only expired batches can be written off');
    if (batch.onHand <= 0) throw new Error('Nothing left to write off in this batch');
    addMovement(db, {
      batchId,
      productId: batch.productId,
      qty: -batch.onHand,
      type: 'expired',
      note: `Written off expired batch ${batch.batchNo}`,
    });
    return getBatch(db, batchId);
  })();
}

/**
 * First-expired-first-out allocation for a sale. Expired batches are never sold.
 * Returns [{ batch: { id, batchNo, expiryDate, mrp }, qty }] or throws when in-date
 * stock is insufficient.
 */
function allocateFifo(db, productId, qty, productName = 'this product') {
  const rows = db.prepare(`
    ${BATCH_STOCK_CTE}
    SELECT b.id, b.batch_no, b.expiry_date, b.mrp, COALESCE(stock.on_hand, 0) AS on_hand
    FROM batches b
    LEFT JOIN stock ON stock.batch_id = b.id
    WHERE b.product_id = ? AND b.deleted = 0 AND b.expiry_date >= ?
      AND COALESCE(stock.on_hand, 0) > 0
    ORDER BY b.expiry_date, b.created_at
  `).all(productId, localDate());

  let remaining = qty;
  const allocations = [];
  for (const row of rows) {
    if (remaining === 0) break;
    const take = Math.min(remaining, row.on_hand);
    allocations.push({
      batch: { id: row.id, batchNo: row.batch_no, expiryDate: row.expiry_date, mrp: row.mrp },
      qty: take,
    });
    remaining -= take;
  }
  if (remaining > 0) {
    throw new Error(`Not enough in-date stock for ${productName}: only ${qty - remaining} available`);
  }
  return allocations;
}

function lowStockProducts(db) {
  return db.prepare(`
    ${STOCK_CTE}
    SELECT p.id, p.name, p.sku, p.reorder_level, COALESCE(stock.on_hand, 0) AS on_hand
    FROM products p LEFT JOIN stock ON stock.product_id = p.id
    WHERE p.deleted = 0 AND p.reorder_level > 0 AND COALESCE(stock.on_hand, 0) <= p.reorder_level
    ORDER BY on_hand, p.name
    LIMIT 50
  `).all().map((row) => ({
    id: row.id,
    name: row.name,
    sku: row.sku,
    reorderLevel: row.reorder_level,
    onHand: row.on_hand,
  }));
}

module.exports = {
  addMovement,
  batchStatus,
  getBatch,
  listBatches,
  receiveStock,
  adjustStock,
  writeOffExpired,
  allocateFifo,
  lowStockProducts,
  warningDays,
};
