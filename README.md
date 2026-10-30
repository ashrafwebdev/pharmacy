# Pharmacy Suite (India)

An end-to-end pharmacy shop system for Windows, built for Indian retail pharmacies.

- **Desktop app (Windows, Electron)**: billing, medicine catalogue, batch and expiry tracking, purchasing,
  customers and suppliers, GST tax invoices, reports, staff accounts, backups.
- **Works fully offline.** All data lives in a local SQLite database on the shop computer.
- **Optional cloud sync.** When the internet is available, each shop uploads its changes to a central
  server and downloads changes from other branches. When it is not, the shop keeps billing and syncs later.
- **Sync server (Node.js + SQLite)**: stores each branch's data separately and offers a sales summary.

```
pharmacy/
├── apps/
│   ├── desktop/          Electron + React app (Windows installer is built from here)
│   │   ├── electron/     Main process: database, business rules, GST, sync, IPC
│   │   ├── src/          React UI
│   │   └── test/         Business-rule, GST, prescription and sync tests
│   └── server/           Central sync server (Express + SQLite) and its tests
└── .github/workflows/    CI: runs tests, builds the Windows installer
```

## What it does

| Area | Details |
| --- | --- |
| **Billing (Sell)** | Search by name or scan a barcode (Enter adds it). Bill at MRP, discounts in ₹, round-off to the rupee, cash / UPI / card / credit (udhaar). |
| **GST tax invoice** | Per-line HSN code and GST rate, CGST and SGST split, rate-wise GST summary, total in words ("Rupees Forty Two Only"), shop GSTIN and drug licence numbers printed. |
| **MRP pricing** | A batch is always billed at its own MRP, never above it. Discounts only reduce the amount. |
| **Expiry-safe stock** | Every unit belongs to a batch with an expiry date. Sales use the earliest-expiring batch first and never sell expired stock. |
| **Drug schedules** | Products are marked OTC, H, H1 or X. Scheduled medicines cannot be billed until the prescription details are entered (doctor, registration no., patient, prescription no. and date). |
| **Stock & batches** | Receive stock per batch with MRP, purchase price and supplier. Adjust with a reason, write off expired batches. Every change is a traceable movement. |
| **Reports** | Sales summary, daily sales, top products, **GST summary by rate** (for GSTR-1 / GSTR-3B preparation), **Schedule H/H1/X register**, bill history with void, CSV export for each. |
| **People** | Customers (with optional GSTIN) and suppliers (with GSTIN). |
| **Staff** | Admin, pharmacist and cashier roles, enforced in the main process. |
| **Backups** | One-click database backup. |
| **Sync** | Automatic every minute when configured, manual "Sync now", status indicator in the top bar. |

## India-specific rules built in

- **Currency and dates**: rupees with lakh/crore grouping (₹1,23,456.00), dates as dd/mm/yyyy, financial
  year April to March.
- **MRP is GST-inclusive.** The app splits each line into taxable value and GST, the way Indian pharmacy
  bills are read.
- **Intra-state split**: GST is shown as CGST + SGST (half each). Equal halves are the normal case for a
  retail counter sale.
- **Invoice numbers** follow `<till code>/<financial year>/<serial>`, for example `C1/26-27/125`. Each till
  has its own code (set under Settings → Shop details), so two tills never issue the same number. Voided
  bills stay in the list, so there are no gaps.
- **Validation**: GSTIN must be 15 characters in the correct format; HSN must be 4, 6 or 8 digits; GST rates
  are limited to 0, 5, 12, 18 and 28 per cent.
- **Shop details** on every invoice: GSTIN, drug licence numbers (Form 20 / Form 21), registered pharmacist
  and registration number.

## Quick start (development)

Requirements: Node.js 22. Development can run on Windows or Linux. The installer targets Windows.

```bash
# 1. Sync server (optional for single-shop use)
cd apps/server
npm install
BRANCH_KEYS="main:change-this-to-a-long-random-secret" npm start

# 2. Desktop app
cd apps/desktop
npm install
npm run rebuild      # rebuilds the SQLite module for Electron (once after npm install)
npm start            # builds the UI and launches the app
```

