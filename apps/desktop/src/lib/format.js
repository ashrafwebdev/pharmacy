export function formatMoney(cents, currency = 'USD') {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format((cents ?? 0) / 100);
  } catch {
    return `${((cents ?? 0) / 100).toFixed(2)} ${currency}`;
  }
}

/** Parses a typed amount ("12.5", "1,200") into integer cents. Returns NaN when invalid. */
export function toCents(text) {
  const value = Number(String(text ?? '').replace(/,/g, '').trim());
  return Number.isFinite(value) && value >= 0 ? Math.round(value * 100) : NaN;
}

export function fromCents(cents) {
  return ((cents ?? 0) / 100).toFixed(2);
}

export function formatDate(value) {
  return value ? new Date(value).toLocaleDateString() : '—';
}

export function formatDateTime(value) {
  return value ? new Date(value).toLocaleString() : '—';
}

export function localDateString(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function daysAgo(days) {
  return localDateString(new Date(Date.now() - days * 86_400_000));
}

export const STATUS_LABELS = {
  expired: 'Expired',
  expiring: 'Expiring soon',
  ok: 'In date',
};

export const PAYMENT_LABELS = {
  cash: 'Cash',
  card: 'Card',
  mobile: 'Mobile',
};
