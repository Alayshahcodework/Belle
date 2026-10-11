// Where records added through the admin page are kept.
//
// Built-in staff and the CSV roster live in the code and the repo, so they are
// always there. Anything created at runtime (new staff, new patients) is
// written here as JSON. On a host with an ephemeral disk (most free tiers)
// these files are lost on redeploy, which is why `writeJson` reports whether it
// actually persisted: the UI says so rather than pretending.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

// Resolved on every call rather than once at import, so a host can set
// DATA_DIR at any point before the first read and tests can point it elsewhere.
export const dataDir = () => process.env.DATA_DIR || path.join(here, '..', 'data');

export function readJson(name, fallback) {
  try {
    return JSON.parse(fs.readFileSync(path.join(dataDir(), name), 'utf8'));
  } catch {
    return fallback;
  }
}

/** @returns {boolean} true if the file was written to disk */
export function writeJson(name, value) {
  try {
    fs.mkdirSync(dataDir(), { recursive: true });
    fs.writeFileSync(path.join(dataDir(), name), JSON.stringify(value, null, 2));
    return true;
  } catch {
    return false; // read-only filesystem: keep it in memory, say so
  }
}
