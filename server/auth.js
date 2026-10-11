// Staff authentication.
//
// DEMO-GRADE ONLY. Passwords are in plain text below and sessions live in
// memory. This is a hackathon prototype standing in for an SSO integration --
// it is not a security control and must not be deployed anywhere real.

import { randomUUID } from 'node:crypto';
import { ROLES } from '../shared/config.js';
import { nurseNames } from './patients.js';

const DEMO_PASSWORD = 'belle';

function usernameFor(nurseName) {
  // "RN A. Rivera" -> "a.rivera"
  return nurseName.replace(/^RN\s+/, '').replace(/\s+/g, '').toLowerCase();
}

// One login per nurse in the roster, so "my patients" is a real filter.
const nurseAccounts = nurseNames().map((nurseName) => ({
  username: usernameFor(nurseName),
  password: DEMO_PASSWORD,
  displayName: nurseName,
  role: 'nurse',
  chartName: nurseName, // matches `assigned_nurse` in the patient roster
}));

const otherAccounts = [
  {
    username: 'charge',
    password: DEMO_PASSWORD,
    displayName: 'RN B. Osei (Charge)',
    role: 'charge',
    chartName: null,
  },
  { username: 'pct', password: DEMO_PASSWORD, displayName: 'T. Nguyen', role: 'pct' },
  { username: 'hk', password: DEMO_PASSWORD, displayName: 'M. Diallo', role: 'housekeeping' },
  { username: 'food', password: DEMO_PASSWORD, displayName: 'R. Castillo', role: 'food' },
  { username: 'clerk', password: DEMO_PASSWORD, displayName: 'J. Whitfield', role: 'unitclerk' },
];

const accounts = new Map(
  [...nurseAccounts, ...otherAccounts].map((account) => [account.username, account]),
);

const sessions = new Map(); // token -> session

export function listDemoAccounts() {
  return [...accounts.values()].map(({ username, displayName, role }) => ({
    username,
    displayName,
    role,
    roleLabel: ROLES[role].label,
  }));
}

export function login(username, password) {
  const account = accounts.get(String(username || '').trim().toLowerCase());
  if (!account || account.password !== password) return null;

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
