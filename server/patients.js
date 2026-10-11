// Patient roster loaded from the synthetic inpatient export.
//
// Each row already carries a `card_id`, so the NFC assignment is one-to-one
// with the dataset: one physical card per patient, and the card is the only
// thing the bedside tablet needs to personalise itself.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCsvRecords } from '../shared/csv.js';
import { readJson, writeJson } from './dataDir.js';

const here = path.dirname(fileURLToPath(import.meta.url));
// Resolve the roster file. The export gets re-downloaded during a sprint and
// lands as "...-2.csv", so prefer the canonical name but fall back to the most
// recently modified matching file rather than crashing on boot.
function resolveDataFile() {
  if (process.env.PATIENT_CSV) {
    if (fs.existsSync(process.env.PATIENT_CSV)) return process.env.PATIENT_CSV;
    console.warn(`PATIENT_CSV points at ${process.env.PATIENT_CSV}, which does not exist.`);
  }

  const root = path.join(here, '..');
  const canonical = path.join(root, 'elderly_inpatients_synthetic.csv');
  if (fs.existsSync(canonical)) return canonical;

  const candidates = fs
    .readdirSync(root)
    .filter((f) => /^elderly_inpatients_synthetic.*\.csv$/i.test(f))
    .map((f) => path.join(root, f))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);

  if (candidates.length === 0) {
    console.warn(
      'No patient roster CSV found (expected elderly_inpatients_synthetic*.csv in the project root). ' +
        'Starting with an empty roster; patients can still be added from the admin page.',
    );
    return null;
  }
  return candidates[0];
}

const DATA_FILE = resolveDataFile();

// Speech-recognition locales for the languages present in the roster.
const SPEECH_LOCALE = {
  English: 'en-US',
  Spanish: 'es-ES',
  Mandarin: 'zh-CN',
  Polish: 'pl-PL',
  Arabic: 'ar-SA',
  Italian: 'it-IT',
  Korean: 'ko-KR',
  Hindi: 'hi-IN',
  Gujarati: 'gu-IN',
};

function normalize(row) {
  const dietOrder = row.diet_order || '';
  return {
    patientId: row.patient_id,
    cardId: row.card_id,
    name: row.name,
    firstName: (row.name || '').split(' ')[0],
    age: Number(row.age) || null,
    sex: row.sex,
    diagnosis: row.diagnosis,
    treatmentPlan: row.treatment_plan,
    unit: row.unit,
    room: row.room_number,
    admitDate: row.admit_date,
    fallRisk: row.fall_risk,
    mobility: row.mobility,
    dietOrder,
    allergies: row.allergies,
    language: row.preferred_language || 'English',
    speechLocale: SPEECH_LOCALE[row.preferred_language] || 'en-US',
    sensoryAids: row.sensory_aids,
    assignedNurse: row.assigned_nurse,

    // Derived flags the rest of the app acts on.
    npo: /^NPO/i.test(dietOrder),
    dysphagia: /dysphagia/i.test(dietOrder),
    fluidRestricted: /fluid restriction/i.test(dietOrder),
    highFallRisk: row.fall_risk === 'High',
    hearingAid: /hearing aid/i.test(row.sensory_aids || ''),
  };
}

const ADDED_FILE = 'patients.json';

// The CSV is the base roster; patients added from the admin page are layered on
// top from a JSON file, so a re-exported CSV never overwrites them.
const baseRows = DATA_FILE ? parseCsvRecords(fs.readFileSync(DATA_FILE, 'utf8')) : [];
const addedRows = readJson(ADDED_FILE, []);

const roster = [];
const byCard = new Map();
const byId = new Map();
const byRoom = new Map();

function register(row) {
  const patient = normalize(row);
  if (!patient.cardId || byCard.has(patient.cardId.toUpperCase())) return null;
  roster.push(patient);
  byCard.set(patient.cardId.toUpperCase(), patient);
  byId.set(patient.patientId, patient);
  byRoom.set(String(patient.room).toUpperCase(), patient);
  return patient;
}

[...baseRows, ...addedRows].forEach(register);

export const dataFile = DATA_FILE ? path.basename(DATA_FILE) : '(none)';
// A getter-style function: the count changes as patients are added.
export const patientCountNow = () => roster.length;
export const patientCount = roster.length;

export function allPatients() {
  return roster;
}

