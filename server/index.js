// Load .env (GEMINI_API_KEY) without pulling in a dependency.
try {
  process.loadEnvFile();
} catch {
  // no .env present -- Gemini stays off and the keyword engine answers
}

import express from 'express';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { triage } from './triage.js';
import { geminiEnabled } from './gemini.js';
import {
  CATEGORIES,
  DEPARTMENTS,
  DEPARTMENT_ORDER,
  NURSE_ACTION,
  QUICK_ACTIONS,
  ROLES,
  STATUSES,
  departmentFor,
} from '../shared/config.js';
import { SHIFTS, STAFFING, shiftFor, staffOnDuty } from '../shared/eta.js';
import {
  addStaff,
  listDemoAccounts,
  listStaff,
  login,
  logout,
  nurseChartNames,
  requireCharge,
  requireStaff,
  sessionFor,
} from './auth.js';
import { applyGuardrails } from './guardrails.js';
import {
  addPatient,
  allPatients,
  bedsideProfile,
  patientByCard,
  patientById,
  patientCount,
  patientCountNow,
  rosterOptions,
  staffProfile,
} from './patients.js';
import {
  createTicket,
  getTicket,
  previewEstimate,
  resetTickets,
  snapshot,
  subscribe,
  updateTicket,
} from './store.js';

const PORT = process.env.PORT || 8787;
const here = path.dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(express.json({ limit: '32kb' }));

const quickActionsById = new Map(
  [...QUICK_ACTIONS, NURSE_ACTION].map((action) => [action.id, action]),
);

/** Turn a button press or free text into a routing decision. */
async function route({ actionId, text }) {
  const action = actionId ? quickActionsById.get(actionId) : null;
  if (action) {
    // A tapped button is an explicit statement of intent -- do not re-guess
    // it, and do not spend an API call on it.
    const category = CATEGORIES[action.category];
    return {
      routing: {
        categoryId: category.id,
        confidence: 1,
        matched: [`button:${action.id}`],
        redFlags: action.category === 'urgent_clinical' ? ['nurse button'] : [],
        engine: 'button',
      },
      text: text?.trim() || action.text,
    };
  }
  return { routing: await triage(text), text: (text ?? '').trim() };
}

/** Strip a ticket down to what the bedside tablet may see. */
function patientSafeTicket(ticket) {
  return {
    id: ticket.id,
    text: ticket.text,
    status: ticket.status,
    departmentId: ticket.departmentId,
    departmentName: ticket.departmentName,
    categoryLabel: ticket.categoryLabel,
    priority: ticket.priority,
    overrideCode: ticket.overrideCode ?? null,
    createdAt: ticket.createdAt,
    eta: ticket.eta ?? null,
  };
}

// --- config ------------------------------------------------------------------
app.get('/api/meta', (_req, res) => {
  const shift = shiftFor();
  res.json({
    departments: DEPARTMENTS,
    departmentOrder: DEPARTMENT_ORDER,
    categories: CATEGORIES,
    roles: ROLES,
    quickActions: QUICK_ACTIONS,
    nurseAction: NURSE_ACTION,
    statuses: STATUSES,
    patientCount: patientCountNow(),
    classifier: geminiEnabled() ? 'gemini' : 'rules',
    shift: { id: shift, ...SHIFTS[shift] },
    staffing: Object.fromEntries(DEPARTMENT_ORDER.map((id) => [id, staffOnDuty(id, shift)])),
  });
});

app.get('/api/staffing', (_req, res) => {
  const shift = shiftFor();
  res.json({
    shift: { id: shift, ...SHIFTS[shift] },
    onDuty: Object.fromEntries(DEPARTMENT_ORDER.map((id) => [id, staffOnDuty(id, shift)])),
    roster: STAFFING,
  });
});

// --- NFC card tap ------------------------------------------------------------
app.get('/api/session/:cardId', (req, res) => {
  const patient = patientByCard(req.params.cardId);
  if (!patient) return res.status(404).json({ error: 'card not recognised' });
  res.json(bedsideProfile(patient));
});

