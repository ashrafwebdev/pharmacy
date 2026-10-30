'use strict';

const { writeRow, getRow } = require('../lib/db');
const { newId, nowIso, cleanText } = require('../lib/util');

const TABLES = {
  customers: 'customers',
  suppliers: 'suppliers',
};

function tableFor(kind) {
  const table = TABLES[kind];
  if (!table) throw new Error(`Unknown party type: ${kind}`);
  return table;
}

function mapParty(row) {
  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    email: row.email,
    address: row.address,
    notes: row.notes,
  };
}

function listParties(db, kind, search = '') {
  const table = tableFor(kind);
  const term = `%${cleanText(search)}%`;
  return db.prepare(`
    SELECT * FROM ${table}
    WHERE deleted = 0 AND (name LIKE @term OR phone LIKE @term)
    ORDER BY name LIMIT 300
  `).all({ term }).map(mapParty);
}

function saveParty(db, kind, input) {
  const table = tableFor(kind);
  const name = cleanText(input.name);
  if (!name) throw new Error('Name is required');
  const existing = input.id ? getRow(db, table, input.id) : null;
  if (input.id && (!existing || existing.deleted)) throw new Error('Record not found');

  const now = nowIso();
  const id = existing?.id ?? newId();
  writeRow(db, table, {
    id,
    name,
    phone: cleanText(input.phone) || null,
    email: cleanText(input.email) || null,
    address: cleanText(input.address) || null,
    notes: cleanText(input.notes) || null,
    created_at: existing?.created_at ?? now,
    updated_at: now,
    deleted: 0,
  });
  return mapParty(getRow(db, table, id));
}

function removeParty(db, kind, id) {
  const table = tableFor(kind);
  const existing = getRow(db, table, id);
  if (!existing || existing.deleted) throw new Error('Record not found');
  writeRow(db, table, { ...existing, deleted: 1, updated_at: nowIso() });
  return true;
}

module.exports = { listParties, saveParty, removeParty };
