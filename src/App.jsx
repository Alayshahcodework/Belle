import { useEffect, useState } from 'react';
import PatientView from './PatientView.jsx';
import StaffLogin from './StaffLogin.jsx';
import StaffView from './StaffView.jsx';
import AdminView from './AdminView.jsx';
import { getToken, staffMe, clearToken } from './api.js';

function useHashRoute() {
  const [hash, setHash] = useState(() => window.location.hash || '#/');
  useEffect(() => {
    const onChange = () => setHash(window.location.hash || '#/');
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return hash;
}

/** Dev launcher. Physical NFC cards go straight to #/t/<cardId>. */
function Launcher() {
  const [cards, setCards] = useState([]);
  const [manual, setManual] = useState('');

  useEffect(() => {
    fetch('/api/demo/cards')
      .then((r) => (r.ok ? r.json() : []))
      .then(setCards)
      .catch(() => setCards([]));
  }, []);

  return (
    <div className="launcher">
      <div className="launcher-card">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            🔔
          </span>
          <div>
            <h1>Belle</h1>
            <p className="brand-sub">Tap a card. Say what you need.</p>
          </div>
        </div>

        <p className="launcher-note">
          A real patient taps their NFC card on the bedside tablet, which opens
          <code> /#/t/&lt;card id&gt;</code> directly. Simulate a tap:
        </p>

        <form
          className="type-row"
          onSubmit={(event) => {
            event.preventDefault();
            if (manual.trim()) window.location.hash = `#/t/${manual.trim()}`;
          }}
        >
          <input
            value={manual}
            onChange={(event) => setManual(event.target.value)}
            placeholder="CARD-6D7E7F"
            aria-label="Card id"
          />
          <button type="submit">→</button>
        </form>

        {cards.length > 0 ? (
          <div className="demo-cards">
            {cards.map((card) => (
              <a
                key={card.cardId}
                className={`demo-card${card.dietRestricted ? ' restricted' : ''}`}
                href={`#/t/${card.cardId}`}
              >
                <strong>
                  Room {card.room} · {card.firstName}
                </strong>
                <span>
                  {card.cardId} · {card.language} · {card.dietOrder}
                </span>
              </a>
            ))}
          </div>
        ) : null}

        <a className="launch-btn staff" href="#/staff">
          <span aria-hidden="true">📋</span>
          Staff sign in
          <small>Nurses, care techs, housekeeping, food services</small>
        </a>
      </div>
    </div>
  );
}

function StaffRoute({ admin = false }) {
  const [session, setSession] = useState(null);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    if (!getToken()) {
      setChecked(true);
      return;
    }
    staffMe()
      .then(setSession)
      .catch(() => clearToken())
      .finally(() => setChecked(true));
  }, []);

  if (!checked) return <div className="card-error"><h1>Checking your session…</h1></div>;
  if (!session) return <StaffLogin onSignedIn={setSession} />;
  if (admin) return <AdminView session={session} />;
  return <StaffView session={session} onSignedOut={() => setSession(null)} />;
}

export default function App() {
  const hash = useHashRoute();

  const cardMatch = hash.match(/^#\/t\/([^/?]+)/);
  if (cardMatch) return <PatientView cardId={decodeURIComponent(cardMatch[1])} />;
  if (hash.startsWith('#/admin')) return <StaffRoute admin />;
  if (hash.startsWith('#/staff')) return <StaffRoute />;
  return <Launcher />;
}
