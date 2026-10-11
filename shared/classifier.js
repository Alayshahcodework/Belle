// Belle's triage engine.
//
// Deterministic, explainable, offline. Every routing decision can be shown to a
// judge (or a nurse manager) as the exact phrases that produced it, which is
// something a black-box model call cannot do.
//
// Two stages, in this order:
//   1. Clinical red flags. Any hit escalates to the nurse immediately and stops.
//      This runs first so no amount of hospitality keywords can outvote
//      "I feel dizzy".
//   2. Weighted keyword scoring across the non-clinical categories.
//
// If stage 2 does not clear a confidence floor the request is NOT guessed at --
// it goes to a clinician as `unclassified`. Belle never silently drops a
// request into a hospitality queue it is unsure about.

import { CATEGORIES, departmentFor } from './config.js';

const MIN_SCORE = 3;

// `*` at the end of a term matches the rest of the word (sangr* -> sangrando).
function toRegex(term) {
  const escaped = term
    .replace(/[.*+?^${}()|[\]\\]/g, (c) => (c === '*' ? '\u0000' : '\\' + c))
    .replace(/\u0000/g, '[a-z0-9]*');
  return new RegExp(`(?<![a-z0-9])${escaped}(?![a-z0-9])`, 'i');
}

function compile(entries) {
  return entries.map(([term, weight]) => ({ term, weight, re: toRegex(term) }));
}

