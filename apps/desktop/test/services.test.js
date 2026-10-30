'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { openDatabase, writeRow } = require('../electron/lib/db');
const { createApi } = require('../electron/ipc');
const { createSyncService } = require('../electron/services/sync');
const { addMovement } = require('../electron/services/inventory');
const { localDate, newId, nowIso } = require('../electron/lib/util');

const PASSWORD = 'password123';

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
    unitPrice: 250,
    costPrice: 120,
    reorderLevel: 10,
    requiresPrescription: false,
    ...overrides,
  });
}

async function receive(api, productId, batchNo, expiryDate, qty) {
  return call(api, 'stock.receive', { productId, batchNo, expiryDate, qty, costPrice: 100 });
}

test('first-run setup creates an admin, and login checks the password', async () => {
  const { api } = createDevice();
  const before = await call(api, 'auth.status');
  assert.equal(before.hasUsers, false);

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
  await call(api, 'users.create', {
    username: 'cashier1',
    name: 'Cashier One',
    role: 'cashier',
    password: PASSWORD,
  });
  await call(api, 'auth.logout');
  await call(api, 'auth.login', { username: 'cashier1', password: PASSWORD });

  await assert.rejects(addProduct(api), /not allowed/);
  await assert.rejects(call(api, 'reports.summary', { from: daysFromToday(-1), to: daysFromToday(0) }), /not allowed/);
});

test('admin cannot remove the last active admin', async () => {
  const { api } = createDevice();
  await signInAsAdmin(api);
  const [me] = await call(api, 'users.list');
  await assert.rejects(
    call(api, 'users.update', { id: me.id, role: 'cashier' }),
    /cannot remove your own admin access/,
  );
});

test('products validate prices and reject duplicate barcodes', async () => {
  const { api } = createDevice();
  await signInAsAdmin(api);
  await addProduct(api, { sku: '111' });
  await assert.rejects(addProduct(api, { name: 'Other', sku: '111' }), /already used/);
  await assert.rejects(addProduct(api, { name: '' }), /name is required/);
  await assert.rejects(addProduct(api, { name: 'Bad price', unitPrice: 10.5 }), /valid amount/);
});

test('sales allocate stock first-expired-first-out', async () => {
  const { api } = createDevice();
  await signInAsAdmin(api);
  const product = await addProduct(api);
  const later = await receive(api, product.id, 'LATE', daysFromToday(200), 5);
  const sooner = await receive(api, product.id, 'SOON', daysFromToday(30), 5);

  const sale = await call(api, 'sales.create', {
    items: [{ productId: product.id, qty: 7 }],
    paymentMethod: 'cash',
    amountPaid: 2000,
  });
  assert.equal(sale.total, 1750);
  assert.equal(sale.changeGiven, 250);

  const batches = await call(api, 'stock.batches', {});
  assert.equal(batches.find((b) => b.id === sooner.id).onHand, 0);
  assert.equal(batches.find((b) => b.id === later.id).onHand, 3);
  assert.equal(sale.items.length, 2);
  assert.deepEqual(sale.items.map((i) => i.qty), [5, 2]);
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
    cost_price: 100,
    created_at: nowIso(),
    updated_at: nowIso(),
    deleted: 0,
  });
  addMovement(db, { batchId: expired, productId: product.id, qty: 4, type: 'receive' });

  await assert.rejects(
    call(api, 'sales.create', { items: [{ productId: product.id, qty: 1 }], paymentMethod: 'cash', amountPaid: 250 }),
    /Not enough in-date stock/,
  );

  const batches = await call(api, 'stock.batches', { productId: product.id });
  const writeOff = await call(api, 'stock.writeOffExpired', { batchId: expired });
  assert.equal(writeOff.onHand, 0);
  assert.equal(batches[0].status, 'expired');
});

test('a sale that cannot be fully covered leaves stock untouched', async () => {
  const { api } = createDevice();
  await signInAsAdmin(api);
  const product = await addProduct(api);
  const batch = await receive(api, product.id, 'ONLY', daysFromToday(100), 3);

  await assert.rejects(
    call(api, 'sales.create', { items: [{ productId: product.id, qty: 5 }], paymentMethod: 'cash', amountPaid: 9999 }),
    /only 3 available/,
  );
  const [after] = await call(api, 'stock.batches', { productId: product.id });
  assert.equal(after.id, batch.id);
  assert.equal(after.onHand, 3);
});

test('prescription items need the prescription to be verified', async () => {
  const { api } = createDevice();
  await signInAsAdmin(api);
  const product = await addProduct(api, { requiresPrescription: true, name: 'Amoxicillin' });
  await receive(api, product.id, 'RX1', daysFromToday(200), 10);

  await assert.rejects(
    call(api, 'sales.create', { items: [{ productId: product.id, qty: 1 }], paymentMethod: 'cash', amountPaid: 250 }),
    /Verify the prescription/,
  );
  const sale = await call(api, 'sales.create', {
    items: [{ productId: product.id, qty: 1 }],
    paymentMethod: 'cash',
    amountPaid: 250,
    prescriptionVerified: true,
  });
  assert.equal(sale.prescriptionVerified, true);
});

test('discounts and underpayment are checked on the server side', async () => {
  const { api } = createDevice();
  await signInAsAdmin(api);
  const product = await addProduct(api);
  await receive(api, product.id, 'D1', daysFromToday(200), 10);

  const sale = await call(api, 'sales.create', {
    items: [{ productId: product.id, qty: 2 }],
    discount: 100,
    paymentMethod: 'cash',
    amountPaid: 500,
  });
  assert.equal(sale.subtotal, 500);
  assert.equal(sale.total, 400);
  assert.equal(sale.changeGiven, 100);

  await assert.rejects(
    call(api, 'sales.create', { items: [{ productId: product.id, qty: 1 }], paymentMethod: 'cash', amountPaid: 100 }),
    /less than the total/,
  );
  await assert.rejects(
    call(api, 'sales.create', { items: [{ productId: product.id, qty: 1 }], discount: 9999, paymentMethod: 'card' }),
    /Discount must be between/,
  );
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

test('sales summary, top products and CSV reflect completed sales only', async () => {
  const { db, api } = createDevice();
  await signInAsAdmin(api);
  const product = await addProduct(api, { name: 'Vitamin "C", 1000mg' });
  await receive(api, product.id, 'VC', daysFromToday(200), 10);
  await call(api, 'sales.create', { items: [{ productId: product.id, qty: 2 }], paymentMethod: 'cash', amountPaid: 500 });
  const cancelled = await call(api, 'sales.create', { items: [{ productId: product.id, qty: 1 }], paymentMethod: 'cash', amountPaid: 250 });
  await call(api, 'sales.void', { id: cancelled.id, reason: 'Entered by mistake' });

  const range = { from: daysFromToday(-1), to: daysFromToday(0) };
  const summary = await call(api, 'reports.summary', range);
  assert.equal(summary.count, 1);
  assert.equal(summary.revenue, 500);
  assert.equal(summary.unitsSold, 2);

  const top = await call(api, 'reports.topProducts', range);
  assert.equal(top[0].qty, 2);

  const { salesCsv } = require('../electron/services/reports');
  const lines = salesCsv(db, range).split('\n');
  assert.equal(lines[0], 'Invoice,Date,Customer,Cashier,Payment,Subtotal,Discount,Total,Status');
  assert.equal(lines.length, 3); // header + completed sale + voided sale
  assert.match(lines[1], /,5\.00,0\.00,5\.00,completed$/);
  assert.match(lines[2], /,voided$/);
});
