'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { openDatabase, writeRow } = require('../electron/lib/db');
const { createApi } = require('../electron/ipc');
const { createSyncService } = require('../electron/services/sync');
const { addMovement } = require('../electron/services/inventory');
const { localDate, newId, nowIso } = require('../electron/lib/util');

const PASSWORD = 'password123';
const RS = (rupees) => Math.round(rupees * 100);

function daysFromToday(days) {
  return localDate(new Date(Date.now() + days * 86_400_000));
}

function createDevice() {
  const db = openDatabase(':memory:');
  const sync = createSyncService({ db, fetchImpl: globalThis.fetch });
  const api = createApi({ db, sync, dialog: null, fs: null, getWindow: () => null });
  return { db, sync, api };
}

async function call(api, method, args = {}) {
  const res = await api.call(method, args);
  if (!res.ok) throw new Error(`${method} failed: ${res.error}`);
  return res.data;
}

async function signInAsAdmin(api) {
  await call(api, 'auth.setup', { username: 'admin', name: 'Owner', password: PASSWORD });
}

async function addProduct(api, overrides = {}) {
  return call(api, 'products.save', {
    name: 'Paracetamol 500mg',
    sku: '890100000001',
    hsnCode: '3004',
    gstRate: 12,
    schedule: 'OTC',
    mrp: RS(250),
    reorderLevel: 10,
    ...overrides,
  });
}

async function receive(api, productId, batchNo, expiryDate, qty, extra = {}) {
  return call(api, 'stock.receive', {
    productId,
    batchNo,
    expiryDate,
    qty,
    ...extra,
  });
}

const rx = {
  doctorName: 'Dr. Meera Rao',
  doctorRegNo: 'KA-45821',
  prescriptionNo: 'RX-1009',
  prescriptionDate: daysFromToday(-1),
  patientName: 'Suresh Kumar',
  patientAddress: '12 MG Road, Bengaluru',
};

test('first-run setup creates an admin, and login checks the password', async () => {
  const { api } = createDevice();
  assert.equal((await call(api, 'auth.status')).hasUsers, false);

  await signInAsAdmin(api);
  await call(api, 'auth.logout');
  await assert.rejects(call(api, 'auth.login', { username: 'admin', password: 'wrong-pass' }), /Invalid username or password/);
  const user = await call(api, 'auth.login', { username: 'ADMIN', password: PASSWORD });
  assert.equal(user.role, 'admin');

  await assert.rejects(
    call(api, 'auth.setup', { username: 'second', name: 'X', password: PASSWORD }),
    /already been completed/,
  );
});

test('protected actions require sign-in and the right role', async () => {
  const { api } = createDevice();
  await assert.rejects(call(api, 'products.list'), /sign in/);

  await signInAsAdmin(api);
  await call(api, 'users.create', { username: 'cashier1', name: 'Cashier One', role: 'cashier', password: PASSWORD });
  await call(api, 'auth.logout');
  await call(api, 'auth.login', { username: 'cashier1', password: PASSWORD });

  await assert.rejects(addProduct(api), /not allowed/);
  await assert.rejects(call(api, 'reports.summary', { from: daysFromToday(-1), to: daysFromToday(0) }), /not allowed/);
});

test('admin cannot remove the last active admin', async () => {
  const { api } = createDevice();
  await signInAsAdmin(api);
  const [me] = await call(api, 'users.list');
  await assert.rejects(call(api, 'users.update', { id: me.id, role: 'cashier' }), /cannot remove your own admin access/);
});

test('products need an MRP, a valid GST rate, schedule and HSN, and unique barcodes', async () => {
  const { api } = createDevice();
  await signInAsAdmin(api);
  await addProduct(api, { sku: '111' });
  await assert.rejects(addProduct(api, { name: 'Other', sku: '111' }), /already used/);
  await assert.rejects(addProduct(api, { name: '' }), /name is required/);
  await assert.rejects(addProduct(api, { name: 'No MRP', mrp: 0 }), /MRP/);
  await assert.rejects(addProduct(api, { name: 'Bad GST', gstRate: 7 }), /GST rate/);
  await assert.rejects(addProduct(api, { name: 'Bad schedule', schedule: 'Z' }), /schedule/);
  await assert.rejects(addProduct(api, { name: 'Bad HSN', hsnCode: '30' }), /HSN/);
});

