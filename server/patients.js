// Patient roster loaded from the synthetic inpatient export.
//
// Each row already carries a `card_id`, so the NFC assignment is one-to-one
// with the dataset: one physical card per patient, and the card is the only
// thing the bedside tablet needs to personalise itself.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCsvRecords } from '../shared/csv.js';

const here = path.dirname(fileURLToPath(import.meta.url));
// Resolve the roster file. The export gets re-downloaded during a sprint and
// lands as "...-2.csv", so prefer the canonical name but fall back to the most
// recently modified matching file rather than crashing on boot.
function resolveDataFile() {
  if (process.env.PATIENT_CSV) return process.env.PATIENT_CSV;

  const root = path.join(here, '..');
  const canonical = path.join(root, 'elderly_inpatients_synthetic.csv');
  if (fs.existsSync(canonical)) return canonical;

  const candidates = fs
    .readdirSync(root)
    .filter((f) => /^elderly_inpatients_synthetic.*\.csv$/i.test(f))
    .map((f) => path.join(root, f))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);

  if (candidates.length === 0) {
    throw new Error(
      'No patient roster found. Expected elderly_inpatients_synthetic*.csv in the project root.',
    );
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

const roster = parseCsvRecords(fs.readFileSync(DATA_FILE, 'utf8')).map(normalize);

const byCard = new Map(roster.map((p) => [p.cardId.toUpperCase(), p]));
const byId = new Map(roster.map((p) => [p.patientId, p]));
const byRoom = new Map(roster.map((p) => [p.room.toUpperCase(), p]));

export const patientCount = roster.length;
export const dataFile = path.basename(DATA_FILE);

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