/** Resolve an NFC card tap. Accepts "CARD-6D7E7F" or bare "6D7E7F". */
export function patientByCard(cardId) {
  if (!cardId) return null;
  const key = String(cardId).trim().toUpperCase();
  return byCard.get(key) || byCard.get(`CARD-${key}`) || null;
}

export function patientById(patientId) {
  return byId.get(patientId) || null;
}

export function patientByRoom(room) {
  if (!room) return null;
  return byRoom.get(String(room).trim().toUpperCase()) || null;
}

export function nurseNames() {
  return [...new Set(roster.map((p) => p.assignedNurse))].sort();
}

/** What the bedside tablet is allowed to render: the patient's own details. */
export function bedsideProfile(patient) {
  if (!patient) return null;
  return {
    patientId: patient.patientId,
    cardId: patient.cardId,
    name: patient.name,
    firstName: patient.firstName,
    room: patient.room,
    unit: patient.unit,
    diagnosis: patient.diagnosis,
    language: patient.language,
    speechLocale: patient.speechLocale,
    npo: patient.npo,
    dietOrder: patient.dietOrder,
  };
}

/** The full chart card a credentialed staff member sees on a request. */
export function staffProfile(patient) {
  if (!patient) return null;
  const { firstName, speechLocale, ...rest } = patient;
  return rest;
}

// --- adding a patient ---------------------------------------------------------

const LANGUAGES = ['English', 'Spanish'];
const FALL_RISKS = ['Low', 'Moderate', 'High'];

const bad = (message) => Object.assign(new Error(message), { status: 400 });
const clean = (value) => String(value ?? '').trim();

function newPatientId() {
  let id;
  do id = `RWJ-${Math.floor(1_000_000 + Math.random() * 9_000_000)}`;
  while (byId.has(id));
  return id;
}

function newCardId() {
  let id;
  do id = `CARD-${Math.floor(Math.random() * 0xffffff).toString(16).toUpperCase().padStart(6, '0')}`;
  while (byCard.has(id));
  return id;
}

/** Distinct values already in the roster, for the admin form's suggestions. */
export function rosterOptions() {
  const distinct = (key) => [...new Set(roster.map((p) => p[key]).filter(Boolean))].sort();
  return {
    units: distinct('unit'),
    mobilities: distinct('mobility'),
    dietOrders: distinct('dietOrder'),
    allergies: distinct('allergies'),
    sensoryAids: distinct('sensoryAids'),
    languages: LANGUAGES,
    fallRisks: FALL_RISKS,
  };
}

/**
 * Admit a patient and issue them an NFC card.
 * @returns {{patient: object, persisted: boolean}}
 */
export function addPatient(input) {
  const name = clean(input.name);
  const room = clean(input.room);
  const age = Number(input.age);
  const language = clean(input.language) || 'English';
  const fallRisk = clean(input.fallRisk) || 'Low';

  if (name.length < 2) throw bad("Enter the patient's name.");
  if (!room) throw bad('Enter a room number.');
  if (byRoom.has(room.toUpperCase())) throw bad(`Room ${room} already has a patient.`);
  if (!Number.isFinite(age) || age < 0 || age > 120) throw bad('Enter a valid age.');
  if (!['M', 'F'].includes(clean(input.sex))) throw bad('Choose M or F.');
  if (!LANGUAGES.includes(language)) throw bad('Language must be English or Spanish.');
  if (!FALL_RISKS.includes(fallRisk)) throw bad('Choose a fall risk.');
  if (!clean(input.unit)) throw bad('Enter the unit.');
  if (!clean(input.diagnosis)) throw bad('Enter a diagnosis.');

  const row = {
    patient_id: newPatientId(),
    card_id: newCardId(),
    name,
    age: String(Math.round(age)),
    sex: clean(input.sex),
    diagnosis: clean(input.diagnosis),
    treatment_plan: clean(input.treatmentPlan),
    unit: clean(input.unit),
    room_number: room,
    admit_date: new Date().toISOString().slice(0, 10),
    fall_risk: fallRisk,
    mobility: clean(input.mobility) || 'Independent',
    diet_order: clean(input.dietOrder) || 'Regular',
    allergies: clean(input.allergies) || 'NKDA',
    preferred_language: language,
    sensory_aids: clean(input.sensoryAids) || 'None',
    assigned_nurse: clean(input.assignedNurse),
  };

  const patient = register(row);
  const saved = readJson(ADDED_FILE, []);
  saved.push(row);
  const persisted = writeJson(ADDED_FILE, saved);

  return { patient, persisted };
}
