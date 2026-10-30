# Pharmacy Suite

An end-to-end pharmacy shop system for Windows.

- **Desktop app (Windows, Electron)** — point of sale, medicine catalogue, batch and expiry tracking,
  purchasing, customers and suppliers, reports, staff accounts, receipts, backups.
- **Works fully offline.** All data lives in a local SQLite database on the shop computer.
- **Optional cloud sync.** When the internet is available, each shop uploads its changes to a central
  server and downloads changes from other branches. When it is not, the shop keeps selling and syncs later.
- **Sync server (Node.js + SQLite)** — a small web service that stores each branch's data separately and
  offers a sales summary endpoint.

```
pharmacy/
├── apps/
│   ├── desktop/          Electron + React app (Windows installer built from here)
│   │   ├── electron/     Main process: database, business services, sync, IPC
│   │   ├── src/          React UI (renderer)
│   │   └── test/         Business-rule and sync tests
│   └── server/           Central sync server (Express + SQLite) and its tests
└── .github/workflows/    CI: runs tests, builds the Windows installer
```

## Features

| Area | What it does |
| --- | --- |
| **Sell (POS)** | Search by name or scan a barcode (Enter adds it). Quantities, discounts, cash/card/mobile, change calculation, customer optional, printable receipt. |
| **Expiry-safe stock** | Every unit belongs to a batch with an expiry date. Sales use the earliest-expiring batch first (FEFO) and never sell expired stock. |
| **Stock & batches** | Receive stock per batch with supplier and cost, adjust with a reason, write off expired batches. Stock is a movement ledger, so every change is traceable. |
| **Prescriptions** | Mark items as prescription-only. The sale cannot complete until the cashier confirms the prescription is verified. |
| **Products** | Name, generic name, barcode, category, maker, selling and cost price, reorder level. Duplicate barcodes are rejected. |
| **Dashboard** | Today's sales, low stock, expired and soon-to-expire batches. |
| **Reports** | Date-range summary, daily sales, top products, sales history, void a sale (returns the stock), CSV export. |
| **People** | Customers and suppliers. |
| **Staff** | Admin, pharmacist and cashier roles. Enforced in the main process, not only in the UI. |
| **Backups** | One-click database backup to any folder. |
| **Sync** | Automatic every minute when configured, manual "Sync now", status indicator in the top bar. |

## Quick start (development)

Requirements: Node.js 22 and Windows or Linux for development (the installer targets Windows).

```bash
# 1. Sync server (optional for local use)
cd apps/server
npm install
BRANCH_KEYS="main:change-this-to-a-long-random-secret" npm start

# 2. Desktop app
cd apps/desktop
npm install
npm run rebuild      # rebuilds the SQLite module for Electron (needed once after npm install)
npm start            # builds the UI and launches the app
```

On first launch the app asks you to create the owner (admin) account.

### Running the tests

```bash
cd apps/server  && npm test   # sync protocol: auth, push, pull, last-write-wins, paging, branches
cd apps/desktop && npm test   # business rules, FEFO allocation, voids, roles, and two-device sync
```

The desktop tests run the real sync server in-process, so they cover a branch going offline, selling,
reconnecting, and converging with another branch.

## Building the Windows installer

```bash
cd apps/desktop
npm ci
npm run dist         # writes release/Pharmacy Suite Setup x.y.z.exe
```

The GitHub Actions workflow in `.github/workflows/build.yml` runs the tests on every push and builds the
installer on a Windows runner, uploading it as an artifact.

Before distributing, add your own `build/icon.ico` (256×256) and configure code signing in
`apps/desktop/electron-builder.yml` (electron-builder's `win.certificateFile` options) so Windows
SmartScreen does not warn users.

## Deploying the sync server

The server accepts sync traffic from each branch, identified by an API key. Keys are configured through
`BRANCH_KEYS`:

```
BRANCH_KEYS="main-street:long-random-secret-1,north-branch:long-random-secret-2"
```

Run it with Docker:

```bash
cd apps/server
docker build -t pharmacy-sync .
docker run -d -p 8080:8080 \
  -e BRANCH_KEYS="main-street:long-random-secret-1" \
  -v pharmacy-data:/data \
  pharmacy-sync
```

Put it behind HTTPS (for example a reverse proxy such as Caddy or nginx) before using it over the internet,
since API keys travel in the `Authorization` header.

Endpoints:

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/health` | Liveness check (no key needed) |
| POST | `/api/sync/push` | Branch uploads changed rows |
| GET | `/api/sync/pull?since=&limit=` | Branch downloads changes after its cursor |
| GET | `/api/summary?from=&to=` | Completed sales count and revenue for the branch |

In the desktop app, enter the server address and branch key under **Settings → Cloud sync** and tick
**Enable sync**. The key is stored encrypted with Windows DPAPI (`safeStorage`).

## How sync works

- **Offline first.** Every write goes to the local database immediately. Sync never blocks a sale.
- **Changes are tracked per row.** Each synced row carries `updated_at`, a soft-delete flag and a `dirty`
  flag. A cycle pushes dirty rows, then pulls everything the server has after this shop's cursor.
- **Stock cannot conflict.** Stock is an append-only ledger of movements (receive, sale, void, adjust,
  expired), never a counter that two offline devices could overwrite. Two branches can each sell from
  the same batch while offline and both sales are kept.
- **Other records use last-write-wins** on `updated_at`. Sales are not edited after completion (a void
  adds a status change plus reversing movements), so conflicts there are rare.
- **No foreign-key constraints in the local database.** Synced rows can arrive in any order.
- **Unknown fields are ignored.** Older desktop versions can read rows from newer ones.

## Known limitations

- Stock can go negative if two offline branches sell the last units of one batch at the same time. The
  ledger keeps both sales, so the shop sees a negative balance to reconcile. The UI blocks overselling on
  a single computer.
- The desktop app does not yet have a dedicated returns flow. Use a void for same-day corrections and a
  negative stock adjustment for returned stock.
- Users and passwords are local to each computer. Staff logins are not synced.
- Receipts print through the normal Windows print dialog. Thermal-printer drivers can be selected there.
- Tax/VAT is not calculated. Add a tax line to `electron/services/sales.js` if your jurisdiction needs it.
- Regulated medicine registers (controlled-drug logs) are not included.

## Data locations

| Data | Location |
| --- | --- |
| Desktop database | `%APPDATA%\Pharmacy Suite\pharmacy.db` |
| Sync server database | `DATA_FILE` (default `apps/server/data/server.db`, `/data/server.db` in Docker) |

Back up the desktop database regularly from **Settings → Backup**.