// --- demo affordance ---------------------------------------------------------
// Lets the launcher simulate an NFC tap without physical cards. Returns no
// clinical detail. REMOVE before anything resembling production.
app.get('/api/demo/cards', (_req, res) => {
  const roster = allPatients();

  // An even spread across the floor, not the first twelve rows -- those
  // happen to be surgical admissions and five of them are NPO, which made
  // every food request on the launcher divert to a nurse and look broken.
  const step = Math.max(1, Math.floor(roster.length / 12));
  const spread = [];
  for (let i = 0; i < roster.length && spread.length < 12; i += step) spread.push(roster[i]);

  const diverts = (p) => p.npo || p.dysphagia || p.fluidRestricted;

  res.json(
    spread
      // Regular diets first, so the obvious card to tap behaves the obvious
      // way. The restricted ones stay in the list -- they are the safety demo.
      .sort((a, b) => Number(diverts(a)) - Number(diverts(b)))
      .map((p) => ({
        cardId: p.cardId,
        room: p.room,
        firstName: p.firstName,
        language: p.language,
        dietOrder: p.dietOrder,
        dietRestricted: diverts(p),
      })),
  );
});

// --- classification preview (voice confirmation card) ------------------------
app.post('/api/classify', async (req, res) => {
  const text = typeof req.body?.text === 'string' ? req.body.text : '';
  const patient = patientByCard(req.body?.cardId);

  const base = await triage(text);
  const { routing, flags } = applyGuardrails(base, patient);
  const category = CATEGORIES[routing.categoryId];
  const department = departmentFor(routing.categoryId);

  const eta = previewEstimate({
    categoryId: routing.categoryId,
    departmentId: department.id,
    priority: category.priority,
    patientId: patient?.patientId ?? null,
  });

  res.json({
    ...routing,
    categoryLabel: category.label,
    departmentId: department.id,
    departmentName: department.name,
    priority: category.priority,
    escalated: category.priority === 'critical',
    guardrailFlags: flags,
    eta,
  });
});

// --- create a request --------------------------------------------------------
app.post('/api/requests', async (req, res) => {
  const { cardId, actionId, text, source = 'text' } = req.body ?? {};

  const patient = patientByCard(cardId);
  if (!patient) return res.status(400).json({ error: 'unknown or missing NFC card' });
  if (!actionId && !String(text ?? '').trim()) {
    return res.status(400).json({ error: 'text or actionId is required' });
  }

  const resolved = await route({ actionId, text });
  const { routing, flags } = applyGuardrails(resolved.routing, patient);

  const ticket = createTicket({
    text: resolved.text,
    source,
    routing,
    patient,
    guardrailFlags: flags,
  });

  // Re-read through the snapshot so the response carries a live ETA -- the
  // bedside screen reads it aloud straight away.
  const withEta = snapshot().find((t) => t.id === ticket.id) ?? ticket;
  res.status(201).json(patientSafeTicket(withEta));
});

// --- patient's own requests --------------------------------------------------
app.get('/api/my-requests/:cardId', (req, res) => {
  const patient = patientByCard(req.params.cardId);
  if (!patient) return res.status(404).json({ error: 'card not recognised' });
  res.json(
    snapshot()
      .filter((ticket) => ticket.patientId === patient.patientId)
      .map(patientSafeTicket),
  );
});

// --- staff auth --------------------------------------------------------------
app.get('/api/auth/accounts', (_req, res) => res.json(listDemoAccounts()));

app.post('/api/auth/login', (req, res) => {
  const session = login(req.body?.username, req.body?.password);
  if (!session) return res.status(401).json({ error: 'wrong username or password' });
  res.json(session);
});

app.post('/api/auth/logout', requireStaff, (req, res) => {
  logout(req.staff.token);
  res.json({ ok: true });
});

app.get('/api/auth/me', requireStaff, (req, res) => res.json(req.staff));

