'use strict';

const users = require('./services/users');
const settings = require('./services/settings');
const products = require('./services/products');
const parties = require('./services/parties');
const inventory = require('./services/inventory');
const sales = require('./services/sales');
const reports = require('./services/reports');

const UTF8_BOM = '﻿'; // lets Excel open the CSV with rupee and Devanagari text intact

/** Which roles may perform each guarded action. Reads are open to every signed-in user. */
const PERMISSIONS = {
  'sale.create': ['admin', 'pharmacist', 'cashier'],
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

const CSV_KINDS = {
  sales: { name: 'sales', build: reports.salesCsv },
  gst: { name: 'gst-summary', build: reports.gstCsv },
  register: { name: 'schedule-h-register', build: reports.registerCsv },
};

function can(user, permission) {
  return Boolean(user) && PERMISSIONS[permission]?.includes(user.role);
}

/**
 * Builds the single RPC surface the renderer can call. Every method is listed here,
 * so nothing outside this table is reachable from the UI.
 *   open: true  -> callable before sign-in
 *   perm        -> role permission required (checked in the main process)
 */
function createApi({ db, sync, dialog, fs, getWindow }) {
  const session = { user: null };

  const requireUser = () => {
    if (!session.user) throw new Error('Please sign in first');
    return session.user;
  };
  const sessionInfo = () => ({
    deviceId: settings.getDeviceId(db),
    cashierName: requireUser().name,
    counterCode: settings.getSetting(db, 'counter_code', 'C1'),
  });
  const exportFile = async ({ defaultName, filters, contents }) => {
    const result = await dialog.showSaveDialog(getWindow(), { defaultPath: defaultName, filters });
    if (result.canceled || !result.filePath) return { saved: false };
    await contents(result.filePath);
    return { saved: true, path: result.filePath };
  };

  const routes = {
    'auth.status': {
      open: true,
      run: () => ({ hasUsers: users.hasUsers(db), user: session.user }),
    },
    'auth.setup': {
      open: true,
      run: (a) => {
        session.user = users.setupAdmin(db, a);
        return session.user;
      },
    },
    'auth.login': {
      open: true,
      run: (a) => {
        session.user = users.login(db, a.username, a.password);
        return session.user;
      },
    },
    'auth.logout': {
      open: true,
      run: () => {
        session.user = null;
        return true;
      },
    },

    'users.list': { perm: 'users.manage', run: () => users.listUsers(db) },
    'users.create': { perm: 'users.manage', run: (a) => users.createUser(db, a) },
    'users.update': {
      perm: 'users.manage',
      run: (a) => users.updateUser(db, a, session.user.id),
    },
    'users.resetPassword': {
      perm: 'users.manage',
      run: (a) => users.resetPassword(db, a.id, a.password),
    },

    'settings.get': { run: () => settings.getBusinessSettings(db) },
    'settings.save': {
      perm: 'settings.write',
      run: (a) => settings.saveBusinessSettings(db, a),
    },

    'products.list': { run: (a) => products.listProducts(db, a) },
    'products.getBySku': { run: (a) => products.getProductBySku(db, a.sku) },
    'products.save': { perm: 'catalog.write', run: (a) => products.saveProduct(db, a) },
    'products.remove': { perm: 'catalog.write', run: (a) => products.removeProduct(db, a.id) },

    'customers.list': { run: (a) => parties.listParties(db, 'customers', a.search) },
    'customers.save': { perm: 'parties.write', run: (a) => parties.saveParty(db, 'customers', a) },
    'customers.remove': {
      perm: 'parties.write',
      run: (a) => parties.removeParty(db, 'customers', a.id),
    },
    'suppliers.list': { run: (a) => parties.listParties(db, 'suppliers', a.search) },
    'suppliers.save': { perm: 'catalog.write', run: (a) => parties.saveParty(db, 'suppliers', a) },
    'suppliers.remove': {
      perm: 'catalog.write',
      run: (a) => parties.removeParty(db, 'suppliers', a.id),
    },

    'stock.batches': { run: (a) => inventory.listBatches(db, a) },
    'stock.receive': { perm: 'stock.write', run: (a) => inventory.receiveStock(db, a) },
    'stock.adjust': { perm: 'stock.write', run: (a) => inventory.adjustStock(db, a) },
    'stock.writeOffExpired': {
      perm: 'stock.write',
      run: (a) => inventory.writeOffExpired(db, a.batchId),
    },

    'sales.create': { perm: 'sale.create', run: (a) => sales.createSale(db, a, sessionInfo()) },
    'sales.list': { run: (a) => sales.listSales(db, a) },
    'sales.get': { run: (a) => sales.getSale(db, a.id) },
    'sales.void': { perm: 'sale.void', run: (a) => sales.voidSale(db, a.id, a.reason) },

    'dashboard.stats': { run: () => reports.dashboardStats(db) },

    'reports.summary': { perm: 'reports.view', run: (a) => reports.salesSummary(db, a) },
    'reports.topProducts': { perm: 'reports.view', run: (a) => reports.topProducts(db, a) },
    'reports.dailySales': { perm: 'reports.view', run: (a) => reports.dailySales(db, a) },
    'reports.gstSummary': { perm: 'reports.view', run: (a) => reports.gstSummary(db, a) },
    'reports.scheduleRegister': {
      perm: 'reports.view',
      run: (a) => reports.scheduleRegister(db, a),
    },
    'reports.exportCsv': {
      perm: 'data.export',
      run: (a) => {
        const kind = CSV_KINDS[a.kind] ?? CSV_KINDS.sales;
        return exportFile({
          defaultName: `${kind.name}-${a.from}-to-${a.to}.csv`,
          filters: [{ name: 'CSV', extensions: ['csv'] }],
          contents: async (file) => fs.writeFile(file, UTF8_BOM + kind.build(db, a), 'utf8'),
        });
      },
    },
    'backup.create': {
      perm: 'data.export',
      run: () =>
        exportFile({
          defaultName: `pharmacy-backup-${new Date().toISOString().slice(0, 10)}.db`,
          filters: [{ name: 'Database', extensions: ['db'] }],
          contents: (file) => db.backup(file),
        }),
    },

    'sync.status': { run: () => sync.status() },
    'sync.configure': { perm: 'sync.manage', run: (a) => sync.configure(a) },
    'sync.now': { run: () => sync.syncNow() },
  };

  async function call(method, args = {}) {
    const route = routes[method];
    if (!route) return { ok: false, error: `Unknown action: ${method}` };
    if (!route.open && !session.user) return { ok: false, error: 'Please sign in first' };
    if (route.perm && !can(session.user, route.perm)) {
      return { ok: false, error: 'Your role is not allowed to do this' };
    }
    try {
      return { ok: true, data: await route.run(args ?? {}) };
    } catch (err) {
      return { ok: false, error: err.message || 'Something went wrong' };
    }
  }

  return { call, session, PERMISSIONS };
}

module.exports = { createApi, PERMISSIONS, can };