test('sales allocate stock first-expired-first-out and bill at MRP', async () => {
  const { api } = createDevice();
  await signInAsAdmin(api);
  const product = await addProduct(api);
  const later = await receive(api, product.id, 'LATE', daysFromToday(200), 5);
  const sooner = await receive(api, product.id, 'SOON', daysFromToday(30), 5);

  const sale = await call(api, 'sales.create', {
    items: [{ productId: product.id, qty: 7 }],
    paymentMethod: 'cash',
    amountPaid: RS(2000),
  });
  assert.equal(sale.total, RS(1750));
  assert.equal(sale.changeGiven, RS(250));
  assert.deepEqual(sale.items.map((i) => i.qty), [5, 2]);
  assert.ok(sale.items.every((i) => i.mrp === RS(250)));

  const batches = await call(api, 'stock.batches', {});
  assert.equal(batches.find((b) => b.id === sooner.id).onHand, 0);
  assert.equal(batches.find((b) => b.id === later.id).onHand, 3);
});

test('a batch with a higher MRP is billed at its own MRP, never above it', async () => {
  const { api } = createDevice();
  await signInAsAdmin(api);
  const product = await addProduct(api, { mrp: RS(100) });
  await receive(api, product.id, 'OLD-PRICE', daysFromToday(100), 2);
  await receive(api, product.id, 'NEW-PRICE', daysFromToday(300), 2, { mrp: RS(110) });
  const sale = await call(api, 'sales.create', {
    items: [{ productId: product.id, qty: 1 }],
    paymentMethod: 'upi',
  });
  assert.equal(sale.items[0].mrp, RS(100), 'the earlier-expiring batch is sold first, at its own MRP');
  await assert.rejects(
    receive(api, product.id, 'BAD', daysFromToday(300), 1, { mrp: RS(100), purchasePrice: RS(150) }),
    /Purchase price cannot be higher than the MRP/,
  );
});

test('expired batches are never sold', async () => {
  const { db, api } = createDevice();
  await signInAsAdmin(api);
  const product = await addProduct(api);
  const expired = newId();
  writeRow(db, 'batches', {
    id: expired,
    product_id: product.id,
    batch_no: 'OLD',
    expiry_date: daysFromToday(-3),
    mrp: RS(250),
    purchase_price: 0,
    created_at: nowIso(),
    updated_at: nowIso(),
    deleted: 0,
  });
  addMovement(db, { batchId: expired, productId: product.id, qty: 4, type: 'receive' });

  await assert.rejects(
    call(api, 'sales.create', { items: [{ productId: product.id, qty: 1 }], paymentMethod: 'cash', amountPaid: RS(250) }),
    /Not enough in-date stock/,
  );

  const [batch] = await call(api, 'stock.batches', { productId: product.id });
  assert.equal(batch.status, 'expired');
  const writeOff = await call(api, 'stock.writeOffExpired', { batchId: expired });
  assert.equal(writeOff.onHand, 0);
});

test('a sale that cannot be fully covered leaves stock untouched', async () => {
  const { api } = createDevice();
  await signInAsAdmin(api);
  const product = await addProduct(api);
  const batch = await receive(api, product.id, 'ONLY', daysFromToday(100), 3);

  await assert.rejects(
    call(api, 'sales.create', { items: [{ productId: product.id, qty: 5 }], paymentMethod: 'cash', amountPaid: RS(9999) }),
    /only 3 available/,
  );
  const [after] = await call(api, 'stock.batches', { productId: product.id });
  assert.equal(after.id, batch.id);
  assert.equal(after.onHand, 3);
});

test('Schedule H1 medicines need prescription details and are recorded on the bill', async () => {
  const { api } = createDevice();
  await signInAsAdmin(api);
  const product = await addProduct(api, { name: 'Alprazolam 0.25', schedule: 'H1', mrp: RS(40) });
  await receive(api, product.id, 'ALP1', daysFromToday(200), 10);
  const base = { items: [{ productId: product.id, qty: 1 }], paymentMethod: 'cash', amountPaid: RS(40) };

  await assert.rejects(call(api, 'sales.create', base), /prescribing doctor/);
  await assert.rejects(call(api, 'sales.create', { ...base, prescription: { ...rx, patientName: '' } }), /patient name/);
  await assert.rejects(call(api, 'sales.create', { ...base, prescription: { ...rx, prescriptionDate: '' } }), /prescription date/);

  const sale = await call(api, 'sales.create', { ...base, prescription: rx });
  assert.equal(sale.prescription.patientName, 'Suresh Kumar');
  assert.equal(sale.prescription.doctorRegNo, 'KA-45821');
});

test('OTC medicines do not need a prescription', async () => {
  const { api } = createDevice();
  await signInAsAdmin(api);
  const product = await addProduct(api);
  await receive(api, product.id, 'OTC1', daysFromToday(200), 3);
  const sale = await call(api, 'sales.create', { items: [{ productId: product.id, qty: 1 }], paymentMethod: 'upi' });
  assert.equal(sale.prescription, null);
});

