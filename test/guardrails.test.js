import test from 'node:test';
import assert from 'node:assert/strict';
import { applyGuardrails } from '../server/guardrails.js';
import { classify } from '../shared/classifier.js';
import { allPatients, patientByCard, patientCount } from '../server/patients.js';

const npoPatient = {
  npo: true,
  dietOrder: 'NPO after midnight (cath)',
  allergies: 'NKDA',
  mobility: 'Walker',
  fallRisk: 'Low',
};

test('the roster loads and every card is unique', () => {
  const patients = allPatients();
  assert.equal(patients.length, patientCount);
  assert.ok(patients.length > 0);
  assert.equal(new Set(patients.map((p) => p.cardId)).size, patients.length);
  assert.equal(new Set(patients.map((p) => p.patientId)).size, patients.length);
  assert.equal(new Set(patients.map((p) => p.room)).size, patients.length);
});

test('card lookup is case insensitive and accepts a bare id', () => {
  const sample = allPatients()[0];
  assert.equal(patientByCard(sample.cardId)?.patientId, sample.patientId);
  assert.equal(patientByCard(sample.cardId.toLowerCase())?.patientId, sample.patientId);
  assert.equal(patientByCard(sample.cardId.replace('CARD-', ''))?.patientId, sample.patientId);
  assert.equal(patientByCard('CARD-NOPE'), null);
  assert.equal(patientByCard(null), null);
});

test('CSV quoting does not shift columns', () => {
  // "Renal (low K, low phos)" has an embedded comma -- a naive split would
  // push allergies into preferred_language.
  const languages = new Set(allPatients().map((p) => p.language));
  for (const language of languages) {
    assert.ok(
      !/penicillin|nkda|latex|sulfa/i.test(language),
      `allergy leaked into language field: ${language}`,
    );
  }
});

test('an NPO patient asking for water does not generate a food ticket', () => {
  const routing = classify('can I please have some ice water');
  assert.equal(routing.categoryId, 'dietary', 'precondition: words say dietary');

  const { routing: guarded, flags } = applyGuardrails(routing, npoPatient);
  assert.equal(guarded.categoryId, 'clinical');
  assert.equal(guarded.overriddenFrom, 'dietary');
  assert.match(guarded.overrideReason, /NPO/);
  assert.ok(flags.length > 0);
});

test('dysphagia and fluid restriction also divert to the nurse', () => {
  const routing = classify('I am thirsty, can I get a drink');

  const dysphagia = applyGuardrails(routing, {
    dysphagia: true,
    dietOrder: 'Dysphagia (pureed, nectar-thick liquids)',
  });
  assert.equal(dysphagia.routing.categoryId, 'clinical');
  assert.match(dysphagia.routing.overrideReason, /thickened/i);

  const restricted = applyGuardrails(routing, {
    fluidRestricted: true,
    dietOrder: 'Cardiac (2g Na), 1.5L fluid restriction',
  });
  assert.equal(restricted.routing.categoryId, 'clinical');
  assert.match(restricted.routing.overrideReason, /fluid restriction/i);
});

test('a normal diet order passes through as context, not an override', () => {
  const routing = classify('can I get some apple juice');
  const { routing: guarded, flags } = applyGuardrails(routing, {
    dietOrder: 'Regular',
    allergies: 'NKDA',
  });
  assert.equal(guarded.categoryId, 'dietary');
  assert.equal(guarded.overriddenFrom, undefined);
  assert.ok(flags.some((f) => /Diet order: Regular/.test(f)));
});

test('fall risk and two-person assist are flagged on toileting requests', () => {
  const routing = classify('I need help to the bathroom');
  const { routing: guarded, flags } = applyGuardrails(routing, {
    highFallRisk: true,
    mobility: 'Assist x2 / bed bound',
    allergies: 'Penicillin',
  });
  assert.equal(guarded.categoryId, 'mobility', 'still a care-tech job');
  assert.ok(flags.some((f) => /HIGH FALL RISK/.test(f)));
  assert.ok(flags.some((f) => /Two-person assist/.test(f)));
  assert.ok(flags.some((f) => /Allergy: Penicillin/.test(f)));
});

test('guardrails never touch an urgent clinical escalation', () => {
  const routing = classify('my chest hurts and I feel dizzy');
  const { routing: guarded } = applyGuardrails(routing, npoPatient);
  assert.equal(guarded.categoryId, 'urgent_clinical');
});

test('no patient means no guardrails, and nothing crashes', () => {
  const routing = classify('can I have a blanket');
  const { routing: guarded, flags } = applyGuardrails(routing, null);
  assert.equal(guarded.categoryId, 'comfort');
  assert.deepEqual(flags, []);
});
