// Browser speech in and out, wrapped as promises so the bedside flow can be
// written as a straight sequence instead of a tangle of callbacks.
//
// Both directions are native to the browser: nothing is uploaded, there is no
// STT or TTS bill, and no audio leaves the tablet.

const Recognition =
  typeof window !== 'undefined'
    ? window.SpeechRecognition || window.webkitSpeechRecognition
    : null;

export const recognitionSupported = Boolean(Recognition);
export const ttsSupported = typeof window !== 'undefined' && 'speechSynthesis' in window;

// How long to wait for speech to actually begin before deciding the browser
// has silently refused it. Autoplay policy blocks speechSynthesis until a user
// gesture, and when it does, NO events fire at all -- so waiting on `onend`
// stalls the whole flow. Listening must never be held up by that.
const SPEECH_START_TIMEOUT_MS = 900;

// --- speaking ---------------------------------------------------------------

function pickVoice(lang) {
  if (!ttsSupported) return null;
  const voices = window.speechSynthesis.getVoices() || [];
  const prefix = lang.slice(0, 2).toLowerCase();
  return (
    voices.find((v) => v.lang?.toLowerCase() === lang.toLowerCase()) ||
    voices.find((v) => v.lang?.toLowerCase().startsWith(prefix)) ||
    null
  );
}

// Voices load asynchronously in some browsers; warm them up early.
if (ttsSupported) {
  window.speechSynthesis.getVoices();
  window.speechSynthesis.onvoiceschanged = () => window.speechSynthesis.getVoices();
}

/**
 * Speak a phrase.
 *
 * Resolves true once it has finished speaking, false if speech was blocked,
 * errored or never started. Either way it resolves quickly when nothing is
 * happening, so a caller can safely `await` it before opening the microphone.
 */
export function speak(text, lang = 'en-US') {
  return new Promise((resolve) => {
    if (!ttsSupported || !text) return resolve(false);

    try {
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = lang;
      utterance.rate = 0.95; // a touch slower: older patients, noisy rooms
      utterance.pitch = 1;
      utterance.volume = 1;
      const voice = pickVoice(lang);
      if (voice) utterance.voice = voice;

      let settled = false;
      let started = false;

      const finish = (ok) => {
        if (settled) return;
        settled = true;
        clearTimeout(startGuard);
        clearTimeout(endGuard);
        resolve(ok);
      };

      // Nothing started: the browser refused. Give up fast and let the mic open.
      const startGuard = setTimeout(() => {
        if (!started) finish(false);
      }, SPEECH_START_TIMEOUT_MS);

      // Started but never finished: some engines drop `onend` on long strings.
      const endGuard = setTimeout(() => finish(started), Math.max(6000, text.length * 140));

      utterance.onstart = () => {
        started = true;
      };
      utterance.onend = () => finish(true);
      utterance.onerror = () => finish(false);

      window.speechSynthesis.speak(utterance);
    } catch {
      resolve(false);
    }
  });
}

export function stopSpeaking() {
  if (ttsSupported) {
    try {
      window.speechSynthesis.cancel();
    } catch {
      /* nothing to cancel */
    }
  }
}

// --- microphone permission --------------------------------------------------

let micGranted = false;

/**
 * What the browser will and will not allow here. Surfaced on screen so a
 * failure says WHY instead of just sitting there doing nothing.
 */
export function micDiagnostics() {
  const secureContext = typeof window !== 'undefined' && window.isSecureContext === true;
  const hasMediaDevices =
    typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia);
  return {
    secureContext,
    hasMediaDevices,
    recognitionSupported,
    ttsSupported,
    origin: typeof location !== 'undefined' ? location.origin : '',
  };
}

/**
 * Ask for the microphone once, up front.
 *
 * This is the piece that makes autostart work. Chrome will only open the mic
 * for SpeechRecognition if permission is already granted for the origin --
 * and a gesture token does not survive the second or two it takes to speak a
 * prompt first, so "tap, hear prompt, then listen" fails every time without
 * this. Granting once up front fixes every later attempt.
 *
 * On a non-secure origin (plain http on anything but localhost) the whole
 * mediaDevices API is missing, which we report as 'insecure-origin'.
 */
export async function ensureMicPermission() {
  if (micGranted) return { ok: true };

  const { secureContext, hasMediaDevices } = micDiagnostics();
  if (!hasMediaDevices) {
    return { ok: false, reason: secureContext ? 'no-media-devices' : 'insecure-origin' };
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((track) => track.stop()); // we only wanted the grant
    micGranted = true;
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: error?.name || 'denied' };
  }
}

// --- listening --------------------------------------------------------------

let active = null;

export function abortListening() {
  if (active) {
    try {
      active.abort();
    } catch {
      /* already stopped */
    }
    active = null;
  }
}

/**
 * Listen for a single utterance.
 * Always resolves -- never rejects -- with { transcript, error }.
 * error is one of: null, 'no-speech', 'timeout', 'not-allowed', 'unsupported', …
 */
export function listenOnce({ lang = 'en-US', onInterim, maxMs = 12000 } = {}) {
  return new Promise((resolve) => {
    if (!recognitionSupported) return resolve({ transcript: '', error: 'unsupported' });

    abortListening();

    const recognition = new Recognition();
    recognition.lang = lang;
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    let finalText = '';
    let settled = false;

    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(guard);
      active = null;
      try {
        recognition.abort();
      } catch {
        /* already ended */
      }
      resolve(result);
    };

    // Hard ceiling, in case the patient never speaks and onend never comes.
    const guard = setTimeout(() => {
      const said = finalText.trim();
      finish({ transcript: said, error: said ? null : 'timeout' });
    }, maxMs);

    recognition.onresult = (event) => {
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        if (result.isFinal) finalText += result[0].transcript;
        else interim += result[0].transcript;
      }
      onInterim?.((finalText + interim).trim());
    };

    recognition.onerror = (event) => {
      finish({ transcript: finalText.trim(), error: event.error || 'error' });
    };

    recognition.onend = () => {
      const said = finalText.trim();
      finish({ transcript: said, error: said ? null : 'no-speech' });
    };

    try {
      recognition.start();
      active = recognition;
    } catch {
      finish({ transcript: '', error: 'start-failed' });
    }
  });
}
