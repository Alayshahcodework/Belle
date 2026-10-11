// Chart-aware safety guardrails.
//
// The classifier reads the words. These rules read the patient's chart and can
// override the routing. The driving case: a patient who is NPO (nothing by
// mouth, often pre-op or pending a swallow evaluation) asks for ice water.
// The words are a textbook Food Services request. Honouring it could put the
// patient at real risk, so it goes to the nurse instead, with the reason
// attached.
//
// This is the part of triage a pure language model cannot do, because the
// answer is not in the sentence -- it is in the chart.

const DIETARY = new Set(['dietary']);

export function applyGuardrails(routing, patient) {
  if (!patient) return { routing, flags: [] };

  const flags = [];
  let next = routing;

  // `code` is what the bedside screen uses to explain the diversion to the
  // patient in plain language; `reason` is the clinical note for staff.
  const override = (categoryId, code, reason) => {
    flags.push(reason);
    next = {
      ...next,
      categoryId,
      overriddenFrom: routing.categoryId,
      overrideCode: code,
      overrideReason: reason,
    };
  };

  if (DIETARY.has(routing.categoryId)) {
    if (patient.npo) {
      override(
        'clinical',
        'npo',
        `Patient is NPO (${patient.dietOrder}) — food and fluids must be cleared by the nurse`,
      );
    } else if (patient.dysphagia) {
      override(
        'clinical',
        'dysphagia',
        `Dysphagia diet (${patient.dietOrder}) — liquids must be thickened to order`,
      );
    } else if (patient.fluidRestricted) {
      override(
        'clinical',
        'fluid',
        `Fluid restriction in effect (${patient.dietOrder}) — nurse to verify intake`,
      );
    } else if (patient.dietOrder) {
      // Not an override, just context the tray needs.
      flags.push(`Diet order: ${patient.dietOrder}`);
    }
  }

  if (routing.categoryId === 'mobility' && patient.highFallRisk) {
    flags.push(`HIGH FALL RISK — ${patient.mobility}. Do not leave unattended.`);
  }

  if (routing.categoryId === 'mobility' && patient.mobility === 'Assist x2 / bed bound') {
    flags.push('Two-person assist required.');
  }

  if (patient.allergies && patient.allergies !== 'NKDA') {
    flags.push(`Allergy: ${patient.allergies}`);
  }

  return { routing: next, flags };
}