test('GST is split per line and a bill discount is spread over the lines', async () => {
  const { api } = createDevice();
  await signInAsAdmin(api);
  const product = await addProduct(api, { mrp: RS(112), gstRate: 12 });
  await receive(api, product.id, 'GST1', daysFromToday(200), 10);

  const sale = await call(api, 'sales.create', {
    items: [{ productId: product.id, qty: 2 }],
    discount: RS(24),
    paymentMethod: 'cash',
    amountPaid: RS(200),
  });
  // MRP 224 less discount 24 = 200 payable, inclusive of GST.
  assert.equal(sale.subtotal, RS(224));
  assert.equal(sale.discount, RS(24));
  assert.equal(sale.total, RS(200));
  assert.equal(sale.roundOff, 0);
  // 200 inclusive of 12%: taxable 178.57, GST 21.43 split into CGST 10.71 and SGST 10.72.
  assert.equal(sale.taxableValue, 17857);
  assert.equal(sale.cgst, 1071);
  assert.equal(sale.sgst, 1072);
  assert.equal(sale.taxableValue + sale.cgst + sale.sgst, sale.total);
  assert.equal(sale.items[0].discountShare, RS(24));
});

test('bills round to the nearest rupee and show the round-off', async () => {
  const { api } = createDevice();
  await signInAsAdmin(api);
  const product = await addProduct(api, { mrp: 10050 }); // Rs 100.50
  await receive(api, product.id, 'RND1', daysFromToday(200), 5);
  const sale = await call(api, 'sales.create', {
    items: [{ productId: product.id, qty: 1 }],
    paymentMethod: 'cash',
    amountPaid: RS(101),
  });
  assert.equal(sale.total, RS(101));
  assert.equal(sale.roundOff, 50);
  assert.equal(sale.changeGiven, 0);
});

test('payment rules: cash must cover the total, credit needs a customer', async () => {
  const { api } = createDevice();
  await signInAsAdmin(api);
  const product = await addProduct(api);
  await receive(api, product.id, 'PAY1', daysFromToday(200), 10);
  const item = [{ productId: product.id, qty: 1 }];

  await assert.rejects(call(api, 'sales.create', { items: item, paymentMethod: 'cash', amountPaid: RS(100) }), /less than the total/);
  await assert.rejects(call(api, 'sales.create', { items: item, paymentMethod: 'credit' }), /Credit sales need a customer/);
  await assert.rejects(call(api, 'sales.create', { items: item, paymentMethod: 'bitcoin' }), /payment method/);

  const customer = await call(api, 'customers.save', { name: 'Ravi Textiles', phone: '9876543210', gstin: '29AAAAA0000A1Z5' });
  const credit = await call(api, 'sales.create', { items: item, paymentMethod: 'credit', customerId: customer.id });
  assert.equal(credit.amountPaid, 0);
  assert.equal(credit.customerName, 'Ravi Textiles');
  assert.equal(credit.customerGstin, '29AAAAA0000A1Z5');
});

test('invoice numbers follow the till code and financial year, with no gaps', async () => {
  const { api } = createDevice();
  await signInAsAdmin(api);
  const product = await addProduct(api);
  await receive(api, product.id, 'INV1', daysFromToday(200), 10);
  const item = [{ productId: product.id, qty: 1 }];
  const first = await call(api, 'sales.create', { items: item, paymentMethod: 'upi' });
  const second = await call(api, 'sales.create', { items: item, paymentMethod: 'upi' });
  assert.match(first.invoiceNo, /^C1\/\d{2}-\d{2}\/1$/);
  assert.match(second.invoiceNo, /^C1\/\d{2}-\d{2}\/2$/);
  assert.equal(first.invoiceFy, second.invoiceFy);
});

test('prices, batches and purchases use rupee-safe integers only', async () => {
  const { api } = createDevice();
  await signInAsAdmin(api);
  await assert.rejects(addProduct(api, { mrp: 25.5 }), /MRP/);
  const product = await addProduct(api);
  await assert.rejects(receive(api, product.id, 'X', daysFromToday(10), 0), /Quantity/);
});

test('voiding a sale returns the stock and cannot be repeated', async () => {
  const { api } = createDevice();
  await signInAsAdmin(api);
  const product = await addProduct(api);
  const batch = await receive(api, product.id, 'V1', daysFromToday(200), 4);
  const sale = await call(api, 'sales.create', { items: [{ productId: product.id, qty: 3 }], paymentMethod: 'card' });

  await assert.rejects(call(api, 'sales.void', { id: sale.id, reason: 'x' }), /reason/);
  const voided = await call(api, 'sales.void', { id: sale.id, reason: 'Customer returned item' });
  assert.equal(voided.status, 'voided');

  const [after] = await call(api, 'stock.batches', { productId: product.id });
  assert.equal(after.id, batch.id);
  assert.equal(after.onHand, 4);
  await assert.rejects(call(api, 'sales.void', { id: sale.id, reason: 'again please' }), /already voided/);
});

