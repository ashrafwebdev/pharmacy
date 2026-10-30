'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { openDatabase } = require('../src/db');
const { createApp, parseBranchKeys } = require('../src/app');

const KEYS = parseBranchKeys('main:secret-main,north:secret-north');

let server;
let base;

before(async () => {
  const app = createApp({ db: openDatabase(':memory:'), keys: KEYS });
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => new Promise((resolve) => server.close(resolve)));

async function request(path, { key = 'secret-main', method = 'GET', body } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

function product(id, name, updatedAt) {
  return {
    table: 'products',
    id,
    updated_at: updatedAt,
    deleted: false,
    data: { id, name, updated_at: updatedAt, deleted: 0 },
  };
}

test('rejects requests without a valid branch API key', async () => {
  assert.equal((await request('/api/sync/pull', { key: 'wrong' })).status, 401);
  const res = await fetch(`${base}/api/sync/pull`);
  assert.equal(res.status, 401);
});

test('push stores records and pull returns them with a cursor', async () => {
  const pushed = await request('/api/sync/push', {
    method: 'POST',
    body: {
      deviceId: 'device-a',
      records: [
        product('p1', 'Paracetamol', '2026-10-01T10:00:00.000Z'),
        product('p2', 'Ibuprofen', '2026-10-01T10:00:00.000Z'),
      ],
    },
  });
  assert.equal(pushed.status, 200);
  assert.equal(pushed.body.accepted.length, 2);

  const pulled = await request('/api/sync/pull?since=0');
  assert.equal(pulled.status, 200);
  assert.deepEqual(pulled.body.records.map((r) => r.id), ['p1', 'p2']);
  assert.equal(pulled.body.records[0].data.name, 'Paracetamol');
  assert.equal(pulled.body.hasMore, false);

  const again = await request(`/api/sync/pull?since=${pulled.body.cursor}`);
  assert.deepEqual(again.body.records, []);
  assert.equal(again.body.cursor, pulled.body.cursor);
});

test('last write wins: an older update does not overwrite a newer one', async () => {
  await request('/api/sync/push', {
    method: 'POST',
    body: {
      deviceId: 'device-a',
      records: [product('lww', 'Newer name', '2026-10-02T10:00:00.000Z')],
    },
  });
  await request('/api/sync/push', {
    method: 'POST',
    body: {
      deviceId: 'device-b',
      records: [product('lww', 'Older name', '2026-10-01T10:00:00.000Z')],
    },
  });
  const pulled = await request('/api/sync/pull?since=0');
  const record = pulled.body.records.find((r) => r.id === 'lww');
  assert.equal(record.data.name, 'Newer name');
});

test('pull pages through records with hasMore', async () => {
  const before = await request('/api/sync/pull?since=0&limit=1000');
  const records = ['pg1', 'pg2', 'pg3'].map((id) =>
    product(id, id, '2026-10-03T10:00:00.000Z'),
  );
  await request('/api/sync/push', { method: 'POST', body: { deviceId: 'd', records } });

  const first = await request(`/api/sync/pull?since=${before.body.cursor}&limit=2`);
  assert.deepEqual(first.body.records.map((r) => r.id), ['pg1', 'pg2']);
  assert.equal(first.body.hasMore, true);

  const second = await request(`/api/sync/pull?since=${first.body.cursor}&limit=2`);
  assert.deepEqual(second.body.records.map((r) => r.id), ['pg3']);
  assert.equal(second.body.hasMore, false);
});

test('branches are isolated from each other', async () => {
  const north = await request('/api/sync/pull?since=0', { key: 'secret-north' });
  assert.deepEqual(north.body.records, []);
});

test('rejects malformed pushes', async () => {
  const bad = await request('/api/sync/push', {
    method: 'POST',
    body: {
      deviceId: 'device-a',
      records: [{ table: 'users', id: 'x', updated_at: 'now', data: {} }],
    },
  });
  assert.equal(bad.status, 400);
});

test('summary totals completed sales inside the requested window', async () => {
  const sale = (id, total, status) => ({
    table: 'sales',
    id,
    updated_at: '2026-10-05T12:00:00.000Z',
    deleted: false,
    data: { id, total, status, created_at: '2026-10-05T12:00:00.000Z' },
  });
  await request('/api/sync/push', {
    method: 'POST',
    body: {
      deviceId: 'device-a',
      records: [sale('s1', 1000, 'completed'), sale('s2', 500, 'voided')],
    },
  });
  const summary = await request(
    '/api/summary?from=2026-10-01T00:00:00.000Z&to=2026-11-01T00:00:00.000Z',
  );
  assert.equal(summary.status, 200);
  assert.equal(summary.body.sales, 1);
  assert.equal(summary.body.revenue, 1000);
});
