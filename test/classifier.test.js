import test from 'node:test';
import assert from 'node:assert/strict';
import { classify } from '../shared/classifier.js';

function route(text) {
  const result = classify(text);
  return { dept: result.departmentId, category: result.categoryId, priority: result.priority };
}

test('routes the four examples from the project brief', () => {
  assert.equal(route('My room is cold and the bathroom floor is sticky.').dept, 'housekeeping');
  assert.equal(route('Can I get some ice water and apple juice?').dept, 'food');
  assert.equal(route("The television remote isn't changing channels.").dept, 'unitclerk');

  const urgent = route('My surgical incision is throbbing and I feel dizzy.');
  assert.equal(urgent.dept, 'nursing');
  assert.equal(urgent.priority, 'critical');
});

test('the demo beat: an extra pillow never reaches a nurse', () => {
  const result = route('Could I please have an extra pillow?');
  assert.equal(result.dept, 'housekeeping');
  assert.equal(result.priority, 'normal');
});

test('clinical red flags always escalate, even buried in hospitality text', () => {
  const cases = [
    'I would love some apple juice but my chest hurts',
    'can you bring a blanket, I feel really dizzy',
    'the tv is broken and I think my incision is bleeding',
    'I fell trying to reach the remote',
    'I cant breathe well',
  ];
  for (const text of cases) {
    const result = classify(text);
    assert.equal(result.departmentId, 'nursing', `should escalate: ${text}`);
    assert.equal(result.priority, 'critical', `should be critical: ${text}`);
    assert.ok(result.redFlags.length > 0, `should name a red flag: ${text}`);
  }
});

test('non-urgent clinical still goes to the nurse, at high priority', () => {
  const result = route('I think it is time for my pain medication');
  assert.equal(result.dept, 'nursing');
  assert.equal(result.priority, 'high');
});

test('toileting goes to care techs, not housekeeping', () => {
  assert.equal(route('I need help to the bathroom').dept, 'pct');
  assert.equal(route('can someone bring me a bedpan').dept, 'pct');
});

test('distinguishes "water to drink" from "water on the floor"', () => {
  assert.equal(route('can I have a cup of ice water').dept, 'food');
  assert.equal(route('someone spilled water on the floor in here').dept, 'nursing'); // floor = fall risk
});

test('handles Spanish requests', () => {
  assert.equal(route('necesito una manta por favor').dept, 'housekeeping');
  assert.equal(route('quiero agua con hielo').dept, 'food');
  assert.equal(route('me duele el pecho').priority, 'critical');
});

test('unknown text is never guessed into a hospitality queue', () => {
  const result = classify('asdfgh qwerty');
  assert.equal(result.categoryId, 'unclassified');
  assert.equal(result.departmentId, 'nursing');
});

test('empty input is safe', () => {
  assert.equal(classify('').categoryId, 'unclassified');
  assert.equal(classify(null).categoryId, 'unclassified');
});

test('every decision carries its evidence', () => {
  const result = classify('my room is freezing and the trash is full');
  assert.ok(result.matched.length > 0);
  assert.ok(result.confidence > 0);
});
