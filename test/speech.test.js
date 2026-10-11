import test from 'node:test';
import assert from 'node:assert/strict';

// speech.js reads browser globals at import time, so they have to exist first.
function installFakeBrowser({ utteranceBehaviour }) {
  const spoken = [];

  class FakeUtterance {
    constructor(text) {
      this.text = text;
    }
  }

  const synth = {
    getVoices: () => [{ lang: 'en-US', name: 'Fake' }],
    cancel() {},
    speak(utterance) {
      spoken.push(utterance.text);
      utteranceBehaviour(utterance);
    },
    set onvoiceschanged(_fn) {},
  };

  globalThis.window = {
    speechSynthesis: synth,
    SpeechRecognition: undefined,
    webkitSpeechRecognition: undefined,
  };
  globalThis.SpeechSynthesisUtterance = FakeUtterance;
  return { spoken };
}

test('speech that never starts does not stall the flow', async () => {
  // Chrome's autoplay policy silently refuses speechSynthesis before a user
  // gesture: speak() is accepted but NO events ever fire. Waiting on `onend`
  // held the microphone shut for five seconds. It must bail out quickly.
  installFakeBrowser({ utteranceBehaviour: () => {} });
  const { speak } = await import(`../src/speech.js?case=silent-${Date.now()}`);

  const began = Date.now();
  const result = await speak('Record your request.', 'en-US');
  const elapsed = Date.now() - began;

  assert.equal(result, false, 'reports that it did not speak');
  assert.ok(elapsed < 1500, `resolved in ${elapsed}ms, expected under 1500ms`);
});

test('speech that starts is awaited to the end', async () => {
  installFakeBrowser({
    utteranceBehaviour: (utterance) => {
      setTimeout(() => utterance.onstart?.(), 10);
      setTimeout(() => utterance.onend?.(), 120);
    },
  });
  const { speak } = await import(`../src/speech.js?case=normal-${Date.now()}`);

  const began = Date.now();
  const result = await speak('Record your request.', 'en-US');
  const elapsed = Date.now() - began;

  assert.equal(result, true);
  assert.ok(elapsed >= 100, `waited ${elapsed}ms for speech to finish`);
  assert.ok(elapsed < 1500);
});

test('a speech error resolves instead of hanging', async () => {
  installFakeBrowser({
    utteranceBehaviour: (utterance) => setTimeout(() => utterance.onerror?.({}), 10),
  });
  const { speak } = await import(`../src/speech.js?case=error-${Date.now()}`);
  assert.equal(await speak('hello', 'en-US'), false);
});

test('empty text is a no-op', async () => {
  const fake = installFakeBrowser({ utteranceBehaviour: () => {} });
  const { speak } = await import(`../src/speech.js?case=empty-${Date.now()}`);
  assert.equal(await speak('', 'en-US'), false);
  assert.deepEqual(fake.spoken, []);
});

test('listening reports unsupported rather than throwing', async () => {
  installFakeBrowser({ utteranceBehaviour: () => {} });
  const { listenOnce, recognitionSupported } = await import(
    `../src/speech.js?case=norec-${Date.now()}`
  );
  assert.equal(recognitionSupported, false);
  assert.deepEqual(await listenOnce({ lang: 'en-US' }), {
    transcript: '',
    error: 'unsupported',
  });
});
