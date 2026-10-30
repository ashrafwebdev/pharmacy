'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const india = require('../electron/lib/india');

test('GST is split out of a GST-inclusive MRP and the parts add up', () => {
  // Rs 112 inclusive of 12% GST: taxable Rs 100, GST Rs 12 (CGST 6 + SGST 6).
  assert.deepEqual(india.splitInclusiveGst(11200, 12), { taxable: 10000, cgst: 600, sgst: 600 });
  // Whatever the rounding, the taxable value and both halves always add back to the amount.
  for (const amount of [10001, 10003, 99999]) {
    const split = india.splitInclusiveGst(amount, 18);
    assert.equal(split.taxable + split.cgst + split.sgst, amount);
    assert.ok(split.sgst >= split.cgst);
  }
  // 0% rate: nothing is taxed.
  assert.deepEqual(india.splitInclusiveGst(5000, 0), { taxable: 5000, cgst: 0, sgst: 0 });
});

test('bills round to the nearest rupee', () => {
  assert.equal(india.roundToRupee(12349), 12300);
  assert.equal(india.roundToRupee(12350), 12400);
  assert.equal(india.roundToRupee(12000), 12000);
});

test('financial year runs April to March', () => {
  assert.equal(india.financialYear(new Date(2026, 3, 1)), '26-27');
  assert.equal(india.financialYear(new Date(2026, 2, 31)), '25-26');
  assert.equal(india.financialYear(new Date(2026, 9, 30)), '26-27');
});

test('GSTIN and HSN formats are validated', () => {
  assert.equal(india.isGstin('27AAAAA0000A1Z5'), true);
  assert.equal(india.isGstin('27aaaaa0000a1z5'), false);
  assert.equal(india.isGstin('27AAAAA0000A1Z'), false);
  assert.equal(india.isHsn('3004'), true);
  assert.equal(india.isHsn('300490'), true);
  assert.equal(india.isHsn('30049'), false);
});

test('Schedule H, H1 and X need a prescription; OTC does not', () => {
  assert.equal(india.needsPrescription('OTC'), false);
  for (const schedule of ['H', 'H1', 'X']) assert.equal(india.needsPrescription(schedule), true);
});

test('amounts are written in Indian wording', () => {
  assert.equal(india.rupeesInWords(150000), 'Rupees One Thousand Five Hundred Only');
  assert.equal(india.rupeesInWords(0), 'Rupees Zero Only');
  assert.equal(india.rupeesInWords(4550), 'Rupees Forty Five and Fifty Paise Only');
  assert.equal(
    india.rupeesInWords(12345678 * 100),
    'Rupees One Crore Twenty Three Lakh Forty Five Thousand Six Hundred Seventy Eight Only',
  );
  assert.equal(india.rupeesInWords(100000 * 100), 'Rupees One Lakh Only');
});
