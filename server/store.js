// In-memory ticket store + pub/sub so every screen stays in sync.
//
// ETAs are never stored on a ticket. They are recomputed on every read from
// the live queue, because the honest answer to "how long?" changes when the
// request in front of you is picked up, or when the shift changes.

import { randomUUID } from 'node:crypto';
import { CATEGORIES, departmentFor, PRIORITY } from '../shared/config.js';
import { estimate } from '../shared/eta.js';
import { patientById } from './patients.js';

const tickets = [];
const subscribers = new Set();

export function subscribe(fn) {
  subscribers.add(fn);
  return () => subscribers.delete(fn);
}

function patientFor(ticket) {
  return ticket?.patientId ? patientById(ticket.patientId) : null;
}

function byQueueOrder(a, b) {
  const byPriority = PRIORITY[a.priority].rank - PRIORITY[b.priority].rank;
  if (byPriority !== 0) return byPriority;
  return new Date(a.createdAt) - new Date(b.createdAt);
}

/** Every ticket, queue-ordered, with a freshly computed ETA attached. */
export function snapshot(now = new Date()) {
  const open = tickets.filter((t) => t.status !== 'done');
  return [...tickets]
    .sort(byQueueOrder)
    .map((ticket) => ({
      ...ticket,
      eta: ticket.status === 'done' ? null : estimate(ticket, open, patientFor, now),
    }));
}

export function listTickets() {
  return snapshot();
}

/** Estimate for a request that has not been created yet (the preview card). */
export function previewEstimate(draft, now = new Date()) {
  const open = tickets.filter((t) => t.status !== 'done');
  return estimate(
    { ...draft, id: '__preview__', createdAt: new Date().toISOString(), status: 'new' },
    open,
    (t) => (t.id === '__preview__' ? patientById(draft.patientId) : patientFor(t)),
    now,
  );
}

function publish(event) {
  for (const fn of subscribers) {
    try {
      fn(event);
    } catch {
      // a dead SSE connection should never take down a request
    }
  }
}

/** Everyone gets the whole board, so every ETA on every screen is current. */
export function broadcast() {
  publish({ type: 'snapshot', tickets: snapshot() });
}

export function createTicket({ text, source, routing, patient, guardrailFlags = [] }) {
  const category = CATEGORIES[routing.categoryId];
  const department = departmentFor(routing.categoryId);

  const ticket = {
    id: randomUUID(),
    text,
    source, // 'button' | 'voice' | 'text'

    // Patient linkage, resolved from the NFC card at request time.
    patientId: patient?.patientId ?? null,
    cardId: patient?.cardId ?? null,
    patientName: patient?.name ?? null,
    room: patient?.room ?? 'unknown',
    unit: patient?.unit ?? null,
    assignedNurse: patient?.assignedNurse ?? null,
    language: patient?.language ?? 'English',

    categoryId: category.id,
    categoryLabel: category.label,
    departmentId: department.id,
    departmentName: department.name,
    priority: category.priority,
    confidence: routing.confidence,
    matched: routing.matched ?? [],
    redFlags: routing.redFlags ?? [],
    engine: routing.engine ?? 'rules',
    reasoning: routing.reasoning ?? null,

    // Chart-driven overrides and context.
    guardrailFlags,
    overriddenFrom: routing.overriddenFrom ?? null,
    overrideCode: routing.overrideCode ?? null,
    overrideReason: routing.overrideReason ?? null,

    status: 'new',
    createdAt: new Date().toISOString(),
    acceptedAt: null,
    completedAt: null,
    assignee: null,
  };

  tickets.push(ticket);
  broadcast();
  return ticket;
}

export function updateTicket(id, { status, assignee }) {
  const ticket = tickets.find((t) => t.id === id);
  if (!ticket) return null;

  if (status && status !== ticket.status) {
    ticket.status = status;
    if (status === 'accepted') ticket.acceptedAt = new Date().toISOString();
    if (status === 'done') ticket.completedAt = new Date().toISOString();
  }
  if (assignee !== undefined) ticket.assignee = assignee;

  broadcast();
  return ticket;
}

export function getTicket(id) {
  return tickets.find((t) => t.id === id) || null;
}

export function resetTickets() {
  tickets.length = 0;
  broadcast();
}

// Wait times decay as the clock runs, so refresh every screen periodically
// even when nobody touches the board.
setInterval(() => {
  if (tickets.some((t) => t.status !== 'done')) broadcast();
}, 30_000).unref?.();
