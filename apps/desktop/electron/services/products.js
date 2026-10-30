'use strict';

const { writeRow, getRow } = require('../lib/db');
const { newId, nowIso, cleanText, isInt } = require('../lib/util');

const STOCK_CTE = `
  WITH stock AS (
    SELECT product_id, SUM(qty) AS on_hand
    FROM stock_movements WHERE deleted = 0 GROUP BY product_id
  )`;

function mapProduct(row) {
  return {
    id: row.id,
    sku: row.sku,
    name: row.name,
    genericName: row.generic_name,
    category: row.category,
    manufacturer: row.manufacturer,
    unitPrice: row.unit_price,
    costPrice: row.cost_price,
    reorderLevel: row.reorder_level,
    requiresPrescription: row.requires_prescription === 1,
    onHand: row.on_hand ?? 0,
  };
}

function listProducts(db, { search = '', limit = 300 } = {}) {
  const term = `%${cleanText(search)}%`;
  return db.prepare(`
    ${STOCK_CTE}
    SELECT p.*, COALESCE(stock.on_hand, 0) AS on_hand
    FROM products p LEFT JOIN stock ON stock.product_id = p.id
    WHERE p.deleted = 0 AND (
      p.name LIKE @term OR p.sku LIKE @term OR p.generic_name LIKE @term OR p.manufacturer LIKE @term
    )
    ORDER BY p.name
    LIMIT @limit
  `).all({ term, limit: Math.min(Number(limit) || 300, 1000) }).map(mapProduct);
}

function getProduct(db, id) {
  const row = db.prepare(`
    ${STOCK_CTE}
    SELECT p.*, COALESCE(stock.on_hand, 0) AS on_hand
    FROM products p LEFT JOIN stock ON stock.product_id = p.id
    WHERE p.id = ? AND p.deleted = 0
  `).get(id);
  return row ? mapProduct(row) : null;
}

function getProductBySku(db, sku) {
  const found = db
    .prepare('SELECT id FROM products WHERE sku = ? AND deleted = 0')
    .get(cleanText(sku));
  return found ? getProduct(db, found.id) : null;
}

function saveProduct(db, input) {
  const name = cleanText(input.name);
  const sku = cleanText(input.sku) || null;
  const unitPrice = input.unitPrice;
  const costPrice = input.costPrice ?? 0;
  const reorderLevel = input.reorderLevel ?? 0;
  if (!name) throw new Error('Product name is required');
  if (!isInt(unitPrice) || unitPrice < 0) throw new Error('Selling price must be a valid amount');
  if (!isInt(costPrice) || costPrice < 0) throw new Error('Cost price must be a valid amount');
  if (!isInt(reorderLevel) || reorderLevel < 0) throw new Error('Reorder level must be 0 or more');

  if (sku) {
    const clash = db
      .prepare('SELECT id FROM products WHERE sku = ? AND deleted = 0 AND id != ?')
      .get(sku, input.id ?? '');
    if (clash) throw new Error(`Barcode/SKU ${sku} is already used by another product`);
  }

  const existing = input.id ? getRow(db, 'products', input.id) : null;
  if (input.id && (!existing || existing.deleted)) throw new Error('Product not found');

  const now = nowIso();
  const id = existing?.id ?? newId();
  writeRow(db, 'products', {
    id,
    sku,
    name,
    generic_name: cleanText(input.genericName) || null,
    category: cleanText(input.category) || null,
    manufacturer: cleanText(input.manufacturer) || null,
    unit_price: unitPrice,
    cost_price: costPrice,
    reorder_level: reorderLevel,
    requires_prescription: input.requiresPrescription ? 1 : 0,
    created_at: existing?.created_at ?? now,
    updated_at: now,
    deleted: 0,
  });
  return getProduct(db, id);
}

function removeProduct(db, id) {
  const existing = getRow(db, 'products', id);
  if (!existing || existing.deleted) throw new Error('Product not found');
  const stock = getProduct(db, id).onHand;
  if (stock !== 0) throw new Error('Clear or adjust the stock to zero before removing this product');
  writeRow(db, 'products', { ...existing, deleted: 1, updated_at: nowIso() });
  return true;
}

module.exports = {
  listProducts,
  getProduct,
  getProductBySku,
  saveProduct,
  removeProduct,
  mapProduct,
  STOCK_CTE,
};
