// Triage orchestration: which engine decides, and in what order.
//
// Gemini understands requests the keyword list never anticipated ("I want a
// sandwich"), but it is a network call on a rate-limited key. So it is not
// asked about everything:
//
//   1. Clinical red flags are matched locally and NEVER go to the network.
//      An emergency must not depend on an API call succeeding, or on a quota.
//   2. Identical wording is answered from a cache. The six quick buttons send
//      fixed strings, so they cost nothing after the first time.
//   3. Everything else goes to Gemini.
//   4. If Gemini is slow, rate-limited or returns nonsense, the keyword engine
//      answers instead. The product degrades, it does not stop.
//   5. A safety cross-check runs afterwards: if the keyword engine saw a
//      clinical signal and Gemini did not, the clinical reading wins.
//
// Only the words of the request are sent to Google. No patient identity.

import { classify as classifyWithRules } from '../shared/classifier.js';
import { CATEGORIES, departmentFor } from '../shared/config.js';
import { normalize } from '../shared/classifier.js';
import { classifyWithGemini, geminiEnabled } from './gemini.js';

const CLINICAL = new Set(['urgent_clinical', 'clinical']);
const CACHE_LIMIT = 500;
const cache = new Map();

function cached(key) {
  if (!cache.has(key)) return null;
  const value = cache.get(key);
  cache.delete(key); // refresh LRU position
  cache.set(key, value);
  return value;
}

function remember(key, value) {
  cache.set(key, value);
  if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value);
}

export function clearTriageCache() {
  cache.clear();
}

function decorate(routing) {
  const category = CATEGORIES[routing.categoryId] ?? CATEGORIES.unclassified;
  const department = departmentFor(category.id);
  return {
    ...routing,
    categoryId: category.id,
    categoryLabel: category.label,
    departmentId: department.id,
    departmentName: department.name,
    priority: category.priority,
    escalated: category.priority === 'critical',
  };
}

/**
 * Classify one patient utterance.
 *
 * @param {string} text
 * @param {object} [options]
 * @param {function} [options.gemini] injectable for tests
 * @returns {Promise<object>} routing decision, always with a department
 */
export async function triage(text, { gemini = classifyWithGemini } = {}) {
  const rules = classifyWithRules(text);

  // 1. Red flags: decided locally, instantly, offline.
  if (rules.priority === 'critical') {
    return decorate({ ...rules, engine: 'rules:red-flag' });
  }

  const key = normalize(text);
  if (!key) return decorate({ ...rules, engine: 'rules:empty' });

  // 2. Cache.
  const hit = cached(key);
  if (hit) return decorate({ ...hit, engine: `${hit.engine}:cached` });

  // 3. Gemini.
  let decision = null;
  if (geminiEnabled()) {
    const result = await gemini(text);
    if (result) {
      decision = {
        categoryId: result.categoryId,
        confidence: result.confidence,
        matched: [],
        redFlags: [],
        reasoning: result.reasoning,
        latencyMs: result.latencyMs,
        engine: 'gemini',
      };
    }
  }

  // 4. Fallback to the keyword engine.
  if (!decision) {
    decision = { ...rules, engine: geminiEnabled() ? 'rules:fallback' : 'rules' };
  }

  // 5. Safety cross-check. The keyword engine is literal and cannot be talked
  //    out of a symptom; if it saw one and the model did not, it wins.
  if (CLINICAL.has(rules.categoryId) && !CLINICAL.has(decision.categoryId)) {
    decision = {
      ...rules,
      engine: `${decision.engine}+rules:safety-override`,
      reasoning: `keyword engine saw a clinical signal (${rules.matched.join(', ')})`,
    };
  }

  // A confident keyword match beats the model shrugging.
  if (decision.categoryId === 'unclassified' && rules.categoryId !== 'unclassified') {
    decision = { ...rules, engine: `${decision.engine}+rules:recovered` };
  }

  remember(key, decision);
  return decorate(decision);
}