export function normalize(text) {
  return (text ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // drop accents: baño -> bano
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// ---------------------------------------------------------------------------
// Stage 1: clinical red flags (English + Spanish)
// ---------------------------------------------------------------------------
const RED_FLAGS = compile([
  // airway / breathing / cardiac
  ['chest pain', 10],
  ['my chest', 8],
  ['chest is tight', 10],
  ['cant breathe', 10],
  ['can t breathe', 10],
  ['cannot breathe', 10],
  ['trouble breathing', 10],
  ['hard to breathe', 10],
  ['short of breath', 10],
  ['heart racing', 8],
  ['palpitation*', 8],
  // neuro
  ['dizzy', 8],
  ['dizziness', 8],
  ['lightheaded', 8],
  ['light headed', 8],
  ['passed out', 10],
  ['fainted', 10],
  ['faint', 6],
  ['numb', 8],
  ['slurr*', 8],
  ['confused', 6],
  ['vision', 6],
  ['worst headache', 10],
  // bleeding / wound / post-op
  ['bleeding', 10],
  ['blood', 7],
  ['sangr*', 10],
  ['incision', 9],
  ['stitches', 7],
  ['staples', 7],
  ['wound', 7],
  ['drain', 6],
  ['iv is', 7],
  ['my iv', 7],
  // falls / acute distress
  ['i fell', 10],
  ['ive fallen', 10],
  ['i have fallen', 10],
  ['on the floor', 6],
  ['cant move', 9],
  ['cant get up', 9],
  ['emergency', 10],
  ['911', 10],
  ['help me now', 9],
  ['something is wrong', 8],
  ['allergic', 10],
  ['swelling', 7],
  ['vomit*', 7],
  ['throwing up', 7],
  ['chills', 6],
  ['fever', 6],
  ['worst pain', 9],
  ['10 out of 10', 9],
  ['unbearable', 9],
  // Spanish
  ['dolor de pecho', 10],
  ['no puedo respirar', 10],
  ['me duele el pecho', 10],
  ['mareado', 8],
  ['mareada', 8],
  ['me cai', 10],
  ['desmay*', 10],
  ['emergencia', 10],
  ['no puedo moverme', 9],
  ['ayuda ahora', 9],
]);

// ---------------------------------------------------------------------------
// Stage 2: non-urgent categories
// ---------------------------------------------------------------------------
const KEYWORDS = {
  // Still clinical, just not an emergency -> nurse, high priority.
  clinical: compile([
    ['pain', 6],
    ['hurts', 6],
    ['hurting', 6],
    ['ache', 5],
    ['aching', 5],
    ['throbbing', 6],
    ['sore', 4],
    ['nausea', 6],
    ['nauseous', 6],
    ['sick', 5],
    ['medication', 7],
    ['medicine', 7],
    ['meds', 7],
    ['pill*', 5],
    ['dose', 6],
    ['itchy', 4],
    ['rash', 5],
    ['catheter', 7],
    ['oxygen', 7],
    ['dressing', 5],
    ['bandage', 5],
    ['dolor', 6],
    ['me duele', 6],
    ['medicina', 7],
    ['nausea*', 6],
  ]),

  mobility: compile([
    ['to the bathroom', 8],
    ['use the bathroom', 8],
    ['go to the bathroom', 8],
    ['need the bathroom', 8],
    ['to the restroom', 8],
    ['bedpan', 9],
    ['commode', 9],
    ['urinal', 8],
    ['bedside toilet', 8],
    ['help me up', 8],
    ['get out of bed', 8],
    ['out of bed', 6],
    ['sit up', 6],
    ['stand up', 6],
    ['reposition', 7],
    ['turn me', 7],
    ['walk', 5],
    ['my walker', 7],
    ['wheelchair', 7],
    ['pee', 6],
    ['urinate', 7],
    ['ir al bano', 8],
    ['al bano', 7],
    ['levantarme', 8],
    ['orinar', 7],
  ]),

  dietary: compile([
    ['water', 5],
    ['ice', 5],
    ['ice chips', 7],
    ['juice', 7],
    ['apple juice', 8],
    ['soda', 6],
    ['ginger ale', 7],
    ['coffee', 7],
    ['tea', 6],
    ['drink', 6],
    ['thirsty', 8],
    ['hungry', 8],
    ['snack', 8],
    ['crackers', 8],
    ['jello', 7],
    ['pudding', 7],
    ['food', 6],
    ['meal', 7],
    ['tray', 6],
    ['breakfast', 7],
    ['lunch', 7],
    ['dinner', 7],
    ['straw', 6],
    ['cup', 4],
    ['refill', 5],
    // Named foods. Gemini handles the long tail, but the offline fallback
    // should still cope with what people actually ask for.
    ['sandwich', 8],
    ['soup', 8],
    ['toast', 7],
    ['cereal', 7],
    ['oatmeal', 7],
    ['eggs', 7],
    ['fruit', 7],
    ['banana', 7],
    ['apple', 6],
    ['yogurt', 7],
    ['ice cream', 7],
    ['cookie*', 7],
    ['salad', 7],
    ['chicken', 6],
    ['bread', 7],
    ['milk', 7],
    ['napkin*', 6],
    ['fork', 6],
    ['spoon', 6],
    ['eat', 6],
    ['something to eat', 9],
    ['agua', 6],
    ['hielo', 6],
    ['jugo', 7],
    ['comida', 7],
    ['hambre', 8],
    ['sed', 7],
    ['galletas', 8],
    ['cafe', 6],
  ]),

  comfort: compile([
    ['blanket*', 8],
    ['pillow*', 8],
    ['sheet*', 6],
    ['linen*', 7],
    ['towel*', 7],
    ['washcloth', 7],
    ['gown', 6],
    ['socks', 6],
    ['manta', 8],
    ['cobija', 8],
    ['almohada', 8],
    ['sabanas', 7],
    ['toalla', 7],
  ]),

  room_environment: compile([
    ['cold', 6],
    ['freezing', 7],
    ['hot', 5],
    ['stuffy', 6],
    ['temperature', 6],
    ['thermostat', 8],
    ['air conditioning', 8],
    ['heat', 5],
    ['clean', 7],
    ['cleaning', 8],
    ['dirty', 8],
    ['sticky', 8],
    ['messy', 7],
    ['spill*', 8],
    ['trash', 8],
    ['garbage', 8],
    ['smell*', 6],
    ['floor', 4],
    ['toilet', 5],
    ['sink', 5],
    ['mop', 7],
    ['limpiar', 8],
    ['limpieza', 8],
    ['sucio', 8],
    ['basura', 8],
    ['frio', 6],
    ['calor', 5],
  ]),

  tech_amenities: compile([
    ['tv', 8],
    ['television', 8],
    ['remote', 8],
    ['channel*', 7],
    ['volume', 6],
    ['phone', 7],
    ['telephone', 7],
    ['wifi', 8],
    ['wi fi', 8],
    ['internet', 7],
    ['tablet', 6],
    ['charger', 7],
    ['charge', 5],
    ['outlet', 6],
    ['plug', 5],
    ['light', 5],
    ['lights', 6],
    ['lamp', 6],
    ['blinds', 6],
    ['curtain', 5],
    ['televisor', 8],
    ['control remoto', 8],
    ['telefono', 7],
    ['luces', 6],
  ]),

  admin: compile([
    ['doctor coming', 7],
    ['when is', 4],
    ['discharge', 8],
    ['paperwork', 7],
    ['visitor*', 7],
    ['my family', 6],
    ['question', 5],
    ['chaplain', 7],
    ['interpreter', 8],
    ['social work*', 8],
    ['wondering', 4],
  ]),
};

function scoreAgainst(text, compiled) {
  let score = 0;
  const matched = [];
  for (const entry of compiled) {
    if (entry.re.test(text)) {
      score += entry.weight;
      matched.push(entry.term);
    }
  }
  return { score, matched };
}

function confidenceFrom(top, second) {
  if (top <= 0) return 0;
  const strength = Math.min(top, 12) / 12; // how much evidence at all
  const margin = (top - second) / top; // how clearly it beat the runner-up
  return Math.round((0.45 * strength + 0.55 * margin) * 100) / 100;
}

function result(categoryId, { confidence, matched, redFlags = [], alternative = null }) {
  const category = CATEGORIES[categoryId];
  const department = departmentFor(categoryId);
  return {
    categoryId: category.id,
    categoryLabel: category.label,
    departmentId: department.id,
    departmentName: department.name,
    priority: category.priority,
    confidence,
    matched,
    redFlags,
    alternative,
    escalated: category.priority === 'critical',
  };
}

/**
 * Classify raw patient text into a routed, structured ticket shape.
 * @param {string} rawText anything the patient typed or dictated
 * @returns {object} routing decision, always with a department
 */
export function classify(rawText) {
  const text = normalize(rawText);

  if (!text) {
    return result('unclassified', { confidence: 0, matched: [] });
  }

  // Stage 1 -- safety first, short-circuits everything below.
  const flags = scoreAgainst(text, RED_FLAGS);
  if (flags.score > 0) {
    return result('urgent_clinical', {
      confidence: Math.min(0.99, 0.6 + flags.score / 30),
      matched: flags.matched,
      redFlags: flags.matched,
    });
  }

  // Stage 2 -- weighted scoring across the remaining categories.
  const ranked = Object.entries(KEYWORDS)
    .map(([categoryId, compiled]) => ({ categoryId, ...scoreAgainst(text, compiled) }))
    .sort((a, b) => b.score - a.score);

  const [top, second] = ranked;

  if (!top || top.score < MIN_SCORE) {
    return result('unclassified', { confidence: 0, matched: top?.matched ?? [] });
  }

  const confidence = confidenceFrom(top.score, second?.score ?? 0);

  // Weak, contested match: do not gamble on a hospitality queue.
  if (confidence < 0.25) {
    return result('unclassified', {
      confidence,
      matched: top.matched,
      alternative: top.categoryId,
    });
  }

  return result(top.categoryId, {
    confidence,
    matched: top.matched,
    alternative: second && second.score > 0 ? second.categoryId : null,
  });
}
