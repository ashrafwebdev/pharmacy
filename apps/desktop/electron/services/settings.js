'use strict';

const { newId, cleanText } = require('../lib/util');
const { isGstin } = require('../lib/india');

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

function getBusinessSettings(db) {
  return {
    pharmacyName: getSetting(db, 'pharmacy_name', 'My Pharmacy'),
    address: getSetting(db, 'address', ''),
    phone: getSetting(db, 'phone', ''),
    gstin: getSetting(db, 'gstin', ''),
    drugLicence20: getSetting(db, 'drug_licence_20', ''),
    drugLicence21: getSetting(db, 'drug_licence_21', ''),
    pharmacistName: getSetting(db, 'pharmacist_name', ''),
    pharmacistRegNo: getSetting(db, 'pharmacist_reg_no', ''),
    receiptFooter: getSetting(db, 'receipt_footer', 'Thank you. Get well soon!'),
    expiryWarningDays: Number(getSetting(db, 'expiry_warning_days', '90')),
    // Per till: each till numbers its own invoices, so codes must differ between tills (C1, C2, ...).
    counterCode: getSetting(db, 'counter_code', 'C1'),
  };
}

function saveBusinessSettings(db, input) {
  const name = cleanText(input.pharmacyName);
  const gstin = cleanText(input.gstin).toUpperCase();
  const days = Number(input.expiryWarningDays);
  const counterCode = cleanText(input.counterCode).toUpperCase();
  if (!name) throw new Error('Pharmacy name is required');
  if (gstin && !isGstin(gstin)) throw new Error('GSTIN must be 15 characters, for example 27AAAAA0000A1Z5');
  if (!Number.isInteger(days) || days < 1 || days > 730) {
    throw new Error('Expiry warning must be between 1 and 730 days');
  }
  if (!/^[A-Z0-9-]{1,12}$/.test(counterCode)) {
    throw new Error('Counter code can use letters, numbers and dashes (max 12), for example C1');
  }
  const values = {
    pharmacy_name: name,
    address: cleanText(input.address),
    phone: cleanText(input.phone),
    gstin,
    drug_licence_20: cleanText(input.drugLicence20),
    drug_licence_21: cleanText(input.drugLicence21),
    pharmacist_name: cleanText(input.pharmacistName),
    pharmacist_reg_no: cleanText(input.pharmacistRegNo),
    receipt_footer: cleanText(input.receiptFooter),
    expiry_warning_days: days,
    counter_code: counterCode,
  };
  for (const [key, value] of Object.entries(values)) setSetting(db, key, value);
  return getBusinessSettings(db);
}

/** A stable random id per installation, used to tell devices apart in sync. */
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
