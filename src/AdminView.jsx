import { useCallback, useEffect, useState } from 'react';
import { addPatientRecord, addStaffAccount, getAdminOptions, getAdminStaff } from './api.js';

const EMPTY_PATIENT = {
  name: '',
  age: '',
  sex: 'F',
  language: 'English',
  unit: '',
  room: '',
  diagnosis: '',
  treatmentPlan: '',
  fallRisk: 'Low',
  mobility: 'Independent',
  dietOrder: 'Regular',
  allergies: 'NKDA',
  sensoryAids: 'None',
  assignedNurse: '',
};

const EMPTY_STAFF = { displayName: '', username: '', password: '', role: 'nurse', chartName: '' };

function Field({ label, children, wide }) {
  return (
    <label className={`field${wide ? ' wide-field' : ''}`}>
      <span>{label}</span>
      {children}
    </label>
  );
}

function Datalist({ id, items }) {
  return (
    <datalist id={id}>
      {items.map((item) => (
        <option key={item} value={item} />
      ))}
    </datalist>
  );
}

function PatientForm({ options }) {
  const [form, setForm] = useState(EMPTY_PATIENT);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [created, setCreated] = useState(null);
  const [copied, setCopied] = useState(false);

  const set = (key) => (event) => setForm((prev) => ({ ...prev, [key]: event.target.value }));

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setCreated(null);
    try {
      setCreated(await addPatientRecord(form));
      setForm(EMPTY_PATIENT);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function copy(text) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard blocked: the URL is on screen to copy by hand */
    }
  }

  return (
    <form className="admin-form" onSubmit={submit}>
      <div className="form-grid">
        <Field label="Full name">
          <input value={form.name} onChange={set('name')} required />
        </Field>
        <Field label="Age">
          <input type="number" min="0" max="120" value={form.age} onChange={set('age')} required />
        </Field>
        <Field label="Sex">
          <select value={form.sex} onChange={set('sex')}>
            <option value="F">F</option>
            <option value="M">M</option>
          </select>
        </Field>
        <Field label="Language">
          <select value={form.language} onChange={set('language')}>
            {options.languages.map((l) => (
              <option key={l}>{l}</option>
            ))}
          </select>
        </Field>
        <Field label="Unit">
          <input list="dl-units" value={form.unit} onChange={set('unit')} required />
        </Field>
        <Field label="Room">
          <input value={form.room} onChange={set('room')} placeholder="e.g. 412A" required />
        </Field>
        <Field label="Diagnosis" wide>
          <input value={form.diagnosis} onChange={set('diagnosis')} required />
        </Field>
        <Field label="Treatment plan" wide>
          <input value={form.treatmentPlan} onChange={set('treatmentPlan')} />
        </Field>
        <Field label="Fall risk">
          <select value={form.fallRisk} onChange={set('fallRisk')}>
            {options.fallRisks.map((r) => (
              <option key={r}>{r}</option>
            ))}
          </select>
        </Field>
        <Field label="Mobility">
          <input list="dl-mobility" value={form.mobility} onChange={set('mobility')} />
        </Field>
        <Field label="Diet order">
          <input list="dl-diet" value={form.dietOrder} onChange={set('dietOrder')} />
        </Field>
        <Field label="Allergies">
          <input list="dl-allergies" value={form.allergies} onChange={set('allergies')} />
        </Field>
        <Field label="Sensory aids">
          <input list="dl-aids" value={form.sensoryAids} onChange={set('sensoryAids')} />
        </Field>
        <Field label="Assigned nurse">
          <select value={form.assignedNurse} onChange={set('assignedNurse')}>
            <option value="">Unassigned</option>
            {options.nurses.map((n) => (
              <option key={n}>{n}</option>
            ))}
          </select>
        </Field>
      </div>

      <Datalist id="dl-units" items={options.units} />
      <Datalist id="dl-mobility" items={options.mobilities} />
      <Datalist id="dl-diet" items={options.dietOrders} />
      <Datalist id="dl-allergies" items={options.allergies} />
      <Datalist id="dl-aids" items={options.sensoryAids} />

      {error ? <p className="login-error">{error}</p> : null}

      <button type="submit" className="primary" disabled={busy}>
        {busy ? 'Adding…' : 'Add patient and issue card'}
      </button>

      {created ? (
        <div className="admin-result">
          <p>
            <strong>{created.patient.name}</strong> admitted to room {created.patient.room}.
          </p>
          <p className="muted">NFC card</p>
          <p className="card-id">{created.patient.cardId}</p>
          <p className="muted">Write this URL to the tag as an NDEF URI record:</p>
          <div className="url-row">
            <code>{created.cardUrl}</code>
            <button type="button" className="ghost small" onClick={() => copy(created.cardUrl)}>
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          <a className="back-link" href={created.cardUrl}>
            Open this patient&apos;s bedside screen
          </a>
          {!created.persisted ? (
            <p className="mic-problem">
              This server could not write to disk, so the patient exists only until it restarts.
            </p>
          ) : null}
        </div>
      ) : null}
    </form>
  );
}

