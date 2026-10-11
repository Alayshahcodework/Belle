import { useCallback, useEffect, useRef, useState } from 'react';
import { DEPARTMENTS, QUICK_ACTIONS } from '../shared/config.js';
import { classifyPreview, createRequest, getCardSession, subscribeToTickets } from './api.js';
import { PHRASES, QUICK_LABELS, langKey } from './phrases.js';
import {
  abortListening,
  ensureMicPermission,
  listenOnce,
  micDiagnostics,
  recognitionSupported,
  speak,
  stopSpeaking,
} from './speech.js';
import { MAX_ATTEMPTS, runVoiceFlow } from './voiceFlow.js';

const STATUS_LABEL = {
  en: { new: 'Sent', accepted: 'On the way', done: 'Done' },
  es: { new: 'Enviado', accepted: 'En camino', done: 'Listo' },
};

/** Plain-language explanation of why the browser will not open the mic. */
function blockedReason(reason, diagnostics) {
  switch (reason) {
    case 'insecure-origin':
      return `The microphone is blocked because this page is on ${
        diagnostics.origin || 'an insecure address'
      }. Browsers only allow it on https:// or on localhost.`;
    case 'NotAllowedError':
    case 'not-allowed':
    case 'service-not-allowed':
      return 'Microphone permission was refused. Allow it from the icon in the address bar, then tap to try again.';
    case 'NotFoundError':
      return 'No microphone was found on this device.';
    case 'network':
      return 'Speech recognition could not reach the network. Check the internet connection.';
    case 'no-media-devices':
      return 'This browser does not provide microphone access.';
    default:
      return reason ? `The microphone could not start (${reason}).` : null;
  }
}

/**
 * The bedside tablet, reached by tapping an NFC card.
 *
 * It starts listening on its own and reads the outcome back out loud. If the
 * browser refuses the microphone it says exactly why, and the typed box below
 * does the same job.
 */
