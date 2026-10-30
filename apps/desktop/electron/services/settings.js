'use strict';

const { newId } = require('../lib/util');

function getSetting(db, key, fallback = null) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : fallback;
}

function setSetting(db, key, value) {
  db.prepare(`
    INSERT INTO settings (key, value) VALUES (?, ?)
    ON CONFLICT (key) DO UPDATE SET value = excluded.value
  `).run(key, String(value));
}

function isValidCurrency(code) {
  try {
    new Intl.NumberFormat('en-US', { style: 'currency', currency: code });
    return /^[A-Z]{3}$/.test(code);
  } catch {
    return false;
  }
}

function getBusinessSettings(db) {
  return {
    pharmacyName: getSetting(db, 'pharmacy_name', 'My Pharmacy'),
    currency: getSetting(db, 'currency', 'USD'),
    receiptFooter: getSetting(db, 'receipt_footer', 'Thank you for your visit'),
    expiryWarningDays: Number(getSetting(db, 'expiry_warning_days', '90')),
  };
}

function saveBusinessSettings(db, input) {
  const name = String(input.pharmacyName ?? '').trim();
  const currency = String(input.currency ?? '').trim().toUpperCase();
  const days = Number(input.expiryWarningDays);
  if (!name) throw new Error('Pharmacy name is required');
  if (!isValidCurrency(currency)) throw new Error('Currency must be a 3-letter code such as USD');
  if (!Number.isInteger(days) || days < 1 || days > 730) {
    throw new Error('Expiry warning must be between 1 and 730 days');
  }
  setSetting(db, 'pharmacy_name', name);
  setSetting(db, 'currency', currency);
  setSetting(db, 'receipt_footer', String(input.receiptFooter ?? '').trim());
  setSetting(db, 'expiry_warning_days', days);
  return getBusinessSettings(db);
}

/** A stable random id per installation, used to number invoices without collisions. */
function getDeviceId(db) {
  let deviceId = getSetting(db, 'device_id');
  if (!deviceId) {
    deviceId = newId();
    setSetting(db, 'device_id', deviceId);
  }
  return deviceId;
}

module.exports = {
  getSetting,
  setSetting,
  getBusinessSettings,
  saveBusinessSettings,
  getDeviceId,
};
