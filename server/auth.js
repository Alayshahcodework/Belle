// Staff authentication.
//
// DEMO-GRADE. Sessions live in memory and the built-in accounts below use a
// shared plain-text password. Accounts created from the admin page are stored
// with a salted scrypt hash. This stands in for an SSO integration; it is not a
// production security control.
//
// The built-in accounts are written out here on purpose, rather than derived
// from the patient CSV. Login must keep working even if the roster fails to
// load on the host.

import {
  randomBytes,
  randomUUID,
  scryptSync,
  timingSafeEqual,
} from 'node:crypto';
import { ROLES } from '../shared/config.js';
import { readJson, writeJson } from './dataDir.js';

// One password for every built-in account. Override with STAFF_PASSWORD on the
// host so the real value never has to sit in the repo.
const SEED_PASSWORD = process.env.STAFF_PASSWORD || 'belle';

const STAFF_FILE = 'staff.json';

/** Built-in accounts. `chartName` ties a nurse to `assigned_nurse` in the roster. */
const BUILT_IN = [
  { username: 'a.rivera', displayName: 'RN A. Rivera', role: 'nurse', chartName: 'RN A. Rivera' },
  { username: 'd.oyelaran', displayName: 'RN D. Oyelaran', role: 'nurse', chartName: 'RN D. Oyelaran' },
  { username: 'j.kim', displayName: 'RN J. Kim', role: 'nurse', chartName: 'RN J. Kim' },
  { username: 'k.thomas', displayName: 'RN K. Thomas', role: 'nurse', chartName: 'RN K. Thomas' },
  { username: 'l.brooks', displayName: 'RN L. Brooks', role: 'nurse', chartName: 'RN L. Brooks' },
  { username: 'm.fitzgerald', displayName: 'RN M. Fitzgerald', role: 'nurse', chartName: 'RN M. Fitzgerald' },
  { username: 'p.sharma', displayName: 'RN P. Sharma', role: 'nurse', chartName: 'RN P. Sharma' },
  { username: 's.mathew', displayName: 'RN S. Mathew', role: 'nurse', chartName: 'RN S. Mathew' },
  { username: 'charge', displayName: 'RN B. Osei (Charge)', role: 'charge', chartName: null, Password: 'belle' },
  { username: 'pct', displayName: 'T. Nguyen', role: 'pct', chartName: null },
  { username: 'hk', displayName: 'M. Diallo', role: 'housekeeping', chartName: null },
  { username: 'food', displayName: 'R. Castillo', role: 'food', chartName: null },
  { username: 'clerk', displayName: 'J. Whitfield', role: 'unitclerk', chartName: null },
].map((account) => ({ ...account, password: SEED_PASSWORD, builtIn: true }));

const accounts = new Map(BUILT_IN.map((account) => [account.username, account]));

// Accounts added through the admin page in an earlier run.
for (const saved of readJson(STAFF_FILE, [])) {
  if (saved?.username && ROLES[saved.role] && !accounts.has(saved.username)) {
    accounts.set(saved.username, { ...saved, builtIn: false });
  }
}

const sessions = new Map(); // token -> session

// --- passwords ----------------------------------------------------------------

function hashPassword(password, salt = randomBytes(16).toString('hex')) {
  return { salt, hash: scryptSync(password, salt, 32).toString('hex') };
}

function passwordMatches(account, attempt) {
  const given = String(attempt ?? '');
  if (account.hash) {
    const derived = scryptSync(given, account.salt, 32);
    const stored = Buffer.from(account.hash, 'hex');
    return stored.length === derived.length && timingSafeEqual(stored, derived);
  }
  const a = Buffer.from(String(account.password));
  const b = Buffer.from(given);
  return a.length === b.length && timingSafeEqual(a, b);
}

// --- reading ------------------------------------------------------------------

const summary = (account) => ({
  username: account.username,
  displayName: account.displayName,
  role: account.role,
  roleLabel: ROLES[account.role].label,
  chartName: account.chartName ?? null,
  builtIn: Boolean(account.builtIn),
});

/** Built-in accounts only: what the sign-in page offers as a shortcut. */
export function listDemoAccounts() {
  return [...accounts.values()].filter((a) => a.builtIn).map(summary);
}

/** Every account, without credentials. */
export function listStaff() {
  return [...accounts.values()].map(summary);
}

/** Chart names that patients can be assigned to. */
export function nurseChartNames() {
  return [...accounts.values()]
    .filter((a) => a.role === 'nurse' && a.chartName)
    .map((a) => a.chartName)
    .sort();
}

// --- adding -------------------------------------------------------------------

const fail = (message) => Object.assign(new Error(message), { status: 400 });

/**
 * Create a staff account. The password is hashed before it is stored or kept.
 * @returns {{account: object, persisted: boolean}}
 */
export function addStaff({ username, displayName, role, password, chartName }) {
  const name = String(username ?? '').trim().toLowerCase();
  if (!/^[a-z0-9._-]{3,32}$/.test(name)) {
    throw fail('Username must be 3 to 32 characters: letters, numbers, dot, dash or underscore.');
  }
  if (accounts.has(name)) throw fail(`The username "${name}" is already taken.`);
  if (!ROLES[role]) throw fail('Choose a valid role.');
  if (String(displayName ?? '').trim().length < 2) throw fail('Enter the person\'s name.');
  if (String(password ?? '').length < 6) throw fail('Password must be at least 6 characters.');

  const record = {
    username: name,
    displayName: String(displayName).trim(),
    role,
    // Only nurses need a chart name: it is how "my patients" is matched.
    chartName: role === 'nurse' ? String(chartName || displayName).trim() : null,
    ...hashPassword(String(password)),
  };

  accounts.set(name, { ...record, builtIn: false });

  const saved = readJson(STAFF_FILE, []);
  saved.push(record);
  const persisted = writeJson(STAFF_FILE, saved);

  return { account: summary(accounts.get(name)), persisted };
}

// --- sessions -----------------------------------------------------------------

export function login(username, password) {
  const account = accounts.get(String(username || '').trim().toLowerCase());
  if (!account || !passwordMatches(account, password)) return null;

  const token = randomUUID();
  const session = {
    token,
    username: account.username,
    displayName: account.displayName,
    role: account.role,
    roleLabel: ROLES[account.role].label,
    department: ROLES[account.role].department,
    chartName: account.chartName ?? null,
  };
  sessions.set(token, session);
  return session;
}

export function sessionFor(token) {
  return (token && sessions.get(token)) || null;
}

export function logout(token) {
  sessions.delete(token);
}

/** Express middleware: requires a valid staff session. */
export function requireStaff(req, res, next) {
  const header = req.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  const session = sessionFor(token);
  if (!session) return res.status(401).json({ error: 'not signed in' });
  req.staff = session;
  return next();
}

/** Express middleware: charge nurse only. Use after requireStaff. */
export function requireCharge(req, res, next) {
  if (req.staff?.role !== 'charge') {
    return res.status(403).json({ error: 'Only the charge nurse account can do this.' });
  }
  return next();
}