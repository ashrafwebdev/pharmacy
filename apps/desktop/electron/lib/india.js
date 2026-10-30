'use strict';

/** India-specific rules: GST, drug schedules, financial year, GSTIN and amounts in words. */

const GST_RATES = [0, 5, 12, 18, 28];
const SCHEDULES = ['OTC', 'H', 'H1', 'X'];
const PRESCRIPTION_SCHEDULES = ['H', 'H1', 'X'];
const PAYMENT_METHODS = ['cash', 'upi', 'card', 'credit'];
const GSTIN_PATTERN = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const HSN_PATTERN = /^\d{4}(\d{2}(\d{2})?)?$/;

function isGstin(value) {
  return GSTIN_PATTERN.test(value);
}

function isHsn(value) {
  return HSN_PATTERN.test(value);
}

/** Schedule H, H1 and X medicines may only be sold against a prescription. */
function needsPrescription(schedule) {
  return PRESCRIPTION_SCHEDULES.includes(schedule);
}

/** Indian financial year runs 1 April to 31 March. 2026-10-30 -> "26-27". */
function financialYear(date) {
  const year = date.getFullYear();
  const startYear = date.getMonth() + 1 >= 4 ? year : year - 1;
  return `${String(startYear).slice(-2)}-${String(startYear + 1).slice(-2)}`;
}

/**
 * MRP already includes GST. Splits a GST-inclusive amount (in paise) into the
 * taxable value and equal CGST/SGST halves (intra-state retail sale).
 */
function splitInclusiveGst(amount, rate) {
  const taxable = Math.round((amount * 100) / (100 + rate));
  const gst = amount - taxable;
  const cgst = Math.floor(gst / 2);
  return { taxable, cgst, sgst: gst - cgst };
}

/** Rounds paise to the nearest rupee, as printed on Indian bills. */
function roundToRupee(paise) {
  return Math.round(paise / 100) * 100;
}

const ONES = [
  '', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
  'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen',
];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function twoDigitWords(n) {
  if (n < 20) return ONES[n];
  return TENS[Math.floor(n / 10)] + (n % 10 ? ` ${ONES[n % 10]}` : '');
}

function threeDigitWords(n) {
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  return [hundreds ? `${ONES[hundreds]} Hundred` : '', rest ? twoDigitWords(rest) : '']
    .filter(Boolean)
    .join(' ');
}

function integerWords(n) {
  if (n === 0) return '';
  const parts = [];
  let rest = n;
  const crore = Math.floor(rest / 1e7);
  rest %= 1e7;
  if (crore) parts.push(`${integerWords(crore)} Crore`);
  const lakh = Math.floor(rest / 1e5);
  rest %= 1e5;
  if (lakh) parts.push(`${twoDigitWords(lakh)} Lakh`);
  const thousand = Math.floor(rest / 1000);
  rest %= 1000;
  if (thousand) parts.push(`${twoDigitWords(thousand)} Thousand`);
  if (rest) parts.push(threeDigitWords(rest));
  return parts.join(' ');
}

/** Amount in paise -> "Rupees One Thousand Five Hundred Only" (Indian bill wording). */
function rupeesInWords(paise) {
  const rupees = Math.floor(paise / 100);
  const paisa = paise % 100;
  if (rupees === 0 && paisa === 0) return 'Rupees Zero Only';
  const rupeeText = rupees ? `Rupees ${integerWords(rupees)}` : 'Rupees';
  const paisaText = paisa ? ` and ${twoDigitWords(paisa)} Paise` : '';
  return `${rupeeText}${paisaText} Only`;
}

module.exports = {
  GST_RATES,
  SCHEDULES,
  PRESCRIPTION_SCHEDULES,
  PAYMENT_METHODS,
  isGstin,
  isHsn,
  needsPrescription,
  financialYear,
  splitInclusiveGst,
  roundToRupee,
  rupeesInWords,
};
