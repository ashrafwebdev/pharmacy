'use strict';

const path = require('node:path');
const fs = require('node:fs/promises');
const { app, BrowserWindow, ipcMain, dialog, net, protocol, safeStorage, shell } = require('electron');
const { pathToFileURL } = require('node:url');
const { openDatabase } = require('./lib/db');
const { createApi } = require('./ipc');
const { createSyncService } = require('./services/sync');

const AUTO_SYNC_INTERVAL_MS = 60_000;
const DIST_DIR = path.join(__dirname, '..', 'dist');
const APP_URL = 'app://pharmacy/index.html';

// Chromium blocks ES module scripts on file:// pages, so the packaged UI is served from
// a privileged app:// origin instead. The scheme must be registered before app is ready.
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

function serveDistFile(request) {
  const requested = path.resolve(DIST_DIR, `.${decodeURIComponent(new URL(request.url).pathname)}`);
  const inside = requested === DIST_DIR || requested.startsWith(DIST_DIR + path.sep);
  if (!inside) return new Response('Not found', { status: 404 });
  return net.fetch(pathToFileURL(requested).toString());
}

// API keys are encrypted with the OS credential store (DPAPI on Windows).
const secrets = {
  encrypt(text) {
    if (safeStorage.isEncryptionAvailable()) {
      return `safe:${safeStorage.encryptString(text).toString('base64')}`;
    }
    return `plain:${text}`;
  },
  decrypt(value) {
    if (value.startsWith('safe:')) {
      return safeStorage.decryptString(Buffer.from(value.slice(5), 'base64'));
    }
    return value.slice('plain:'.length);
  },
};

let mainWindow = null;
let db = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1366,
    height: 860,
    minWidth: 1100,
    minHeight: 700,
    title: 'Pharmacy Suite',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // The UI must never navigate away or open extra windows.
  mainWindow.webContents.on('will-navigate', (event) => event.preventDefault());
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  if (!app.isPackaged && process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadURL(APP_URL);
  }
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function start() {
  protocol.handle('app', serveDistFile);
  db = openDatabase(path.join(app.getPath('userData'), 'pharmacy.db'));
  const sync = createSyncService({ db, secrets, fetchImpl: globalThis.fetch });
  const api = createApi({
    db,
    sync,
    dialog,
    fs,
    getWindow: () => mainWindow,
  });

  ipcMain.handle('pharmacy:call', (_event, method, args) => api.call(method, args));

  createWindow();

  // Background sync: runs quietly when the server is reachable and does nothing otherwise.
  const runAutoSync = () => {
    if (sync.isConfigured()) sync.syncNow();
  };
  setTimeout(runAutoSync, 10_000);
  setInterval(runAutoSync, AUTO_SYNC_INTERVAL_MS);
}

const hasLock = app.requestSingleInstanceLock();
if (!hasLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(start);

  app.on('window-all-closed', () => {
    if (db) db.close();
    app.quit();
  });
}