test('dashboard flags low stock and batches close to expiry', async () => {
  const { api } = createDevice();
  await signInAsAdmin(api);
  const product = await addProduct(api, { reorderLevel: 10 });
  await receive(api, product.id, 'SOON', daysFromToday(20), 4);

  const stats = await call(api, 'dashboard.stats');
  assert.equal(stats.expiringBatches.length, 1);
  assert.equal(stats.expiringBatches[0].batchNo, 'SOON');
  assert.equal(stats.lowStock.length, 1);
  assert.equal(stats.lowStock[0].onHand, 4);
  assert.equal(stats.productCount, 1);
});

test('stock adjustments need a reason and cannot go negative', async () => {
  const { api } = createDevice();
  await signInAsAdmin(api);
  const product = await addProduct(api);
  const batch = await receive(api, product.id, 'ADJ', daysFromToday(200), 2);

  await assert.rejects(call(api, 'stock.adjust', { batchId: batch.id, qty: -1, reason: '' }), /reason/);
  await assert.rejects(call(api, 'stock.adjust', { batchId: batch.id, qty: -5, reason: 'Broken bottles' }), /Cannot remove/);
  const adjusted = await call(api, 'stock.adjust', { batchId: batch.id, qty: -1, reason: 'Broken bottle' });
  assert.equal(adjusted.onHand, 1);
});

test('reports: summary, GST by rate, Schedule H1 register and CSV use completed sales only', async () => {
  const { db, api } = createDevice();
  await signInAsAdmin(api);
  const otc = await addProduct(api, { name: 'Vitamin "C", 1000mg', mrp: RS(112), gstRate: 12 });
  const h1 = await addProduct(api, { name: 'Alprazolam', sku: '2', schedule: 'H1', mrp: RS(40), gstRate: 12 });
  await receive(api, otc.id, 'VC', daysFromToday(200), 10);
  await receive(api, h1.id, 'AL', daysFromToday(200), 10);

  await call(api, 'sales.create', { items: [{ productId: otc.id, qty: 2 }], paymentMethod: 'cash', amountPaid: RS(300) });
  await call(api, 'sales.create', { items: [{ productId: h1.id, qty: 1 }], paymentMethod: 'cash', amountPaid: RS(40), prescription: rx });
  const cancelled = await call(api, 'sales.create', { items: [{ productId: otc.id, qty: 1 }], paymentMethod: 'upi' });
  await call(api, 'sales.void', { id: cancelled.id, reason: 'Entered by mistake' });

  const range = { from: daysFromToday(-1), to: daysFromToday(0) };
  const summary = await call(api, 'reports.summary', range);
  assert.equal(summary.count, 2);
  assert.equal(summary.revenue, RS(264));
  assert.equal(summary.unitsSold, 3);
  assert.equal(summary.gstCollected, RS(264) - Math.round((RS(264) * 100) / 112));

  const gst = await call(api, 'reports.gstSummary', range);
  assert.equal(gst.length, 1);
  assert.equal(gst[0].rate, 12);
  assert.equal(gst[0].total, RS(264));

  const register = await call(api, 'reports.scheduleRegister', range);
  assert.equal(register.length, 1);
  assert.equal(register[0].patientName, 'Suresh Kumar');
  assert.equal(register[0].schedule, 'H1');

  const { salesCsv, gstCsv, registerCsv } = require('../electron/services/reports');
  const lines = salesCsv(db, range).split('\n');
  assert.match(lines[0], /^Invoice,Date,Customer,Customer GSTIN,Cashier,Payment,MRP value/);
  assert.equal(lines.length, 4); // header + two completed sales + the voided one
  assert.match(lines[lines.length - 1], /,voided$/);
  assert.match(gstCsv(db, range), /^GST rate %,Taxable value,CGST,SGST,Total incl. GST\n12,/);
  assert.match(registerCsv(db, range), /Suresh Kumar,.*H1,1,/);
});

test('settings validate GSTIN and the till counter code', async () => {
  const { api } = createDevice();
  await signInAsAdmin(api);
  const base = { pharmacyName: 'Sri Lakshmi Medical', expiryWarningDays: 90, counterCode: 'C1' };
  await assert.rejects(call(api, 'settings.save', { ...base, gstin: '27BADGSTIN' }), /GSTIN/);
  await assert.rejects(call(api, 'settings.save', { ...base, counterCode: 'bad code!' }), /Counter code/);
  const saved = await call(api, 'settings.save', { ...base, gstin: '29aaaaa0000a1z5' });
  assert.equal(saved.gstin, '29AAAAA0000A1Z5');
});
