import test from 'node:test';
import assert from 'node:assert/strict';
import { triage, clearTriageCache } from '../server/triage.js';

// The orchestrator is tested with a stubbed model so these never touch the
// network, never spend quota, and never flake.
const fakeGemini = (categoryId, extra = {}) => {
  const calls = [];
  const fn = async (text) => {
    calls.push(text);
    return categoryId ? { categoryId, confidence: 0.9, reasoning: 'stub', ...extra } : null;
  };
  fn.calls = calls;
  return fn;
};

test.beforeEach(() => {
  clearTriageCache();
  process.env.GEMINI_API_KEY = 'test-key';
});

test('clinical red flags are decided locally and never reach the network', async () => {
  const gemini = fakeGemini('dietary'); // would misroute if consulted
  const result = await triage('my chest hurts and I feel dizzy', { gemini });

  assert.equal(result.departmentId, 'nursing');
  assert.equal(result.priority, 'critical');
  assert.equal(result.engine, 'rules:red-flag');
  assert.equal(gemini.calls.length, 0, 'an emergency must not depend on an API call');
});

test('a hospitality request the keyword list never knew is routed by the model', async () => {
  const gemini = fakeGemini('dietary');
  const result = await triage('I want a sandwich', { gemini });

  assert.equal(result.departmentId, 'food');
  assert.equal(result.categoryId, 'dietary');
  assert.equal(result.engine, 'gemini');
});

test('identical wording is answered from cache, not re-billed', async () => {
  const gemini = fakeGemini('dietary');
  const first = await triage('bring me a toasted bagel', { gemini });
  const second = await triage('Bring me a toasted bagel!', { gemini });

  assert.equal(first.engine, 'gemini');
  assert.equal(second.engine, 'gemini:cached');
  assert.equal(second.departmentId, 'food');
  assert.equal(gemini.calls.length, 1, 'only one API call for the same request');
});

test('when the model is unavailable the keyword engine still answers', async () => {
  const dead = fakeGemini(null); // rate-limited, down, or bad JSON
  const result = await triage('can I get some ice water', { gemini: dead });

  assert.equal(result.departmentId, 'food');
  assert.equal(result.engine, 'rules:fallback');
});

test('an unavailable model still routes unknown text to a human', async () => {
  const dead = fakeGemini(null);
  const result = await triage('zzzzz qqqqq', { gemini: dead });

  assert.equal(result.categoryId, 'unclassified');
  assert.equal(result.departmentId, 'nursing');
});

test('the model cannot downgrade a clinical signal to hospitality', async () => {
  // "my pain medication" is clinical to the keyword engine. If the model
  // calls it a snack request, the safer reading must win.
  const wrong = fakeGemini('dietary');
  const result = await triage('I need my pain medication', { gemini: wrong });

  assert.equal(result.departmentId, 'nursing');
  assert.equal(result.categoryId, 'clinical');
  assert.match(result.engine, /safety-override/);
});

test('a confident keyword match beats the model shrugging', async () => {
  const shrug = fakeGemini('unclassified');
  const result = await triage('the television remote is broken', { gemini: shrug });

  assert.equal(result.departmentId, 'unitclerk');
  assert.match(result.engine, /recovered/);
});

test('the model may escalate something the keyword list missed', async () => {
  const gemini = fakeGemini('urgent_clinical');
  const result = await triage('my feet are swollen', { gemini });

  assert.equal(result.departmentId, 'nursing');
  assert.equal(result.priority, 'critical');
  assert.equal(result.engine, 'gemini');
});

test('a junk category from the model is rejected, not trusted', async () => {
  const rogue = async () => ({ categoryId: 'free_pizza', confidence: 1, reasoning: 'x' });
  const result = await triage('I want a sandwich', { gemini: rogue });

  // decorate() falls back to unclassified for an unknown category, which
  // routes to a clinician rather than nowhere.
  assert.ok(['dietary', 'unclassified'].includes(result.categoryId));
  assert.ok(result.departmentId);
});

test('empty input is safe and costs nothing', async () => {
  const gemini = fakeGemini('dietary');
  const result = await triage('   ', { gemini });
  assert.equal(result.categoryId, 'unclassified');
  assert.equal(gemini.calls.length, 0);
});

test('with no API key configured the keyword engine runs alone', async () => {
  delete process.env.GEMINI_API_KEY;
  const gemini = fakeGemini('dietary');
  const result = await triage('can I have a blanket', { gemini });

  assert.equal(result.engine, 'rules');
  assert.equal(result.departmentId, 'housekeeping');
  assert.equal(gemini.calls.length, 0);
  process.env.GEMINI_API_KEY = 'test-key';
});

test('every decision names the engine that made it', async () => {
  const gemini = fakeGemini('comfort');
  const result = await triage('something soft for my head', { gemini });
  assert.ok(result.engine, 'auditable: the board can show which engine decided');
  assert.ok(result.departmentName);
  assert.ok(result.categoryLabel);
});