On first launch, create the owner (admin) account, then fill in **Settings → Shop details**: pharmacy name,
address, GSTIN, drug licence numbers and the pharmacist. Set the till code to `C1` (or a code unique to this till).

### Running the tests

```bash
cd apps/server  && npm test   # sync protocol: auth, push, pull, last-write-wins, paging, branches
cd apps/desktop && npm test   # billing rules, GST maths, MRP, round-off, prescriptions, FEFO, voids,
                              # roles, GST and register reports, and two-device sync against the real server
```

## Building the Windows installer

```bash
cd apps/desktop
npm ci
npm run dist         # writes release/Pharmacy Suite Setup x.y.z.exe
```

The GitHub Actions workflow (`.github/workflows/build.yml`) runs the tests on every push and builds the
installer on a Windows runner, uploading it as an artifact. Before distributing, add `build/icon.ico` and
configure code signing in `apps/desktop/electron-builder.yml`.

## Deploying the sync server

Keys are configured through `BRANCH_KEYS`, one per branch:

```
BRANCH_KEYS="main-street:long-random-secret-1,north-branch:long-random-secret-2"
```

```bash
cd apps/server
docker build -t pharmacy-sync .
docker run -d -p 8080:8080 \
  -e BRANCH_KEYS="main-street:long-random-secret-1" \
  -v pharmacy-data:/data \
  pharmacy-sync
```

Put it behind HTTPS (for example Caddy or nginx) before using it over the internet, because API keys travel
in the `Authorization` header.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/health` | Liveness check (no key needed) |
| POST | `/api/sync/push` | Branch uploads changed rows |
| GET | `/api/sync/pull?since=&limit=` | Branch downloads changes after its cursor |
| GET | `/api/summary?from=&to=` | Completed sales count and revenue for the branch |

In the desktop app, enter the server address and branch key under **Settings → Cloud sync** and tick
**Enable sync**. The key is encrypted with Windows DPAPI.

## How sync works

- **Offline first.** Every write goes to the local database immediately. Sync never blocks a bill.
- **Changes are tracked per row** with `updated_at`, a soft-delete flag and a `dirty` flag. A cycle pushes
  dirty rows, then pulls everything after this shop's cursor.
- **Stock cannot conflict.** Stock is an append-only movement ledger, so two offline branches can each sell
  from the same batch and both sales are kept.
- **Other records use last-write-wins** on `updated_at`. Bills are not edited after completion; a void adds
  a status change and reversing stock movements.
- **Each till keeps its own invoice serials** (its till code), so offline tills cannot issue duplicate numbers.

## What you must check before going live

The software applies the rules above, but compliance remains your responsibility. Please confirm the
following with your CA and a registered pharmacist:

- **GST rate and HSN per product.** Medicine rates change and some are exempt. The app stores whatever you
  enter; it does not look up rates.
- **Intra-state only.** Bills always show CGST + SGST. Interstate sales (IGST) and the state-based place of
  supply are not supported.
- **Not included:** e-invoicing (IRN), e-way bills, GSTR-1 / GSTR-3B filing, and the Drugs & Cosmetics Act
  register formats as prescribed by your state. The app produces the data for these; it does not file them.
- **Schedule X** is treated like Schedule H1 (prescription and record required). Retention periods and
  any state-specific controls for narcotic-type drugs are not enforced.
- **Drug licence renewal dates** are not tracked. Keep your Form 20/21 licences valid.
- **Prescription checks.** The app records the prescription details but cannot verify the prescription.
  The pharmacist remains responsible for dispensing decisions.
- **Till codes must be unique** across all tills of the same GSTIN. Set them once and do not change them
  after invoices exist.
- **Round-off** is applied to the bill total, and the GST summary is calculated from line values. Check
  the figures against your accounts before filing.
- **Other limitations:** no dedicated returns flow (use a void or a negative stock adjustment), users are
  local to each computer, and thermal printing goes through the Windows print dialog.

## Data locations

| Data | Location |
| --- | --- |
| Desktop database | `%APPDATA%\Pharmacy Suite\pharmacy.db` |
| Sync server database | `DATA_FILE` (default `apps/server/data/server.db`, `/data/server.db` in Docker) |

Back up the desktop database regularly from **Settings → Backup**.