export default function PatientView({ cardId }) {
  const [profile, setProfile] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [tickets, setTickets] = useState([]);

  // idle | prompting | listening | thinking | sent | handoff | gaveup | blocked
  const [phase, setPhase] = useState('idle');
  const [attempt, setAttempt] = useState(0);
  const [heard, setHeard] = useState('');
  const [announcement, setAnnouncement] = useState('');
  const [micProblem, setMicProblem] = useState(null);

  const [typed, setTyped] = useState('');
  const [preview, setPreview] = useState(null);
  const [sending, setSending] = useState(false);

  const runningRef = useRef(false);
  const cancelledRef = useRef(false);
  const diagnostics = useRef(micDiagnostics()).current;

  const lang = langKey(profile?.language);
  const t = PHRASES[lang];

  // --- resolve the card ------------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    getCardSession(cardId)
      .then((data) => !cancelled && setProfile(data))
      .catch((error) => !cancelled && setLoadError(error.message));
    return () => {
      cancelled = true;
    };
  }, [cardId]);

  // --- this patient's own tickets, live --------------------------------------
  useEffect(() => {
    if (!profile) return undefined;
    return subscribeToTickets({ card: cardId }, (event) => {
      if (event.type === 'snapshot') setTickets(event.tickets);
    });
  }, [profile, cardId]);

  // Say up front when the browser will never allow the mic here, rather than
  // letting it look like the feature is simply broken.
  useEffect(() => {
    if (!diagnostics.secureContext || !diagnostics.hasMediaDevices) {
      setMicProblem(blockedReason('insecure-origin', diagnostics));
    }
    // eslint-disable-next-line no-console
    console.info('[Belle] microphone diagnostics', diagnostics);
  }, [diagnostics]);

  // --- stop any audio when leaving -------------------------------------------
  useEffect(
    () => () => {
      cancelledRef.current = true;
      abortListening();
      stopSpeaking();
    },
    [],
  );

  const departmentName = useCallback(
    (departmentId, fallback) => {
      const department = DEPARTMENTS[departmentId];
      if (!department) return fallback;
      return lang === 'es' ? department.nameEs : department.name;
    },
    [lang],
  );

  const announce = useCallback(
    async (line, locale) => {
      setAnnouncement(line);
      await speak(line, locale);
    },
    [],
  );

  const startFlow = useCallback(async () => {
    if (runningRef.current || !profile) return;
    runningRef.current = true;
    cancelledRef.current = false;
    setMicProblem(null);

    try {
      const result = await runVoiceFlow({
        phrases: PHRASES[langKey(profile.language)],
        locale: profile.speechLocale || 'en-US',
        speak,
        listen: listenOnce,
        ensurePermission: ensureMicPermission,
        classify: (text) => classifyPreview(text, cardId),
        send: (text) => createRequest({ cardId, text, source: 'voice' }),
        departmentName,
        onPhase: (next, tryNumber) => {
          setPhase(next);
          setAttempt(tryNumber);
        },
        onHeard: setHeard,
        onSay: setAnnouncement,
        isCancelled: () => cancelledRef.current,
      });

      if (result.outcome === 'blocked') {
        setMicProblem(blockedReason(result.reason, diagnostics));
      }
    } catch {
      setPhase('gaveup');
    } finally {
      runningRef.current = false;
    }
  }, [profile, cardId, departmentName, diagnostics]);

  // --- start as soon as the card resolves ------------------------------------
  // Scheduled on every run rather than guarded by a ref: under StrictMode the
  // first pass is torn down at once, and a ref guard eats the only autostart.
  useEffect(() => {
    if (!profile) return undefined;
    const timer = setTimeout(() => {
      if (!runningRef.current) startFlow();
    }, 400);
    return () => clearTimeout(timer);
  }, [profile, startFlow]);

  // If the browser refused, the next touch anywhere retries -- that touch is
  // the gesture the permission prompt needs.
  useEffect(() => {
    if (phase !== 'blocked') return undefined;
    const onTouch = () => {
      if (!runningRef.current) startFlow();
    };
    document.addEventListener('pointerdown', onTouch, { once: true });
    return () => document.removeEventListener('pointerdown', onTouch);
  }, [phase, startFlow]);

  // --- typed requests: classify as they type ---------------------------------
  useEffect(() => {
    const text = typed.trim();
    if (text.length < 3) {
      setPreview(null);
      return undefined;
    }
    const timer = setTimeout(() => {
      classifyPreview(text, cardId)
        .then(setPreview)
        .catch(() => setPreview(null));
    }, 350);
    return () => clearTimeout(timer);
  }, [typed, cardId]);

  async function submit(text, actionId) {
    if (sending) return;
    setSending(true);
    cancelledRef.current = true;
    abortListening();
    stopSpeaking();

    const locale = profile.speechLocale || 'en-US';
    try {
      const ticket = await createRequest({ cardId, text, actionId, source: actionId ? 'button' : 'text' });
      setPhase('sent');
      setHeard('');
      setTyped('');
      setPreview(null);
      // A chart rule may have diverted this to the nurse. Say why, in plain
      // language, rather than just naming a department the patient did not ask
      // for.
      const line =
        ticket.priority === 'critical'
          ? t.urgent
          : ticket.overrideCode && t.override[ticket.overrideCode]
            ? t.override[ticket.overrideCode]
            : t.confirm(departmentName(ticket.departmentId, ticket.departmentName));
      await announce(line, locale);
    } catch {
      /* the list below still reflects reality */
    } finally {
      setSending(false);
      cancelledRef.current = false;
    }
  }

  if (loadError) {
    return (
      <div className="card-error">
        <h1>Card not recognised</h1>
        <p>{loadError}</p>
        <p className="muted">Please ask a member of staff for help.</p>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="card-error">
        <h1>Reading your card…</h1>
      </div>
    );
  }

  const heroTitle = {
    idle: t.tapToTalk,
    prompting: t.recordTitle,
    listening: t.listening,
    thinking: t.thinking,
    sent: t.sentTitle,
    handoff: t.handoffTitle,
    gaveup: t.gaveUpTitle,
    blocked: t.touchToStart,
  }[phase];

  const heroIcon =
    phase === 'sent' ? '✅' : phase === 'handoff' || phase === 'gaveup' ? '🔔' : '🎤';

  const open = tickets.filter((ticket) => ticket.status !== 'done');
  const statusLabels = STATUS_LABEL[lang];

  return (
    <div className="bedside">
      <header className="bedside-id">
        <h1>
          {lang === 'es' ? 'Hola' : 'Hello'} {profile.firstName}
        </h1>
        <p>
          <span className="bedside-room">
            {t.room} {profile.room}
          </span>
          <span className="dot">·</span>
          {profile.diagnosis}
        </p>
      </header>

      <button
        type="button"
        className={`mic-hero phase-${phase}`}
        onClick={() => {
          if (!runningRef.current) startFlow();
        }}
      >
        <span className="mic-hero-icon" aria-hidden="true">
          {heroIcon}
        </span>
        <span className="mic-hero-text">{heroTitle}</span>
        {phase === 'prompting' || phase === 'listening' ? (
          <span className="mic-hero-sub">{t.attempt(attempt, MAX_ATTEMPTS)}</span>
        ) : null}
      </button>

      {/* Spoken lines are mirrored here so both are the same information. */}
      {announcement ? (
        <p className="sr-live" role="status" aria-live="assertive">
          {announcement}
        </p>
      ) : null}

      {heard ? <p className="interim">“{heard}”</p> : null}

      {micProblem ? <p className="mic-problem">{micProblem}</p> : null}

      {!recognitionSupported ? (
        <p className="mic-problem">
          This browser cannot listen. Chrome or Edge support speech; type your request instead.
        </p>
      ) : null}

      {/* Typed route: works when the mic does not. */}
      <form
        className="type-box"
        onSubmit={(event) => {
          event.preventDefault();
          if (typed.trim()) submit(typed.trim());
        }}
      >
        <input
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
          placeholder={t.typePlaceholder}
          aria-label={t.typePlaceholder}
        />
        <button type="submit" className="send-btn" disabled={!typed.trim() || sending}>
          {t.send}
        </button>
      </form>

      {preview ? (
        <p className={`type-preview${preview.escalated ? ' urgent' : ''}`}>
          {preview.overrideCode && t.overrideShort[preview.overrideCode] ? (
            <strong>{t.overrideShort[preview.overrideCode]}</strong>
          ) : (
            <>
              {preview.escalated ? t.urgentPreview : t.goesTo}{' '}
              <strong>{departmentName(preview.departmentId, preview.departmentName)}</strong>
            </>
          )}
        </p>
      ) : null}

      <p className="quiet-label">{t.orTap}</p>
      <div className="chip-grid">
        {QUICK_ACTIONS.map((action) => (
          <button
            key={action.id}
            type="button"
            className="quick-chip"
            disabled={sending}
            onClick={() => submit(null, action.id)}
          >
            <span aria-hidden="true">{action.icon}</span>
            {QUICK_LABELS[lang][action.id]}
          </button>
        ))}
      </div>

      {open.length > 0 ? (
        <section className="mine">
          <p className="quiet-label">{t.onTheWay}</p>
          <ul className="mine-list">
            {open.map((ticket) => (
              <li key={ticket.id}>
                <div>
                  <p className="mine-text">{ticket.text}</p>
                  <p className="mine-dept">
                    {departmentName(ticket.departmentId, ticket.departmentName)}
                  </p>
                </div>
                <span className={`chip status-${ticket.status}`}>
                  {statusLabels[ticket.status]}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
