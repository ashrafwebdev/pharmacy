'use strict';

const { localDate, dayBounds, isDate } = require('../lib/util');
const { listBatches, lowStockProducts, warningDays } = require('./inventory');

function assertRange(from, to) {
  if (!isDate(from) || !isDate(to)) throw new Error('Choose a valid date range');
  if (from > to) throw new Error('The start date must be before the end date');
  return dayBounds(from, to);
}

function salesSummary(db, { from, to }) {
  const bounds = assertRange(from, to);
  const totals = db.prepare(`
    SELECT COUNT(*) AS count, COALESCE(SUM(total), 0) AS revenue, COALESCE(SUM(discount), 0) AS discounts
    FROM sales
    WHERE deleted = 0 AND status = 'completed' AND created_at >= @start AND created_at < @end
  `).get(bounds);
  const items = db.prepare(`
    SELECT COALESCE(SUM(si.qty), 0) AS units
    FROM sale_items si JOIN sales s ON s.id = si.sale_id
    WHERE si.deleted = 0 AND s.deleted = 0 AND s.status = 'completed'
      AND s.created_at >= @start AND s.created_at < @end
  `).get(bounds);
  return {
    count: totals.count,
    revenue: totals.revenue,
    discounts: totals.discounts,
    averageTicket: totals.count ? Math.round(totals.revenue / totals.count) : 0,
    unitsSold: items.units,
  };
}

function topProducts(db, { from, to, limit = 10 }) {
  const bounds = assertRange(from, to);
  return db.prepare(`
    SELECT si.product_id AS productId, si.product_name AS productName,
      SUM(si.qty) AS qty, SUM(si.line_total) AS revenue
    FROM sale_items si JOIN sales s ON s.id = si.sale_id
    WHERE si.deleted = 0 AND s.deleted = 0 AND s.status = 'completed'
      AND s.created_at >= @start AND s.created_at < @end
    GROUP BY si.product_id, si.product_name
    ORDER BY revenue DESC
    LIMIT @limit
  `).all({ ...bounds, limit: Math.min(Number(limit) || 10, 100) });
}

/** Groups completed sales by the local calendar day, which is what the shop sees. */
function dailySales(db, { from, to }) {
  const bounds = assertRange(from, to);
  const rows = db.prepare(`
    SELECT created_at, total FROM sales
    WHERE deleted = 0 AND status = 'completed' AND created_at >= @start AND created_at < @end
    ORDER BY created_at
  `).all(bounds);
  const days = new Map();
  for (const row of rows) {
    const day = localDate(new Date(row.created_at));
    const entry = days.get(day) ?? { date: day, count: 0, revenue: 0 };
    entry.count += 1;
    entry.revenue += row.total;
    days.set(day, entry);
  }
  return [...days.values()];
}

function csvCell(value) {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function salesCsv(db, { from, to }) {
  const bounds = assertRange(from, to);
  const rows = db.prepare(`
    SELECT s.invoice_no, s.created_at, c.name AS customer, s.payment_method, s.subtotal,
      s.discount, s.total, s.status, s.cashier_name
    FROM sales s LEFT JOIN customers c ON c.id = s.customer_id
    WHERE s.deleted = 0 AND s.created_at >= @start AND s.created_at < @end
    ORDER BY s.created_at
  `).all(bounds);
  const money = (cents) => (cents / 100).toFixed(2);
  const header = ['Invoice', 'Date', 'Customer', 'Cashier', 'Payment', 'Subtotal', 'Discount', 'Total', 'Status'];
  const lines = rows.map((r) => [
    r.invoice_no,
    new Date(r.created_at).toLocaleString(),
    r.customer,
    r.cashier_name,
    r.payment_method,
    money(r.subtotal),
    money(r.discount),
    money(r.total),
    r.status,
  ].map(csvCell).join(','));
  return [header.join(','), ...lines].join('\n');
}

function dashboardStats(db) {
  const today = localDate();
  const bounds = dayBounds(today, today);
  const sales = db.prepare(`
    SELECT COUNT(*) AS count, COALESCE(SUM(total), 0) AS revenue
    FROM sales WHERE deleted = 0 AND status = 'completed' AND created_at >= @start AND created_at < @end
  `).get(bounds);
  const batches = listBatches(db, { inStockOnly: true });
  const products = db.prepare('SELECT COUNT(*) AS n FROM products WHERE deleted = 0').get().n;
  return {
    todaySalesCount: sales.count,
    todayRevenue: sales.revenue,
    productCount: products,
    expiredBatches: batches.filter((b) => b.status === 'expired'),
    expiringBatches: batches.filter((b) => b.status === 'expiring'),
    lowStock: lowStockProducts(db),
    expiryWarningDays: warningDays(db),
  };
}

module.exports = { salesSummary, topProducts, dailySales, salesCsv, dashboardStats };
