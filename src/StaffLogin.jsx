import { useEffect, useState } from 'react';
import { listDemoAccounts, staffLogin } from './api.js';

export default function StaffLogin({ onSignedIn }) {
  const username = 'charge';
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [accounts, setAccounts] = useState([]);

  useEffect(() => {
    listDemoAccounts()
      .then(setAccounts)
      .catch(() => setAccounts([]));
  }, []);

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onSignedIn(await staffLogin(username, password));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login">
      <form className="login-card" onSubmit={submit}>
        <a className="back-link" href="#/">
          ‹ Back to patient screen
        </a>
        <h1>Belle · staff sign in</h1>
        <p className="muted">Nurses, care techs, housekeeping, food services, unit clerks.</p>

        <label className="field">
          <span>Username</span>
          <input
            value={username}
            readOnly
            autoCapitalize="none"
            autoCorrect="off"
          />
        </label>

        <label className="field">
          <span>Password</span>
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoFocus
          />
        </label>

        {error ? <p className="login-error">{error}</p> : null}

        <button type="submit" className="primary wide" disabled={busy || !username}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>

        {accounts.length > 0 ? (
          <details className="demo-accounts">
            <summary>Demo accounts (password: belle)</summary>
            <div className="demo-list">
              {accounts.map((account) => (
                <button
                  key={account.username}
                  type="button"
                  onClick={() => {
                    setPassword('belle');
                  }}
                >
                  <strong>{account.username}</strong>
                  <span>
                    {account.displayName} · {account.roleLabel}
                  </span>
                </button>
              ))}
            </div>
          </details>
        ) : null}

        <p className="login-warning">
          Demo authentication only — passwords are not hashed and sessions are in memory.
          Not a security control.
        </p>
      </form>
    </div>
  );
}