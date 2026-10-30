/** Calls the main process through the preload bridge and unwraps the result. */
export async function call(method, args = {}) {
  if (!window.pharmacy) throw new Error('This screen must run inside Pharmacy Suite');
  const res = await window.pharmacy.call(method, args);
  if (!res.ok) throw new Error(res.error);
  return res.data;
}

const PERMISSIONS = {
  'sale.void': ['admin', 'pharmacist'],
  'parties.write': ['admin', 'pharmacist', 'cashier'],
  'catalog.write': ['admin', 'pharmacist'],
  'stock.write': ['admin', 'pharmacist'],
  'reports.view': ['admin', 'pharmacist'],
  'data.export': ['admin', 'pharmacist'],
  'settings.write': ['admin'],
  'users.manage': ['admin'],
  'sync.manage': ['admin'],
};

/** UI-only convenience: the main process enforces the same rules on every call. */
export function can(user, permission) {
  return Boolean(user) && (PERMISSIONS[permission]?.includes(user.role) ?? false);
}