function StaffForm({ options, onAdded }) {
  const [form, setForm] = useState(EMPTY_STAFF);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [created, setCreated] = useState(null);

  const set = (key) => (event) => setForm((prev) => ({ ...prev, [key]: event.target.value }));

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setCreated(null);
    try {
      const result = await addStaffAccount({
        ...form,
        chartName: form.role === 'nurse' ? form.chartName || form.displayName : '',
      });
      setCreated({ ...result, password: form.password });
      setForm(EMPTY_STAFF);
      onAdded();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="admin-form" onSubmit={submit}>
      <div className="form-grid">
        <Field label="Full name">
          <input value={form.displayName} onChange={set('displayName')} required />
        </Field>
        <Field label="Role">
          <select value={form.role} onChange={set('role')}>
            {Object.values(options.roles).map((r) => (
              <option key={r.id} value={r.id}>
                {r.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Username">
          <input
            value={form.username}
            onChange={set('username')}
            autoCapitalize="none"
            autoCorrect="off"
            placeholder="e.g. j.smith"
            required
          />
        </Field>
        <Field label="Password (6+ characters)">
          <input value={form.password} onChange={set('password')} minLength={6} required />
        </Field>
        {form.role === 'nurse' ? (
          <Field label="Name patients are assigned under" wide>
            <input
              value={form.chartName}
              onChange={set('chartName')}
              placeholder={form.displayName || 'e.g. RN J. Smith'}
            />
          </Field>
        ) : null}
      </div>

      {error ? <p className="login-error">{error}</p> : null}

      <button type="submit" className="primary" disabled={busy}>
        {busy ? 'Creating…' : 'Create staff account'}
      </button>

      {created ? (
        <div className="admin-result">
          <p>
            <strong>{created.account.displayName}</strong> can now sign in.
          </p>
          <p className="muted">
            Username <strong>{created.account.username}</strong> · password{' '}
            <strong>{created.password}</strong>
          </p>
          {!created.persisted ? (
            <p className="mic-problem">
              This server could not write to disk, so the account exists only until it restarts.
            </p>
          ) : null}
        </div>
      ) : null}
    </form>
  );
}

export default function AdminView({ session }) {
  const [tab, setTab] = useState('patient');
  const [options, setOptions] = useState(null);
  const [staff, setStaff] = useState([]);
  const [error, setError] = useState(null);

  const load = useCallback(() => {
    getAdminOptions().then(setOptions).catch((e) => setError(e.message));
    getAdminStaff().then(setStaff).catch(() => {});
  }, []);

  useEffect(() => {
    if (session.role === 'charge') load();
  }, [session.role, load]);

  return (
    <div className="staff admin">
      <header className="staff-header">
        <a className="back" href="#/staff" aria-label="Back to the board" title="Back to the board">
          ‹
        </a>
        <h1>
          Belle <span className="staff-sub">add patients and staff</span>
        </h1>
        <div className="whoami">
          <strong>{session.displayName}</strong>
          <span>{session.roleLabel}</span>
        </div>
      </header>

      {session.role !== 'charge' ? (
        <div className="admin-card">
          <h2>Charge nurse only</h2>
          <p className="muted">
            Adding patients and staff is limited to the charge nurse account. Sign out and sign in
            as <strong>charge</strong> to continue.
          </p>
          <a className="back-link" href="#/staff">
            ‹ Back to the board
          </a>
        </div>
      ) : error ? (
        <p className="login-error">{error}</p>
      ) : !options ? (
        <p className="muted">Loading…</p>
      ) : (
        <div className="admin-card">
          <div className="tabs-row" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'patient'}
              className={tab === 'patient' ? 'on' : ''}
              onClick={() => setTab('patient')}
            >
              Add patient
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'staff'}
              className={tab === 'staff' ? 'on' : ''}
              onClick={() => setTab('staff')}
            >
              Add staff
            </button>
          </div>

          {tab === 'patient' ? (
            <PatientForm options={options} />
          ) : (
            <>
              <StaffForm options={options} onAdded={load} />
              <p className="quiet-label staff-list-label">Current staff ({staff.length})</p>
              <ul className="staff-list">
                {staff.map((member) => (
                  <li key={member.username}>
                    <strong>{member.displayName}</strong>
                    <span>
                      {member.username} · {member.roleLabel}
                      {member.builtIn ? '' : ' · added'}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  );
}
