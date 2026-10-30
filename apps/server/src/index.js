'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { openDatabase } = require('./db');
const { createApp, parseBranchKeys } = require('./app');

const port = Number(process.env.PORT ?? 8080);
const dataFile = process.env.DATA_FILE ?? path.join(process.cwd(), 'data', 'server.db');

let keys;
try {
  keys = parseBranchKeys(process.env.BRANCH_KEYS);
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
if (keys.size === 0) {
  console.error('Set BRANCH_KEYS, e.g. BRANCH_KEYS="main-branch:long-random-secret"');
  process.exit(1);
}

fs.mkdirSync(path.dirname(dataFile), { recursive: true });
const db = openDatabase(dataFile);
const app = createApp({ db, keys });

app.listen(port, () => {
  console.log(`Pharmacy sync server listening on port ${port} (${keys.size} branch key(s))`);
});
