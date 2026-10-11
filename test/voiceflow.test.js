import test from 'node:test';
import assert from 'node:assert/strict';
import { runVoiceFlow } from '../src/voiceFlow.js';
import { PHRASES } from '../src/phrases.js';

const phrases = PHRASES.en;

/** Build a flow harness with scripted microphone answers. */
function harness({ answers, routings, sendImpl } = {}) {
  const spoken = [];
  const phases = [];
  const sent = [];
  let listenCall = 0;

  const deps = {
    phrases,
    locale: 'en-US',
    speak: async (text) => {
      spoken.push(text);
      return true;
    },
    listen: async () => {
      const answer = answers[listenCall] ?? { transcript: '', error: 'no-speech' };
      listenCall += 1;
      return answer;
    },
    classify: async (text) => {
      const routing = routings[text];
      return routing ?? { categoryId: 'unclassified', departmentId: 'nursing' };
    },
    send: async (text) => {
      sent.push(text);
      if (sendImpl) return sendImpl(text);
      return { id: 'ticket-1', departmentName: 'Housekeeping & Facilities' };
    },
    departmentName: (_id, fallback) => fallback,
    onPhase: (phase) => phases.push(phase),
    onSay: () => {},
    onHeard: () => {},
  };

  return { deps, spoken, phases, sent, listens: () => listenCall };
}

test('a clear request is sent and confirmed out loud on the first try', async () => {
  const h = harness({
    answers: [{ transcript: 'can I have an extra pillow', error: null }],
    routings: {
      'can I have an extra pillow': { categoryId: 'comfort', departmentId: 'housekeeping' },
    },
  });

  const result = await runVoiceFlow(h.deps);

  assert.equal(result.outcome, 'sent');
  assert.equal(result.attempts, 1);
  assert.deepEqual(h.sent, ['can I have an extra pillow']);
  assert.equal(h.spoken[0], phrases.prompt);
  assert.match(h.spoken[1], /Your request is sent to Housekeeping & Facilities/);
  assert.deepEqual(h.phases, ['prompting', 'listening', 'thinking', 'sent']);
});

test('the spoken confirmation no longer predicts a wait time', async () => {
  const h = harness({
    answers: [{ transcript: 'water please', error: null }],
    routings: { 'water please': { categoryId: 'dietary', departmentId: 'food' } },
  });
  await runVoiceFlow(h.deps);

  const confirmation = h.spoken.at(-1);
  assert.doesNotMatch(confirmation, /\d/, `no numbers in: ${confirmation}`);
  assert.doesNotMatch(confirmation, /minute/i);
});

test('an answer it cannot understand is discarded and the patient is asked again', async () => {
  const h = harness({
    answers: [
      { transcript: 'mmhm aaah', error: null },
      { transcript: 'I need a blanket', error: null },
    ],
    routings: { 'I need a blanket': { categoryId: 'comfort', departmentId: 'housekeeping' } },
  });

  const result = await runVoiceFlow(h.deps);

  assert.equal(result.outcome, 'sent');
  assert.equal(result.attempts, 2);
  // the first, unusable answer was thrown away -- only the second was sent
  assert.deepEqual(h.sent, ['I need a blanket']);
  assert.equal(h.spoken[0], phrases.prompt);
  assert.equal(h.spoken[1], phrases.retry);
});

test('silence is retried once, then it stops without sending anything', async () => {
  const h = harness({
    answers: [
      { transcript: '', error: 'no-speech' },
      { transcript: '', error: 'no-speech' },
    ],
    routings: {},
  });

  const result = await runVoiceFlow(h.deps);

  assert.equal(result.outcome, 'gaveup');
  assert.equal(result.attempts, 2);
  assert.equal(h.listens(), 2, 'exactly two tries, no endless loop');
  assert.deepEqual(h.sent, [], 'background noise must not create tickets');
  assert.equal(h.spoken.at(-1), phrases.gaveUp);
});

test('two unintelligible answers hand the last one to a nurse', async () => {
  const h = harness({
    answers: [
      { transcript: 'first mumble', error: null },
      { transcript: 'second mumble', error: null },
    ],
    routings: {},
  });

  const result = await runVoiceFlow(h.deps);

  assert.equal(result.outcome, 'handoff');
  assert.deepEqual(h.sent, ['second mumble'], 'the newest answer, not the discarded one');
  assert.equal(h.spoken.at(-1), phrases.handoff);
});

