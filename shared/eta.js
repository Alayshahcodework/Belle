// Dynamic wait-time model.
//
// The honest version of "usually about 12 min". Instead of a constant per
// department, an estimate is computed per request, at the moment it is asked
// for, from:
//
//   1. measured mean handling time for that kind of request (SERVICE_MINUTES)
//   2. how much work is already queued ahead of it in that department
//   3. how many people in that role are actually on shift right now
//   4. which shift it is (nights are slower than headcount alone implies)
//   5. meal-service surge for Food Services
//   6. how much help this particular patient needs (from their chart)
//
// Everything returns a breakdown alongside the number, so a nurse manager can
// see why it said what it said -- and so the board can show "4 ahead of you,
// 2 techs on shift" instead of an unexplained figure.

import { PRIORITY, serviceMinutesFor } from './config.js';

export const SHIFTS = {
  day: { id: 'day', label: 'Day', window: '07:00–15:00' },
  evening: { id: 'evening', label: 'Evening', window: '15:00–23:00' },
  night: { id: 'night', label: 'Night', window: '23:00–07:00' },
};

// Headcount on the floor per role, per shift. The single biggest lever on
// wait time, and the number a hospital would tune first.
export const STAFFING = {
  nursing: { day: 6, evening: 5, night: 4 },
  pct: { day: 4, evening: 3, night: 2 },
  housekeeping: { day: 3, evening: 2, night: 1 },
  food: { day: 4, evening: 3, night: 1 },
  unitclerk: { day: 2, evening: 1, night: 1 },
};

// Slowdown beyond raw headcount: fewer ancillary services at night, quiet-hours
// precautions, longer waits on elevators and supply rooms.
export const SHIFT_DRAG = { day: 1.0, evening: 1.08, night: 1.2 };

// Food Services during tray service: the kitchen is already running meal rounds.
const MEAL_WINDOWS = [
  [7, 8.5],
  [11.5, 13],
  [17, 18.5],
];
const MEAL_SURGE = 1.35;

// How much longer a task takes for a patient who needs more help, keyed on the
// `mobility` field of their chart. Bed-bound patients are not a rounding error:
// a toileting assist for "Assist x2" is a different job than for "Independent".
const MOBILITY_FACTOR = {
  Independent: 0.8,
  'Standby assist': 1.0,
  Walker: 1.15,
  'Assist x1 with walker': 1.2,
  'Assist x1': 1.25,
  Wheelchair: 1.3,
  'Bed rest': 1.5,
  'Assist x2 / bed bound': 1.8,
};

// Tasks that scale with how mobile the patient is. Bringing a food tray does
// not get slower because the patient uses a walker; a toileting assist does.
const ACUITY_SENSITIVE = new Set(['mobility', 'clinical', 'urgent_clinical', 'comfort']);

export function shiftFor(date = new Date()) {
  const hour = date.getHours();
  if (hour >= 7 && hour < 15) return 'day';
  if (hour >= 15 && hour < 23) return 'evening';
  return 'night';
}

export function staffOnDuty(departmentId, shift) {
  return Math.max(1, STAFFING[departmentId]?.[shift] ?? 1);
}

function isMealWindow(date) {
  const hour = date.getHours() + date.getMinutes() / 60;
  return MEAL_WINDOWS.some(([from, to]) => hour >= from && hour < to);
}

/** Multiplier for how much assistance this patient needs. 1 when unknown. */
export function acuityFactor(categoryId, patient) {
  if (!patient || !ACUITY_SENSITIVE.has(categoryId)) return 1;
  let factor = MOBILITY_FACTOR[patient.mobility] ?? 1;
  if (patient.fallRisk === 'High') factor += 0.1;
  return Math.round(factor * 100) / 100;
}

/** A two-person assist ties up two staff, not one. */
export function staffRequired(categoryId, patient) {
  if (categoryId !== 'mobility') return 1;
  return patient?.mobility === 'Assist x2 / bed bound' ? 2 : 1;
}

/** Minutes of work one ticket represents for the department that owns it. */
export function workMinutes(ticket, patient, now = new Date()) {
  const base = serviceMinutesFor(ticket.categoryId);
  const acuity = acuityFactor(ticket.categoryId, patient);
  const servers = staffRequired(ticket.categoryId, patient);
  let minutes = base * acuity * servers;

  // Something already being worked on only has its remainder left to run.
  if (ticket.status === 'accepted' && ticket.acceptedAt) {
    const elapsed = (now - new Date(ticket.acceptedAt)) / 60000;
    minutes = Math.max(0.5, minutes - elapsed);
  }
  return minutes;
}

function outranks(a, b) {
  const byPriority = PRIORITY[a.priority].rank - PRIORITY[b.priority].rank;
  if (byPriority !== 0) return byPriority < 0;
  return new Date(a.createdAt) <= new Date(b.createdAt);
}

/**
 * Estimate the wait for one ticket given the current state of its queue.
 *
 * @param {object} ticket        the ticket being estimated (may be unsaved)
 * @param {object[]} openTickets every open ticket on the floor
 * @param {function} patientFor  (ticket) => patient record or null
 * @param {Date} now
 */
export function estimate(ticket, openTickets, patientFor = () => null, now = new Date()) {
  const shift = shiftFor(now);
  const drag = SHIFT_DRAG[shift];
  const patient = patientFor(ticket);

  const base = serviceMinutesFor(ticket.categoryId);
  const acuity = acuityFactor(ticket.categoryId, patient);
  const surge = ticket.departmentId === 'food' && isMealWindow(now) ? MEAL_SURGE : 1;
  const servers = staffOnDuty(ticket.departmentId, shift);

  const serviceMinutes = base * acuity * drag * surge;

  // Urgent clinical interrupts whatever is in progress -- it does not queue.
  if (ticket.priority === 'critical') {
    const minutes = Math.max(1, Math.round(serviceMinutes));
    return {
      minutes,
      low: minutes,
      high: minutes,
      shift,
      servers,
      ticketsAhead: 0,
      waitMinutes: 0,
      serviceMinutes: Math.round(serviceMinutes * 10) / 10,
      queued: false,
      breakdown: { base, acuity, drag, surge, workAheadMinutes: 0 },
      explanation: 'interrupts the queue',
    };
  }

  const ahead = openTickets.filter(
    (other) =>
      other.id !== ticket.id &&
      other.departmentId === ticket.departmentId &&
      other.status !== 'done' &&
      outranks(other, ticket),
  );

  const workAheadMinutes = ahead.reduce(
    (total, other) => total + workMinutes(other, patientFor(other), now),
    0,
  );

  // Parallel servers chew through the backlog together.
  const waitMinutes = (workAheadMinutes / servers) * drag;
  const total = waitMinutes + serviceMinutes;
  const minutes = Math.max(1, Math.round(total));

  return {
    minutes,
    low: Math.max(1, Math.round(total * 0.75)),
    high: Math.max(2, Math.round(total * 1.4)),
    shift,
    servers,
    ticketsAhead: ahead.length,
    waitMinutes: Math.round(waitMinutes * 10) / 10,
    serviceMinutes: Math.round(serviceMinutes * 10) / 10,
    queued: ahead.length > 0,
    breakdown: {
      base,
      acuity,
      drag,
      surge,
      workAheadMinutes: Math.round(workAheadMinutes * 10) / 10,
    },
    explanation:
      ahead.length === 0
        ? `no one ahead · ${servers} on ${shift} shift`
        : `${ahead.length} ahead · ${servers} on ${shift} shift`,
  };
}
