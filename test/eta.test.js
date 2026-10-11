import test from 'node:test';
import assert from 'node:assert/strict';
import { estimate, shiftFor, staffOnDuty, acuityFactor } from '../shared/eta.js';
import { SERVICE_MINUTES } from '../shared/config.js';

const DAY = new Date('2026-10-10T10:00:00');
const NIGHT = new Date('2026-10-10T02:00:00');
const LUNCH = new Date('2026-10-10T12:00:00');

function ticket(overrides = {}) {
  return {
    id: overrides.id ?? 't1',
    categoryId: 'comfort',
    departmentId: 'housekeeping',
    priority: 'normal',
    status: 'new',
    createdAt: '2026-10-10T10:00:00.000Z',
    ...overrides,
  };
}

test('shift boundaries', () => {
  assert.equal(shiftFor(new Date('2026-10-10T07:00:00')), 'day');
  assert.equal(shiftFor(new Date('2026-10-10T14:59:00')), 'day');
  assert.equal(shiftFor(new Date('2026-10-10T15:00:00')), 'evening');
  assert.equal(shiftFor(new Date('2026-10-10T22:59:00')), 'evening');
  assert.equal(shiftFor(new Date('2026-10-10T23:00:00')), 'night');
  assert.equal(shiftFor(new Date('2026-10-10T03:00:00')), 'night');
});

test('an empty queue returns roughly the measured service time', () => {
  const result = estimate(ticket(), [], () => null, DAY);
  // comfort = 5.48 measured, day drag 1.0
  assert.equal(result.ticketsAhead, 0);
  assert.equal(result.waitMinutes, 0);
  assert.equal(result.minutes, Math.round(SERVICE_MINUTES.comfort));
  assert.equal(result.queued, false);
});

test('a queue ahead of you increases the wait', () => {
  const ahead = [
    ticket({ id: 'a', createdAt: '2026-10-10T09:50:00.000Z' }),
    ticket({ id: 'b', createdAt: '2026-10-10T09:55:00.000Z' }),
    ticket({ id: 'c', createdAt: '2026-10-10T09:58:00.000Z' }),
  ];
  const alone = estimate(ticket(), [], () => null, DAY);
  const queued = estimate(ticket(), ahead, () => null, DAY);

  assert.equal(queued.ticketsAhead, 3);
  assert.ok(queued.minutes > alone.minutes, 'queued should wait longer');
  assert.match(queued.explanation, /3 ahead/);
});

test('more staff on shift absorbs the same queue faster', () => {
  const ahead = Array.from({ length: 6 }, (_, i) =>
    ticket({ id: `a${i}`, createdAt: `2026-10-10T09:5${i}:00.000Z` }),
  );
  // housekeeping: 3 on days, 1 at night
  const day = estimate(ticket(), ahead, () => null, DAY);
  const night = estimate(ticket(), ahead, () => null, NIGHT);

  assert.equal(day.servers, 3);
  assert.equal(night.servers, 1);
  assert.ok(night.minutes > day.minutes, 'a thinner night crew should be slower');
});

test('urgent clinical never queues', () => {
  const ahead = Array.from({ length: 10 }, (_, i) =>
    ticket({
      id: `n${i}`,
      departmentId: 'nursing',
      categoryId: 'clinical',
      priority: 'high',
      createdAt: '2026-10-10T09:00:00.000Z',
    }),
  );
  const urgent = estimate(
    ticket({ departmentId: 'nursing', categoryId: 'urgent_clinical', priority: 'critical' }),
    ahead,
    () => null,
    DAY,
  );
  assert.equal(urgent.waitMinutes, 0);
  assert.equal(urgent.queued, false);
  assert.match(urgent.explanation, /interrupts/);
});

test('only the same department queues against you', () => {
  const otherDept = Array.from({ length: 8 }, (_, i) =>
    ticket({ id: `f${i}`, departmentId: 'food', categoryId: 'dietary' }),
  );
  const result = estimate(ticket(), otherDept, () => null, DAY);
  assert.equal(result.ticketsAhead, 0, 'a food backlog must not delay housekeeping');
});

test('completed work does not count against the queue', () => {
  const done = [ticket({ id: 'x', status: 'done', createdAt: '2026-10-10T09:00:00.000Z' })];
  const result = estimate(ticket(), done, () => null, DAY);
  assert.equal(result.ticketsAhead, 0);
});

test('patient acuity stretches mobility tasks', () => {
  const bedBound = { mobility: 'Assist x2 / bed bound', fallRisk: 'High' };
  const independent = { mobility: 'Independent', fallRisk: 'Low' };

  assert.ok(acuityFactor('mobility', bedBound) > acuityFactor('mobility', independent));
  // bringing a tray does not get slower because the patient uses a walker
  assert.equal(acuityFactor('dietary', bedBound), 1);

  const slow = estimate(
    ticket({ categoryId: 'mobility', departmentId: 'pct', priority: 'high' }),
    [],
    () => bedBound,
    DAY,
  );
  const quick = estimate(
    ticket({ categoryId: 'mobility', departmentId: 'pct', priority: 'high' }),
    [],
    () => independent,
    DAY,
  );
  assert.ok(slow.minutes > quick.minutes);
});

test('food services slows during meal service', () => {
  const base = ticket({ categoryId: 'dietary', departmentId: 'food' });
  const offPeak = estimate(base, [], () => null, DAY);
  const mealtime = estimate(base, [], () => null, LUNCH);
  assert.equal(offPeak.breakdown.surge, 1);
  assert.ok(mealtime.breakdown.surge > 1);
  assert.ok(mealtime.minutes >= offPeak.minutes);
});

test('staffing table is honoured and never divides by zero', () => {
  for (const dept of ['nursing', 'pct', 'housekeeping', 'food', 'unitclerk']) {
    for (const shift of ['day', 'evening', 'night']) {
      assert.ok(staffOnDuty(dept, shift) >= 1, `${dept}/${shift}`);
    }
  }
  assert.ok(staffOnDuty('nonexistent', 'day') >= 1);
});

test('every estimate explains itself', () => {
  const result = estimate(ticket(), [ticket({ id: 'z' })], () => null, DAY);
  assert.ok(result.explanation.length > 0);
  assert.ok(result.breakdown.base > 0);
  assert.ok(result.low <= result.minutes && result.minutes <= result.high);
});