// --- staff board -------------------------------------------------------------
app.get('/api/staff/requests', requireStaff, (_req, res) => res.json(snapshot()));

app.get('/api/staff/patient/:patientId', requireStaff, (req, res) => {
  const patient = patientById(req.params.patientId);
  if (!patient) return res.status(404).json({ error: 'patient not found' });
  res.json(staffProfile(patient));
});

app.get('/api/staff/request/:id', requireStaff, (req, res) => {
  const ticket = getTicket(req.params.id);
  if (!ticket) return res.status(404).json({ error: 'not found' });
  res.json({ ticket, patient: staffProfile(patientById(ticket.patientId)) });
});

app.patch('/api/requests/:id', requireStaff, (req, res) => {
  const { status, assignee } = req.body ?? {};
  if (status && !STATUSES[status]) {
    return res.status(400).json({ error: `unknown status: ${status}` });
  }
  const ticket = updateTicket(req.params.id, { status, assignee });
  if (!ticket) return res.status(404).json({ error: 'not found' });
  res.json(ticket);
});

app.post('/api/reset', requireStaff, (_req, res) => {
  resetTickets();
  res.json({ ok: true });
});

// --- admin: add staff and patients (charge nurse only) ------------------------
const admin = [requireStaff, requireCharge];

app.get('/api/admin/options', ...admin, (_req, res) => {
  res.json({ ...rosterOptions(), nurses: nurseChartNames(), roles: ROLES });
});

app.get('/api/admin/staff', ...admin, (_req, res) => res.json(listStaff()));

app.post('/api/admin/staff', ...admin, (req, res) => {
  try {
    res.status(201).json(addStaff(req.body ?? {}));
  } catch (error) {
    res.status(error.status ?? 500).json({ error: error.message });
  }
});

app.post('/api/admin/patients', ...admin, (req, res) => {
  try {
    const { patient, persisted } = addPatient(req.body ?? {});
    // The card is issued now, so hand back the URL to write onto the NFC tag.
    const origin = `${req.protocol}://${req.get('host')}`;
    res.status(201).json({
      persisted,
      patient: staffProfile(patient),
      cardUrl: `${origin}/#/t/${patient.cardId}`,
    });
  } catch (error) {
    res.status(error.status ?? 500).json({ error: error.message });
  }
});

// --- live feed ---------------------------------------------------------------
// EventSource cannot set headers, so a staff token arrives as a query param.
// Two modes: a staff board gets the whole floor, a bedside tablet gets only
// its own patient's tickets, stripped of anyone else's details.
app.get('/api/stream', (req, res) => {
  const staff = sessionFor(req.query.token);
  const patient = req.query.card ? patientByCard(req.query.card) : null;

  if (!staff && !patient) return res.status(401).end();

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  const project = (event) => {
    if (event.type !== 'snapshot' || staff) return event;
    return {
      type: 'snapshot',
      tickets: event.tickets
        .filter((ticket) => ticket.patientId === patient.patientId)
        .map(patientSafeTicket),
    };
  };

  const send = (event) => res.write(`data: ${JSON.stringify(project(event))}\n\n`);
  send({ type: 'snapshot', tickets: snapshot() });

  const unsubscribe = subscribe(send);
  const heartbeat = setInterval(() => res.write(': ping\n\n'), 20_000);

  req.on('close', () => {
    clearInterval(heartbeat);
    unsubscribe();
    res.end();
  });
});

// --- production build --------------------------------------------------------
const dist = path.join(here, '..', 'dist');
app.use(express.static(dist));
app.get(/^(?!\/api).*/, (_req, res, next) => {
  res.sendFile(path.join(dist, 'index.html'), (err) => (err ? next() : undefined));
});

app.listen(PORT, () => {
  console.log(
    `Belle API on http://localhost:${PORT} — ${patientCount} patients, ` +
      `classifier: ${geminiEnabled() ? 'Gemini (keyword fallback)' : 'keyword rules only'}`,
  );
});
