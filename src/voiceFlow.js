// The bedside voice loop, kept out of the component so it can be tested
// without a browser or a microphone.
//
//   prompt -> listen -> understand -> confirm
//
// An answer that cannot be understood is thrown away and the patient is asked
// again. After MAX_ATTEMPTS it stops rather than looping at someone.

export const MAX_ATTEMPTS = 2;

/**
 * @param {object}   deps
 * @param {object}   deps.phrases      language pack (see phrases.js)
 * @param {string}   deps.locale       BCP-47 tag for speech in and out
 * @param {function} deps.speak        (text, locale) => Promise<boolean>
 * @param {function} deps.listen       ({lang, onInterim}) => Promise<{transcript, error}>
 * @param {function} deps.classify     (text) => Promise<routing>
 * @param {function} deps.send         (text) => Promise<ticket>
 * @param {function} deps.departmentName (departmentId, fallback) => string
 * @param {function} [deps.ensurePermission] () => Promise<{ok, reason}> run once, first
 * @param {function} [deps.onPhase]    phase change notifications for the UI
 * @param {function} [deps.onHeard]    live transcript for the UI
 * @param {function} [deps.onSay]      every spoken line, mirrored on screen
 * @param {function} [deps.isCancelled] abort check between steps
 * @param {number}   [deps.maxAttempts]
 *
 * @returns {Promise<{outcome: 'sent'|'handoff'|'gaveup'|'blocked'|'cancelled',
 *                    ticket?: object, transcript?: string, attempts: number}>}
 */
export async function runVoiceFlow({
  phrases,
  locale,
  speak,
  listen,
  classify,
  send,
  departmentName = (_id, fallback) => fallback,
  ensurePermission = null,
  onPhase = () => {},
  onHeard = () => {},
  onSay = () => {},
  isCancelled = () => false,
  maxAttempts = MAX_ATTEMPTS,
}) {
  let lastUnclear = null;
  let attempts = 0;

  // Secure the microphone before speaking anything. A gesture token does not
  // survive the pause while the prompt is read aloud, so asking afterwards
  // fails every time.
  if (ensurePermission) {
    const permission = await ensurePermission();
    if (!permission?.ok) {
      onPhase('blocked', 0);
      return { outcome: 'blocked', reason: permission?.reason ?? 'denied', attempts: 0 };
    }
  }

  const say = async (text) => {
    onSay(text);
    return speak(text, locale);
  };

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    attempts = attempt;
    if (isCancelled()) return { outcome: 'cancelled', attempts };

    onHeard('');
    onPhase('prompting', attempt);
    await say(attempt === 1 ? phrases.prompt : phrases.retry);
    if (isCancelled()) return { outcome: 'cancelled', attempts };

    onPhase('listening', attempt);
    const { transcript, error } = await listen({ lang: locale, onInterim: onHeard });
    if (isCancelled()) return { outcome: 'cancelled', attempts };

    // The browser will not give us the microphone without a gesture.
    if (error === 'not-allowed' || error === 'service-not-allowed' || error === 'network') {
      onPhase('blocked', attempt);
      return { outcome: 'blocked', reason: error, attempts };
    }

    const said = (transcript || '').trim();
    if (!said) continue; // heard nothing at all -- ask again

    onHeard(said);
    onPhase('thinking', attempt);

    let routing;
    try {
      routing = await classify(said);
    } catch {
      continue;
    }
    if (isCancelled()) return { outcome: 'cancelled', attempts };

    // Heard words, but they did not resolve to anything actionable.
    // Discard this answer entirely and ask again.
    if (!routing || routing.categoryId === 'unclassified') {
      lastUnclear = said;
      continue;
    }

    const ticket = await send(said);
    if (isCancelled()) return { outcome: 'cancelled', attempts };

    onPhase('sent', attempt);
    if (routing.escalated) {
      await say(phrases.urgent);
    } else if (routing.overrideCode && phrases.override?.[routing.overrideCode]) {
      // A chart rule diverted this; explain that rather than naming a
      // department the patient never asked for.
      await say(phrases.override[routing.overrideCode]);
    } else {
      await say(phrases.confirm(departmentName(routing.departmentId, ticket?.departmentName)));
    }
    return { outcome: 'sent', ticket, transcript: said, attempts };
  }

  // Out of attempts.
  if (lastUnclear) {
    // We heard words but could not parse them. Dropping a request from a
    // patient who cannot see the screen is the worst outcome available, so a
    // human gets it instead of nobody.
    let ticket = null;
    try {
      ticket = await send(lastUnclear);
    } catch {
      /* the announcement below still tells them what to do */
    }
    onPhase('handoff', attempts);
    await say(phrases.handoff);
    return { outcome: 'handoff', ticket, transcript: lastUnclear, attempts };
  }

  onPhase('gaveup', attempts);
  await say(phrases.gaveUp);
  return { outcome: 'gaveup', attempts };
}
