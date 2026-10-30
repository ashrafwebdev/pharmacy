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
    SELECT COUNT(*) AS count, COALESCE(SUM(total), 0) AS revenue,
      COALESCE(SUM(discount), 0) AS discounts, COALESCE(SUM(cgst + sgst), 0) AS gst
    FROM sales
    WHERE deleted = 0 AND status = 'completed' AND created_at >= @start AND created_at < @end
  `).get(bounds);
  const units = db.prepare(`
    SELECT COALESCE(SUM(si.qty), 0) AS units
    FROM sale_items si JOIN sales s ON s.id = si.sale_id
    WHERE si.deleted = 0 AND s.deleted = 0 AND s.status = 'completed'
      AND s.created_at >= @start AND s.created_at < @end
  `).get(bounds);
  return {
    count: totals.count,
    revenue: totals.revenue,
    discounts: totals.discounts,
    gstCollected: totals.gst,
    averageTicket: totals.count ? Math.round(totals.revenue / totals.count) : 0,
    unitsSold: units.units,
  };
}

/** GST collected per rate: the figures a GST return needs. Amounts in paise. */
function gstSummary(db, { from, to }) {
  const bounds = assertRange(from, to);
  return db.prepare(`
    SELECT si.gst_rate AS rate,
      SUM(si.taxable_value) AS taxableValue,
      SUM(si.cgst) AS cgst,
      SUM(si.sgst) AS sgst,
      SUM(si.line_total) AS total
    FROM sale_items si JOIN sales s ON s.id = si.sale_id
    WHERE si.deleted = 0 AND s.deleted = 0 AND s.status = 'completed'
      AND s.bill_type = 'tax_invoice'
      AND s.created_at >= @start AND s.created_at < @end
    GROUP BY si.gst_rate
    ORDER BY si.gst_rate
  `).all(bounds);
}

/** Schedule H / H1 / X dispensing record: patient, prescriber and drug per line. */
function scheduleRegister(db, { from, to }) {
  const bounds = assertRange(from, to);
  return db.prepare(`
    SELECT s.invoice_no AS invoiceNo, s.created_at AS createdAt,
      s.rx_patient_name AS patientName, s.rx_patient_address AS patientAddress,
      s.rx_doctor_name AS doctorName, s.rx_doctor_reg_no AS doctorRegNo,
      s.rx_prescription_no AS prescriptionNo, s.rx_prescription_date AS prescriptionDate,
      si.product_name AS productName, si.schedule AS schedule, si.qty AS qty,
      b.batch_no AS batchNo
    FROM sale_items si
    JOIN sales s ON s.id = si.sale_id
    LEFT JOIN batches b ON b.id = si.batch_id
    WHERE si.deleted = 0 AND s.deleted = 0 AND s.status = 'completed'
      AND si.schedule IN ('H', 'H1', 'X')
      AND s.created_at >= @start AND s.created_at < @end
    ORDER BY s.created_at, s.invoice_no
  `).all(bounds);
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

const rupees = (paise) => (paise / 100).toFixed(2);

function toCsv(header, rows) {
  return [header.join(','), ...rows.map((row) => row.map(csvCell).join(','))].join('\n');
}

function salesCsv(db, { from, to }) {
  const bounds = assertRange(from, to);
  const rows = db.prepare(`
    SELECT s.invoice_no, s.created_at, c.name AS customer, c.gstin, s.payment_method, s.subtotal,
      s.discount, s.round_off, s.taxable_value, s.cgst, s.sgst, s.total, s.status, s.cashier_name
    FROM sales s LEFT JOIN customers c ON c.id = s.customer_id
    WHERE s.deleted = 0 AND s.created_at >= @start AND s.created_at < @end
    ORDER BY s.created_at
  `).all(bounds);
  return toCsv(
    ['Invoice', 'Date', 'Customer', 'Customer GSTIN', 'Cashier', 'Payment', 'MRP value', 'Discount',
      'Round off', 'Taxable value', 'CGST', 'SGST', 'Total', 'Status'],
    rows.map((r) => [
      r.invoice_no,
      new Date(r.created_at).toLocaleString('en-IN'),
      r.customer,
      r.gstin,
      r.cashier_name,
      r.payment_method,
      rupees(r.subtotal),
      rupees(r.discount),
      rupees(r.round_off),
      rupees(r.taxable_value),
      rupees(r.cgst),
      rupees(r.sgst),
      rupees(r.total),
      r.status,
    ]),
  );
}

function gstCsv(db, range) {
  const rows = gstSummary(db, range);
  return toCsv(
    ['GST rate %', 'Taxable value', 'CGST', 'SGST', 'Total incl. GST'],
    rows.map((r) => [r.rate, rupees(r.taxableValue), rupees(r.cgst), rupees(r.sgst), rupees(r.total)]),
  );
}

function registerCsv(db, range) {
  const rows = scheduleRegister(db, range);
  return toCsv(
    ['Date', 'Invoice', 'Patient', 'Patient address', 'Prescriber', 'Prescriber reg. no.',
      'Prescription no.', 'Prescription date', 'Drug', 'Schedule', 'Qty', 'Batch'],
    rows.map((r) => [
      new Date(r.createdAt).toLocaleDateString('en-IN'),
      r.invoiceNo,
      r.patientName,
      r.patientAddress,
      r.doctorName,
      r.doctorRegNo,
      r.prescriptionNo,
      r.prescriptionDate,
      r.productName,
      r.schedule,
      r.qty,
      r.batchNo,
    ]),
  );
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

module.exports = {
  salesSummary,
  gstSummary,
  scheduleRegister,
  topProducts,
  dailySales,
  salesCsv,
  gstCsv,
  registerCsv,
  dashboardStats,
};