test('it never tries more than twice', async () => {
  const h = harness({
    answers: Array.from({ length: 6 }, () => ({ transcript: '', error: 'no-speech' })),
    routings: {},
  });
  await runVoiceFlow(h.deps);
  assert.equal(h.listens(), 2);
});

test('a refused microphone stops immediately and reports blocked', async () => {
  const h = harness({
    answers: [{ transcript: '', error: 'not-allowed' }],
    routings: {},
  });

  const result = await runVoiceFlow(h.deps);

  assert.equal(result.outcome, 'blocked');
  assert.equal(result.attempts, 1);
  assert.equal(h.listens(), 1, 'no point retrying a permission refusal');
  assert.deepEqual(h.sent, []);
});

test('an urgent request is announced as an escalation, not a routed ticket', async () => {
  const h = harness({
    answers: [{ transcript: 'my chest hurts', error: null }],
    routings: {
      'my chest hurts': {
        categoryId: 'urgent_clinical',
        departmentId: 'nursing',
        escalated: true,
      },
    },
  });

  await runVoiceFlow(h.deps);
  assert.equal(h.spoken.at(-1), phrases.urgent);
});

test('leaving the screen mid-flow stops it cleanly', async () => {
  const h = harness({
    answers: [{ transcript: 'a blanket', error: null }],
    routings: { 'a blanket': { categoryId: 'comfort', departmentId: 'housekeeping' } },
  });

  const result = await runVoiceFlow({ ...h.deps, isCancelled: () => true });

  assert.equal(result.outcome, 'cancelled');
  assert.deepEqual(h.sent, []);
});

test('a classifier error is retried rather than crashing the flow', async () => {
  const h = harness({
    answers: [
      { transcript: 'broken', error: null },
      { transcript: 'a pillow', error: null },
    ],
    routings: { 'a pillow': { categoryId: 'comfort', departmentId: 'housekeeping' } },
  });
  h.deps.classify = async (text) => {
    if (text === 'broken') throw new Error('network');
    return { categoryId: 'comfort', departmentId: 'housekeeping' };
  };

  const result = await runVoiceFlow(h.deps);
  assert.equal(result.outcome, 'sent');
  assert.deepEqual(h.sent, ['a pillow']);
});

test('Spanish runs the whole loop in Spanish', async () => {
  const h = harness({
    answers: [{ transcript: 'necesito una manta', error: null }],
    routings: { 'necesito una manta': { categoryId: 'comfort', departmentId: 'housekeeping' } },
  });
  h.deps.phrases = PHRASES.es;
  h.deps.locale = 'es-ES';
  h.deps.departmentName = () => 'limpieza';

  await runVoiceFlow(h.deps);

  assert.equal(h.spoken[0], PHRASES.es.prompt);
  assert.match(h.spoken.at(-1), /Su solicitud fue enviada a limpieza/);
});

test('a refused microphone permission stops before speaking anything', async () => {
  const h = harness({ answers: [], routings: {} });
  const result = await runVoiceFlow({
    ...h.deps,
    ensurePermission: async () => ({ ok: false, reason: 'insecure-origin' }),
  });

  assert.equal(result.outcome, 'blocked');
  assert.equal(result.reason, 'insecure-origin');
  assert.equal(result.attempts, 0);
  assert.deepEqual(h.spoken, [], 'no point talking to a patient we cannot hear');
  assert.equal(h.listens(), 0);
});

test('a granted microphone permission runs the flow normally', async () => {
  const h = harness({
    answers: [{ transcript: 'a pillow please', error: null }],
    routings: { 'a pillow please': { categoryId: 'comfort', departmentId: 'housekeeping' } },
  });
  const result = await runVoiceFlow({ ...h.deps, ensurePermission: async () => ({ ok: true }) });

  assert.equal(result.outcome, 'sent');
  assert.deepEqual(h.sent, ['a pillow please']);
});

test('a network failure in recognition is reported, not retried forever', async () => {
  const h = harness({
    answers: [{ transcript: '', error: 'network' }],
    routings: {},
  });
  const result = await runVoiceFlow(h.deps);
  assert.equal(result.outcome, 'blocked');
  assert.equal(result.reason, 'network');
  assert.equal(h.listens(), 1);
});
