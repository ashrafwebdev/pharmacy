'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { openDatabase } = require('../electron/lib/db');
const { createApi } = require('../electron/ipc');
const { createSyncService } = require('../electron/services/sync');
const { localDate } = require('../electron/lib/util');
// The desktop sync is tested against the real sync server implementation.
const { createApp, parseBranchKeys } = require('../../server/src/app');
const { openDatabase: openServerDatabase } = require('../../server/src/db');

const BRANCH_SECRET = 'branch-secret-for-tests';
const expiry = localDate(new Date(Date.now() + 200 * 86_400_000));

let server;
let serverUrl;

before(async () => {
  const app = createApp({
    db: openServerDatabase(':memory:'),
    keys: parseBranchKeys(`main:${BRANCH_SECRET}`),
  });
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  serverUrl = `http://127.0.0.1:${server.address().port}`;
});

after(() => new Promise((resolve) => server.close(resolve)));

function createDevice(name, url = serverUrl) {
  const db = openDatabase(':memory:');
  const sync = createSyncService({ db, fetchImpl: globalThis.fetch });
  const api = createApi({ db, sync, dialog: null, fs: null, getWindow: () => null });
  sync.configure({ url, apiKey: BRANCH_SECRET, deviceName: name, enabled: true });
  return { name, db, sync, api };
}

async function call(api, method, args = {}) {
  const res = await api.call(method, args);
  if (!res.ok) throw new Error(`${method} failed: ${res.error}`);
  return res.data;
}

async function stockOf(device, productId) {
  const products = await call(device.api, 'products.list', { search: '' });
  return products.find((p) => p.id === productId).onHand;
}

test('two branches converge through the server', async () => {
  const counter = createDevice('Front desk');
  const branch = createDevice('Branch 2');
  await call(counter.api, 'auth.setup', { username: 'owner', name: 'Owner', password: 'password123' });
  await call(branch.api, 'auth.setup', { username: 'owner', name: 'Owner', password: 'password123' });

  const product = await call(counter.api, 'products.save', {
    name: 'Amoxicillin 250mg',
    sku: '890200000002',
    unitPrice: 400,
    costPrice: 200,
    reorderLevel: 5,
    requiresPrescription: false,
  });
  await call(counter.api, 'stock.receive', {
    productId: product.id,
    batchNo: 'AMX-01',
    expiryDate: expiry,
    qty: 10,
    costPrice: 200,
  });
  await call(counter.api, 'sales.create', {
    items: [{ productId: product.id, qty: 3 }],
    paymentMethod: 'cash',
    amountPaid: 1200,
  });

  const pushed = await counter.sync.syncNow();
  assert.equal(pushed.ok, true, pushed.error);
  assert.equal(counter.sync.pendingCount(), 0);

  const pulled = await branch.sync.syncNow();
  assert.equal(pulled.ok, true, pulled.error);
  assert.equal(await stockOf(branch, product.id), 7);

  const today = localDate();
  const sales = await call(branch.api, 'sales.list', { from: today, to: today });
  assert.equal(sales.length, 1);
  assert.equal(sales[0].total, 1200);

  // The branch sells from the synced stock; the counter receives that sale back.
  await call(branch.api, 'sales.create', {
    items: [{ productId: product.id, qty: 2 }],
    paymentMethod: 'card',
  });
  await branch.sync.syncNow();
  await counter.sync.syncNow();
  assert.equal(await stockOf(counter, product.id), 5);
  assert.equal(await stockOf(branch, product.id), 5);
});

test('an offline branch keeps selling and syncs once the server is back', async () => {
  const offline = createDevice('Offline branch', 'http://127.0.0.1:1');
  await call(offline.api, 'auth.setup', { username: 'owner', name: 'Owner', password: 'password123' });

  const product = await call(offline.api, 'products.save', {
    name: 'Cetirizine 10mg',
    sku: '890300000003',
    unitPrice: 150,
    costPrice: 60,
  });
  await call(offline.api, 'stock.receive', {
    productId: product.id,
    batchNo: 'CTZ-7',
    expiryDate: expiry,
    qty: 20,
    costPrice: 60,
  });
  await call(offline.api, 'sales.create', {
    items: [{ productId: product.id, qty: 4 }],
    paymentMethod: 'cash',
    amountPaid: 600,
  });

  const failed = await offline.sync.syncNow();
  assert.equal(failed.ok, false);
  assert.equal(failed.kind, 'offline');
  assert.equal(await stockOf(offline, product.id), 16, 'local sales are not blocked by sync failures');
  assert.ok(offline.sync.pendingCount() > 0);
  assert.equal(offline.sync.status().lastError, failed.error);

  // Reconnect: point the same installation at the working server.
  offline.sync.configure({ url: serverUrl, apiKey: BRANCH_SECRET, enabled: true });
  const synced = await offline.sync.syncNow();
  assert.equal(synced.ok, true, synced.error);
  assert.equal(offline.sync.pendingCount(), 0);
  assert.equal(offline.sync.status().lastError, null);

  const viewer = createDevice('Viewer');
  await call(viewer.api, 'auth.setup', { username: 'owner', name: 'Owner', password: 'password123' });
  await viewer.sync.syncNow();
  assert.equal(await stockOf(viewer, product.id), 16);
});

test('sync is skipped when not configured and rejects a wrong key', async () => {
  const idle = openDatabase(':memory:');
  const sync = createSyncService({ db: idle, fetchImpl: globalThis.fetch });
  const skipped = await sync.syncNow();
  assert.equal(skipped.ok, false);
  assert.equal(skipped.skipped, true);

  sync.configure({ url: serverUrl, apiKey: 'not-the-right-key', enabled: true });
  const rejected = await sync.syncNow();
  assert.equal(rejected.ok, false);
  assert.equal(rejected.kind, 'auth');
});

test('status reports that a key exists without returning it to the UI', async () => {
  const device = createDevice('Secrets');
  const status = device.sync.status();
  assert.equal(status.hasApiKey, true);
  assert.equal(JSON.stringify(status).includes(BRANCH_SECRET), false);
});
