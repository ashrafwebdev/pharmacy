'use strict';

const { randomBytes, scryptSync, timingSafeEqual } = require('node:crypto');
const { nowIso, newId, cleanText } = require('../lib/util');

const ROLES = ['admin', 'pharmacist', 'cashier'];
const USERNAME_PATTERN = /^[a-z0-9._-]{3,32}$/;
const MIN_PASSWORD_LENGTH = 8;

function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

function verifyPassword(password, stored) {
  const [scheme, salt, hash] = String(stored).split('$');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  const actual = scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, 'hex');
  return expected.length === actual.length && timingSafeEqual(actual, expected);
}

function publicUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    name: row.name,
    role: row.role,
    active: row.active === 1,
  };
}

function validateCredentials({ username, name, role, password }) {
  if (!USERNAME_PATTERN.test(username)) {
    throw new Error('Username must be 3-32 characters: letters, numbers, dots, dashes or underscores');
  }
  if (!cleanText(name)) throw new Error('Full name is required');
  if (!ROLES.includes(role)) throw new Error('Choose a valid role');
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
  }
}

function getUser(db, id) {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id) ?? null;
}

function hasUsers(db) {
  return db.prepare('SELECT COUNT(*) AS n FROM users').get().n > 0;
}

function insertUser(db, { username, name, role, password }) {
  const normalized = cleanText(username).toLowerCase();
  validateCredentials({ username: normalized, name, role, password });
  const id = newId();
  try {
    db.prepare(`
      INSERT INTO users (id, username, name, role, password_hash, active, created_at)
      VALUES (?, ?, ?, ?, ?, 1, ?)
    `).run(id, normalized, cleanText(name), role, hashPassword(password), nowIso());
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) throw new Error('That username is already taken');
    throw err;
  }
  return publicUser(getUser(db, id));
}

/** First-run setup: only allowed while no user exists. Always creates an admin. */
function setupAdmin(db, input) {
  if (hasUsers(db)) throw new Error('Setup has already been completed');
  return insertUser(db, { ...input, role: 'admin' });
}

function login(db, username, password) {
  const row = db
    .prepare('SELECT * FROM users WHERE username = ?')
    .get(cleanText(username).toLowerCase());
  if (!row || row.active !== 1 || !verifyPassword(String(password ?? ''), row.password_hash)) {
    throw new Error('Invalid username or password');
  }
  return publicUser(row);
}

function listUsers(db) {
  return db
    .prepare('SELECT * FROM users ORDER BY username')
    .all()
    .map(publicUser);
}

function createUser(db, input) {
  return insertUser(db, input);
}

function countActiveAdmins(db, excludingId) {
  return db
    .prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND active = 1 AND id != ?")
    .get(excludingId).n;
}

function updateUser(db, { id, name, role, active }, actingUserId) {
  const existing = getUser(db, id);
  if (!existing) throw new Error('User not found');
  const nextRole = role ?? existing.role;
  const nextActive = active === undefined ? existing.active === 1 : Boolean(active);
  if (!ROLES.includes(nextRole)) throw new Error('Choose a valid role');
  if (id === actingUserId && (!nextActive || nextRole !== 'admin')) {
    throw new Error('You cannot remove your own admin access');
  }
  const losesAdmin = existing.role === 'admin' && existing.active === 1 &&
    (nextRole !== 'admin' || !nextActive);
  if (losesAdmin && countActiveAdmins(db, id) === 0) {
    throw new Error('At least one active admin must remain');
  }
  db.prepare('UPDATE users SET name = ?, role = ?, active = ? WHERE id = ?').run(
    cleanText(name) || existing.name,
    nextRole,
    nextActive ? 1 : 0,
    id,
  );
  return publicUser(getUser(db, id));
}

function resetPassword(db, id, password) {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
  }
  if (!getUser(db, id)) throw new Error('User not found');
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(password), id);
  return true;
}

module.exports = {
  ROLES,
  publicUser,
  hasUsers,
  setupAdmin,
  login,
  listUsers,
  createUser,
  updateUser,
  resetPassword,
  hashPassword,
  verifyPassword,
};
