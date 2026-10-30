'use strict';

const { writeRow, getRow } = require('../lib/db');
const { newId, nowIso, isInt, isDate, cleanText, dayBounds } = require('../lib/util');
const {
  PAYMENT_METHODS,
  BILL_TYPES,
  financialYear,
  needsPrescription,
  roundToRupee,
  rupeesInWords,
  splitInclusiveGst,
} = require('../lib/india');
const { allocateFifo, addMovement } = require('./inventory');

const MAX_LINES = 200;
const MAX_QTY = 9999;

function mapSale(row, items = []) {
  return {
    id: row.id,
    invoiceNo: row.invoice_no,
    invoiceFy: row.invoice_fy,
    billType: row.bill_type,
    customerId: row.customer_id,
    customerName: row.customer_name ?? null,
    customerGstin: row.customer_gstin ?? null,
    cashierName: row.cashier_name,
    subtotal: row.subtotal,
    discount: row.discount,
    roundOff: row.round_off,
    total: row.total,
    totalInWords: rupeesInWords(row.total),
    taxableValue: row.taxable_value,
    cgst: row.cgst,
    sgst: row.sgst,
    paymentMethod: row.payment_method,
    amountPaid: row.amount_paid,
    changeGiven: row.change_given,
    prescription: row.rx_patient_name
      ? {
        doctorName: row.rx_doctor_name,
        doctorRegNo: row.rx_doctor_reg_no,
        prescriptionNo: row.rx_prescription_no,
        prescriptionDate: row.rx_prescription_date,
        patientName: row.rx_patient_name,
        patientAddress: row.rx_patient_address,
      }
      : null,
    status: row.status,
    voidReason: row.void_reason,
    createdAt: row.created_at,
    itemCount: row.item_count ?? items.length,
    items,
  };
}

