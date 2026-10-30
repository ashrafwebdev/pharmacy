'use strict';

const { writeRow, getRow } = require('../lib/db');
const { newId, nowIso, isInt, cleanText, dayBounds } = require('../lib/util');
const { allocateFifo, addMovement } = require('./inventory');

const PAYMENT_METHODS = ['cash', 'card', 'mobile'];
const MAX_LINES = 200;
const MAX_QTY = 9999;

function nextInvoiceNo(db, deviceId) {
  const count = db.prepare('SELECT COUNT(*) AS n FROM sales WHERE device_id = ?').get(deviceId).n;
  return `${deviceId.slice(0, 6).toUpperCase()}-${String(count + 1).padStart(6, '0')}`;
}

function mapSale(row, items = []) {
  return {
    id: row.id,
    invoiceNo: row.invoice_no,
    customerId: row.customer_id,
    customerName: row.customer_name ?? null,
    cashierName: row.cashier_name,
    subtotal: row.subtotal,
    discount: row.discount,
    total: row.total,
    paymentMethod: row.payment_method,
    amountPaid: row.amount_paid,
    changeGiven: row.change_given,
    prescriptionVerified: row.prescription_verified === 1,
    status: row.status,
    voidReason: row.void_reason,
    createdAt: row.created_at,
    itemCount: row.item_count ?? items.length,
    items,
  };
}

function getSale(db, id) {
  const row = db.prepare(`
    SELECT s.*, c.name AS customer_name
    FROM sales s LEFT JOIN customers c ON c.id = s.customer_id
    WHERE s.id = ? AND s.deleted = 0
  `).get(id);
  if (!row) return null;
  const items = db.prepare(`
    SELECT * FROM sale_items WHERE sale_id = ? AND deleted = 0 ORDER BY created_at, rowid
  `).all(id).map((item) => ({
    id: item.id,
    productId: item.product_id,
    productName: item.product_name,
    qty: item.qty,
    unitPrice: item.unit_price,
    lineTotal: item.line_total,
  }));
  return mapSale(row, items);
}

function listSales(db, { from, to, limit = 200 } = {}) {
  if (!from || !to) throw new Error('Choose a date range');
  const bounds = dayBounds(from, to);
  return db.prepare(`
    SELECT s.*, c.name AS customer_name,
      (SELECT COUNT(*) FROM sale_items si WHERE si.sale_id = s.id AND si.deleted = 0) AS item_count
    FROM sales s LEFT JOIN customers c ON c.id = s.customer_id
    WHERE s.deleted = 0 AND s.created_at >= @start AND s.created_at < @end
    ORDER BY s.created_at DESC
    LIMIT @limit
  `).all({ ...bounds, limit: Math.min(Number(limit) || 200, 1000) }).map((row) => mapSale(row));
}

function validateCart(items) {
  if (!Array.isArray(items) || items.length === 0) throw new Error('Add at least one item to the sale');
  if (items.length > MAX_LINES) throw new Error(`A sale can have at most ${MAX_LINES} lines`);
  for (const item of items) {
    if (!isInt(item.qty) || item.qty < 1 || item.qty > MAX_QTY) {
      throw new Error(`Quantities must be whole numbers from 1 to ${MAX_QTY}`);
    }
  }
}

/**
 * Completes a sale atomically: prices come from the product catalogue (never from
 * the client), stock is allocated first-expired-first-out, and every unit sold
 * becomes a negative stock movement.
 */
function createSale(db, input, session) {
  const items = input.items;
  validateCart(items);
  const paymentMethod = input.paymentMethod ?? 'cash';
  if (!PAYMENT_METHODS.includes(paymentMethod)) throw new Error('Choose a valid payment method');

  return db.transaction(() => {
    const lines = items.map((item) => {
      const product = getRow(db, 'products', item.productId);
      if (!product || product.deleted) throw new Error('A product in the cart no longer exists');
      return { product, qty: item.qty };
    });

    const needsPrescription = lines.some((line) => line.product.requires_prescription === 1);
    if (needsPrescription && input.prescriptionVerified !== true) {
      throw new Error('Verify the prescription before selling prescription-only items');
    }

    const subtotal = lines.reduce((sum, line) => sum + line.product.unit_price * line.qty, 0);
    const discount = input.discount ?? 0;
    if (!isInt(discount) || discount < 0 || discount > subtotal) {
      throw new Error('Discount must be between 0 and the subtotal');
    }
    const total = subtotal - discount;
    const paid = paymentMethod === 'cash' ? (input.amountPaid ?? total) : total;
    if (!isInt(paid) || paid < total) throw new Error('Amount paid is less than the total');

    let customerId = null;
    if (input.customerId) {
      const customer = getRow(db, 'customers', input.customerId);
      if (!customer || customer.deleted) throw new Error('Choose a valid customer');
      customerId = customer.id;
    }

    const saleId = newId();
    const now = nowIso();
    for (const line of lines) {
      const parts = allocateFifo(db, line.product.id, line.qty, line.product.name);
      for (const part of parts) {
        writeRow(db, 'sale_items', {
          id: newId(),
          sale_id: saleId,
          product_id: line.product.id,
          batch_id: part.batch.id,
          product_name: line.product.name,
          qty: part.qty,
          unit_price: line.product.unit_price,
          line_total: line.product.unit_price * part.qty,
          created_at: now,
          updated_at: now,
          deleted: 0,
        });
        addMovement(db, {
          batchId: part.batch.id,
          productId: line.product.id,
          qty: -part.qty,
          type: 'sale',
          refId: saleId,
        });
      }
    }

    writeRow(db, 'sales', {
      id: saleId,
      invoice_no: nextInvoiceNo(db, session.deviceId),
      device_id: session.deviceId,
      customer_id: customerId,
      cashier_name: session.cashierName,
      subtotal,
      discount,
      total,
      payment_method: paymentMethod,
      amount_paid: paid,
      change_given: paid - total,
      prescription_verified: needsPrescription ? 1 : 0,
      status: 'completed',
      created_at: now,
      updated_at: now,
      deleted: 0,
    });

    return getSale(db, saleId);
  })();
}

/** Voids a completed sale and returns the sold units to their batches. */
function voidSale(db, saleId, reason) {
  const note = cleanText(reason);
  if (note.length < 3) throw new Error('Give a reason for voiding the sale');
  return db.transaction(() => {
    const sale = getRow(db, 'sales', saleId);
    if (!sale || sale.deleted) throw new Error('Sale not found');
    if (sale.status !== 'completed') throw new Error('This sale is already voided');

    const items = db.prepare('SELECT * FROM sale_items WHERE sale_id = ? AND deleted = 0').all(saleId);
    for (const item of items) {
      addMovement(db, {
        batchId: item.batch_id,
        productId: item.product_id,
        qty: item.qty,
        type: 'void',
        refId: saleId,
        note: `Void of ${sale.invoice_no}`,
      });
    }
    writeRow(db, 'sales', {
      ...sale,
      status: 'voided',
      void_reason: note,
      updated_at: nowIso(),
    });
    return getSale(db, saleId);
  })();
}

module.exports = { createSale, getSale, listSales, voidSale, nextInvoiceNo, PAYMENT_METHODS };
