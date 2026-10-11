import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Each test loads fresh copies of the modules against a throwaway data folder,
// so nothing touches the real data/ directory.
async function fresh({ dataDir, password } = {}) {
  const dir = dataDir ?? fs.mkdtempSync(path.join(os.tmpdir(), 'belle-'));
  process.env.DATA_DIR = dir;
  if (password) process.env.STAFF_PASSWORD = password;
  else delete process.env.STAFF_PASSWORD;
  const tag = `?t=${Date.now()}-${Math.random()}`;
  const auth = await import(`../server/auth.js${tag}`);
  const patients = await import(`../server/patients.js${tag}`);
  return { dir, auth, patients };
}

const validPatient = (overrides = {}) => ({
  name: 'Test Patient',
  age: 77,
  sex: 'F',
  language: 'Spanish',
  unit: 'Med-Surg',
  room: '999Z',
  diagnosis: 'Pneumonia',
  ...overrides,
});

test('all 13 built-in logins work with the default password', async () => {
  const { auth } = await fresh();
  const names = [
    'a.rivera', 'd.oyelaran', 'j.kim', 'k.thomas', 'l.brooks', 'm.fitzgerald',
    'p.sharma', 's.mathew', 'charge', 'pct', 'hk', 'food', 'clerk',
  ];
  for (const username of names) {
    assert.ok(auth.login(username, 'belle'), `${username} should sign in`);
  }
});

test('credentials do not depend on the patient roster loading', async () => {
  // auth.js must not import the CSV loader: a host where the roster fails to
  // load must still be able to sign people in.
  const source = fs.readFileSync(new URL('../server/auth.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /from '\.\/patients\.js'/);
});

test('wrong and empty passwords are rejected', async () => {
  const { auth } = await fresh();
  assert.equal(auth.login('hk', 'nope'), null);
  assert.equal(auth.login('hk', ''), null);
  assert.equal(auth.login('hk', undefined), null);
  assert.equal(auth.login('ghost', 'belle'), null);
});

test('STAFF_PASSWORD replaces the built-in password', async () => {
  const { auth } = await fresh({ password: 'rotated-secret' });
  assert.equal(auth.login('hk', 'belle'), null);
  assert.ok(auth.login('hk', 'rotated-secret'));
});

test('a nurse session carries the name patients are assigned under', async () => {
  const { auth } = await fresh();
  assert.equal(auth.login('a.rivera', 'belle').chartName, 'RN A. Rivera');
});

test('new staff can sign in, and the password is stored hashed', async () => {
  const { auth, dir } = await fresh();
  const { account, persisted } = auth.addStaff({
    username: 'New.Nurse',
    displayName: 'RN N. Nurse',
    role: 'nurse',
    password: 'hunter22',
  });

  assert.equal(account.username, 'new.nurse');
  assert.equal(persisted, true);
  assert.ok(auth.login('new.nurse', 'hunter22'));
  assert.equal(auth.login('new.nurse', 'wrong-pass'), null);

  const onDisk = fs.readFileSync(path.join(dir, 'staff.json'), 'utf8');
  assert.doesNotMatch(onDisk, /hunter22/, 'the plain password must never be written to disk');
});

test('staff added earlier are still there after a restart', async () => {
  const first = await fresh();
  first.auth.addStaff({
    username: 'carry.over',
    displayName: 'C. Over',
    role: 'food',
    password: 'longenough',
  });

  const second = await fresh({ dataDir: first.dir });
  assert.ok(second.auth.login('carry.over', 'longenough'));
});

test('staff validation: duplicates, bad roles and weak passwords are refused', async () => {
  const { auth } = await fresh();
  const base = { displayName: 'Someone', role: 'pct', password: 'longenough' };

  assert.throws(() => auth.addStaff({ ...base, username: 'charge' }), /already taken/);
  assert.throws(() => auth.addStaff({ ...base, username: 'ab' }), /Username/);
  assert.throws(() => auth.addStaff({ ...base, username: 'has space' }), /Username/);
  assert.throws(() => auth.addStaff({ ...base, username: 'x.one', role: 'wizard' }), /role/i);
  assert.throws(() => auth.addStaff({ ...base, username: 'x.two', password: '123' }), /6 characters/);
});

test('only the charge nurse passes the admin gate', async () => {
  const { auth } = await fresh();
  const run = (role) => {
    let status = 200;
    let nexted = false;
    auth.requireCharge(
      { staff: { role } },
      { status: (s) => ({ json: () => (status = s) }) },
      () => (nexted = true),
    );
    return { status, nexted };
  };
  assert.equal(run('charge').nexted, true);
  for (const role of ['nurse', 'pct', 'housekeeping', 'food', 'unitclerk']) {
    const result = run(role);
    assert.equal(result.nexted, false, role);
    assert.equal(result.status, 403, role);
  }
});

test('the sign-in shortcut list only shows built-in accounts', async () => {
  const { auth } = await fresh();
  auth.addStaff({ username: 'extra.one', displayName: 'Extra', role: 'pct', password: 'longenough' });
  assert.equal(auth.listDemoAccounts().length, 13);
  assert.equal(auth.listStaff().length, 14);
  assert.ok(auth.listStaff().every((a) => !('password' in a) && !('hash' in a)));
});

test('a new patient gets a unique card, an id, and shows up in lookups', async () => {
  const { patients } = await fresh();
  const before = patients.allPatients().length;

  const { patient, persisted } = patients.addPatient(validPatient());

  assert.equal(persisted, true);
  assert.match(patient.cardId, /^CARD-[0-9A-F]{6}$/);
  assert.match(patient.patientId, /^RWJ-\d{7}$/);
  assert.equal(patients.allPatients().length, before + 1);
  assert.equal(patients.patientByCard(patient.cardId).name, 'Test Patient');
  assert.equal(patients.patientByRoom('999z').patientId, patient.patientId);
  assert.equal(patient.speechLocale, 'es-ES');
});

test('a new NPO patient triggers the same chart rules as the CSV patients', async () => {
  const { patients } = await fresh();
  const { patient } = patients.addPatient(validPatient({ room: '998Y', dietOrder: 'NPO' }));
  assert.equal(patient.npo, true);
});

test('added patients survive a restart', async () => {
  const first = await fresh();
  const { patient } = first.patients.addPatient(validPatient({ room: '997X' }));

  const second = await fresh({ dataDir: first.dir });
  assert.equal(second.patients.patientByCard(patient.cardId)?.room, '997X');
});

test('patient validation: duplicate room, bad age, wrong language', async () => {
  const { patients } = await fresh();
  patients.addPatient(validPatient({ room: '500Q' }));

  assert.throws(() => patients.addPatient(validPatient({ room: '500q' })), /already has a patient/);
  assert.throws(() => patients.addPatient(validPatient({ room: '501Q', age: 400 })), /age/i);
  assert.throws(() => patients.addPatient(validPatient({ room: '502Q', language: 'Klingon' })), /English or Spanish/);
  assert.throws(() => patients.addPatient(validPatient({ room: '503Q', name: '' })), /name/i);
});

test('a missing patient CSV does not crash the roster', async () => {
  process.env.PATIENT_CSV = path.join(os.tmpdir(), 'definitely-not-here.csv');
  try {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'belle-'));
    process.env.DATA_DIR = dir;
    await assert.doesNotReject(import(`../server/patients.js?t=missing-${Date.now()}`));
  } finally {
    delete process.env.PATIENT_CSV;
  }
});