function getSale(db, id) {
  const row = db.prepare(`
    SELECT s.*, c.name AS customer_name, c.gstin AS customer_gstin
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
    hsnCode: item.hsn_code,
    schedule: item.schedule,
    gstRate: item.gst_rate,
    qty: item.qty,
    mrp: item.mrp,
    grossAmount: item.gross_amount,
    discountShare: item.discount_share,
    lineTotal: item.line_total,
    taxableValue: item.taxable_value,
    cgst: item.cgst,
    sgst: item.sgst,
  }));
  return mapSale(row, items);
}

function listSales(db, { from, to, limit = 200 } = {}) {
  if (!from || !to) throw new Error('Choose a date range');
  const bounds = dayBounds(from, to);
  return db.prepare(`
    SELECT s.*, c.name AS customer_name, c.gstin AS customer_gstin,
      (SELECT COUNT(*) FROM sale_items si WHERE si.sale_id = s.id AND si.deleted = 0) AS item_count
    FROM sales s LEFT JOIN customers c ON c.id = s.customer_id
    WHERE s.deleted = 0 AND s.created_at >= @start AND s.created_at < @end
    ORDER BY s.created_at DESC
    LIMIT @limit
  `).all({ ...bounds, limit: Math.min(Number(limit) || 200, 1000) }).map((row) => mapSale(row));
}

/** Invoice numbers are "<till code>/<financial year>/<serial>", as GST expects a serial per year. */
function nextInvoice(db, deviceId, counterCode, fy, billType) {
  const count = db
    .prepare('SELECT COUNT(*) AS n FROM sales WHERE device_id = ? AND invoice_fy = ? AND bill_type = ?')
    .get(deviceId, fy, billType).n;
  // Bills of supply run in their own series so the GST invoice numbers stay gap-free.
  const series = billType === 'bill_of_supply' ? `${counterCode}/BOS` : counterCode;
  return `${series}/${fy}/${count + 1}`;
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

/** Schedule H, H1 and X medicines need the prescription details recorded on the bill. */
function validatePrescription(lines, input) {
  if (!lines.some((line) => needsPrescription(line.product.schedule))) return null;
  const rx = input.prescription ?? {};
  if (!cleanText(rx.doctorName)) throw new Error("Enter the prescribing doctor's name for Schedule H/H1/X medicines");
  if (!cleanText(rx.patientName)) throw new Error('Enter the patient name for Schedule H/H1/X medicines');
  if (!isDate(rx.prescriptionDate)) throw new Error('Enter the prescription date');
  return {
    rx_doctor_name: cleanText(rx.doctorName),
    rx_doctor_reg_no: cleanText(rx.doctorRegNo) || null,
    rx_prescription_no: cleanText(rx.prescriptionNo) || null,
    rx_prescription_date: rx.prescriptionDate,
    rx_patient_name: cleanText(rx.patientName),
    rx_patient_address: cleanText(rx.patientAddress) || null,
  };
}

/**
 * Completes a sale atomically.
 *  - Prices come from the batch MRP (GST-inclusive). Nothing sold can exceed MRP.
 *  - Stock is allocated first-expired-first-out, one movement per batch used.
 *  - A bill discount is spread across the lines in proportion to their value.
 *  - Each line is split into taxable value, CGST and SGST.
 *  - The bill is rounded to the nearest rupee and the difference shown as round-off.
 */
function createSale(db, input, session) {
  validateCart(input.items);
  const paymentMethod = input.paymentMethod ?? 'cash';
  if (!PAYMENT_METHODS.includes(paymentMethod)) throw new Error('Choose a valid payment method');
  const billType = input.billType ?? 'tax_invoice';
  if (!BILL_TYPES.includes(billType)) throw new Error('Choose a valid bill type');

  return db.transaction(() => {
    const lines = input.items.map((item) => {
      const product = getRow(db, 'products', item.productId);
      if (!product || product.deleted) throw new Error('A product in the cart no longer exists');
      return { product, qty: item.qty };
    });

    const prescription = validatePrescription(lines, input);

    let customerId = null;
    let customer = null;
    if (input.customerId) {
      customer = getRow(db, 'customers', input.customerId);
      if (!customer || customer.deleted) throw new Error('Choose a valid customer');
      customerId = customer.id;
    }
    if (paymentMethod === 'credit' && !customerId) throw new Error('Credit sales need a customer');

    const saleId = newId();
    const now = nowIso();
    const parts = [];
    for (const line of lines) {
      for (const part of allocateFifo(db, line.product.id, line.qty, line.product.name)) {
        addMovement(db, {
          batchId: part.batch.id,
          productId: line.product.id,
          qty: -part.qty,
          type: 'sale',
          refId: saleId,
        });
        parts.push({ product: line.product, batch: part.batch, qty: part.qty });
      }
    }

    const subtotal = parts.reduce((sum, p) => sum + p.batch.mrp * p.qty, 0);
    const discount = input.discount ?? 0;
    if (!isInt(discount) || discount < 0 || discount > subtotal) {
      throw new Error('Discount must be between 0 and the subtotal');
    }

    // Spread the discount over the lines; the last line takes the rounding remainder.
    let discountLeft = discount;
    parts.forEach((p, index) => {
      p.gross = p.batch.mrp * p.qty;
      p.discountShare = index === parts.length - 1
        ? discountLeft
        : Math.min(Math.floor((discount * p.gross) / subtotal), discountLeft);
      discountLeft -= p.discountShare;
      p.net = p.gross - p.discountShare;
      if (billType === 'bill_of_supply') {
        Object.assign(p, { taxable: p.net, cgst: 0, sgst: 0 });
      } else {
        Object.assign(p, splitInclusiveGst(p.net, p.product.gst_rate));
      }
    });

    const payable = subtotal - discount;
    const total = roundToRupee(payable);
    const roundOff = total - payable;
    const paid = paymentMethod === 'credit' ? 0 : (input.amountPaid ?? total);
    if (paymentMethod !== 'credit' && (!isInt(paid) || paid < total)) {
      throw new Error('Amount paid is less than the total');
    }

    const fy = financialYear(new Date());
    const counterCode = session.counterCode ?? 'C1';
    const taxable = parts.reduce((sum, p) => sum + p.taxable, 0);
    const cgst = parts.reduce((sum, p) => sum + p.cgst, 0);
    const sgst = parts.reduce((sum, p) => sum + p.sgst, 0);

    writeRow(db, 'sales', {
      id: saleId,
      invoice_no: nextInvoice(db, session.deviceId, counterCode, fy, billType),
      invoice_fy: fy,
      bill_type: billType,
      device_id: session.deviceId,
      customer_id: customerId,
      cashier_name: session.cashierName,
      subtotal,
      discount,
      round_off: roundOff,
      total,
      taxable_value: taxable,
      cgst,
      sgst,
      payment_method: paymentMethod,
      amount_paid: paymentMethod === 'credit' ? 0 : paid,
      change_given: paymentMethod === 'credit' ? 0 : paid - total,
      ...(prescription ?? {}),
      status: 'completed',
      created_at: now,
      updated_at: now,
      deleted: 0,
    });

    for (const p of parts) {
      writeRow(db, 'sale_items', {
        id: newId(),
        sale_id: saleId,
        product_id: p.product.id,
        batch_id: p.batch.id,
        product_name: p.product.name,
        hsn_code: p.product.hsn_code,
        schedule: p.product.schedule,
        gst_rate: p.product.gst_rate,
        qty: p.qty,
        mrp: p.batch.mrp,
        gross_amount: p.gross,
        discount_share: p.discountShare,
        line_total: p.net,
        taxable_value: p.taxable,
        cgst: p.cgst,
        sgst: p.sgst,
        created_at: now,
        updated_at: now,
        deleted: 0,
      });
    }
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

module.exports = { createSale, getSale, listSales, voidSale, nextInvoice };
