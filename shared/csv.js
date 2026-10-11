// Minimal RFC 4180 CSV parser.
//
// The patient export has quoted fields with embedded commas
// ("Renal (low K, low phos)"), so splitting on "," shifts every column after
// it and you end up with allergies in the language field. This handles quotes.

export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;

  const source = text.replace(/^﻿/, ''); // strip BOM

  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];

    if (quoted) {
      if (char === '"') {
        if (source[i + 1] === '"') {
          field += '"'; // escaped quote
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && source[i + 1] === '\n') i += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += char;
    }
  }

  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows.filter((r) => r.length > 1 || r[0] !== '');
}

/** Parse a CSV with a header row into an array of objects. */
export function parseCsvRecords(text) {
  const [header, ...rest] = parseCsv(text);
  if (!header) return [];
  return rest.map((cells) =>
    Object.fromEntries(header.map((key, i) => [key.trim(), (cells[i] ?? '').trim()])),
  );
}
