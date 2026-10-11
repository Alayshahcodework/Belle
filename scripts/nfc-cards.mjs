#!/usr/bin/env node
// Generates the URL to write onto each physical NFC tag.
//
//   node scripts/nfc-cards.mjs --host http://192.168.82.117:8787
//   node scripts/nfc-cards.mjs --host https://belle.local --out cards.csv
//
// Write the resulting URL to each tag as an NDEF "URI" record using any tag
// writer (NFC Tools on Android/iOS, or a USB ACR122U). Tapping the tag then
// opens the bedside screen already personalised to that patient -- no login,
// no room selection, no typing.

import fs from 'node:fs';
import { allPatients } from '../server/patients.js';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};

const host = flag('host', 'http://localhost:8787').replace(/\/+$/, '');
const out = flag('out', null);
const limit = Number(flag('limit', '0')) || Infinity;

const rows = allPatients()
  .slice(0, limit)
  .map((patient) => ({
    card_id: patient.cardId,
    url: `${host}/#/t/${patient.cardId}`,
    patient_id: patient.patientId,
    name: patient.name,
    room: patient.room,
    unit: patient.unit,
    language: patient.language,
  }));

if (out) {
  const header = Object.keys(rows[0]).join(',');
  const body = rows
    .map((row) =>
      Object.values(row)
        .map((value) => (/[",]/.test(value) ? `"${String(value).replace(/"/g, '""')}"` : value))
        .join(','),
    )
    .join('\n');
  fs.writeFileSync(out, `${header}\n${body}\n`);
  console.log(`Wrote ${rows.length} card records to ${out}`);
} else {
  console.log(`\nNFC tag payloads — host ${host}\n`);
  for (const row of rows.slice(0, 15)) {
    console.log(`${row.card_id}  ${row.room.padEnd(6)} ${row.name.padEnd(22)} ${row.url}`);
  }
  if (rows.length > 15) console.log(`\n…and ${rows.length - 15} more. Use --out cards.csv.`);
  console.log(`\n${rows.length} cards total.`);
  console.log('Write each URL to its tag as an NDEF URI record.\n');
}
