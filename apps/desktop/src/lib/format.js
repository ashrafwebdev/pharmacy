/** Money is stored in paise. Indian grouping (1,23,45,678.00) comes from the en-IN locale. */
const rupeeFormatter = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatRupees(paise) {
  return rupeeFormatter.format((paise ?? 0) / 100);
}

/** Parses a typed rupee amount ("12.5", "1,200") into paise. Returns NaN when invalid. */
export function toPaise(text) {
  const value = Number(String(text ?? '').replace(/,/g, '').trim());
  return Number.isFinite(value) && value >= 0 ? Math.round(value * 100) : NaN;
}

export function fromPaise(paise) {
  return ((paise ?? 0) / 100).toFixed(2);
}

export function formatDate(value) {
  return value ? new Date(value).toLocaleDateString('en-IN') : '—';
}

export function formatDateTime(value) {
  return value ? new Date(value).toLocaleString('en-IN') : '—';
}

export function localDateString(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function daysAgo(days) {
  return localDateString(new Date(Date.now() - days * 86_400_000));
}

export const GST_RATES = [0, 5, 12, 18, 28];
export const SCHEDULES = [
  { value: 'OTC', label: 'OTC (no prescription)' },
  { value: 'H', label: 'Schedule H (prescription)' },
  { value: 'H1', label: 'Schedule H1 (prescription + register)' },
  { value: 'X', label: 'Schedule X (narcotic-type, prescription)' },
];

export const STATUS_LABELS = {
  expired: 'Expired',
  expiring: 'Expiring soon',
  ok: 'In date',
};

export const PAYMENT_LABELS = {
  cash: 'Cash',
  upi: 'UPI',
  card: 'Card',
  credit: 'Credit (udhaar)',
};
