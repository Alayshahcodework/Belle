import { useCallback, useEffect, useMemo, useState } from 'react';
import { DEPARTMENTS, DEPARTMENT_ORDER, PRIORITY, ROLES } from '../shared/config.js';
import {
  getPatientChart,
  getStaffRequests,
  resetDemo,
  staffLogout,
  subscribeToTickets,
  updateRequest,
} from './api.js';

function useNow(intervalMs = 10_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

function waited(createdAt, now) {
  const seconds = Math.max(0, Math.floor((now - new Date(createdAt)) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function TicketCard({ ticket, now, onUpdate, onOpen, mine }) {
  const [showWhy, setShowWhy] = useState(false);
  const department = DEPARTMENTS[ticket.departmentId];
  return (
    <article className={`ticket p-${ticket.priority} s-${ticket.status}${mine ? ' mine' : ''}`}>
      <div className="ticket-stripe" style={{ background: department.accent }} />
      <div className="ticket-body">
        <div className="ticket-top">
          <button type="button" className="ticket-room linklike" onClick={() => onOpen(ticket)}>
            {ticket.room}
            {ticket.patientName ? ` · ${ticket.patientName}` : ''}
          </button>
          <span className={`chip pr-${ticket.priority}`}>{PRIORITY[ticket.priority].label}</span>
          <span className="ticket-waited">{waited(ticket.createdAt, now)}</span>
        </div>

        <p className="ticket-text">{ticket.text}</p>

        {ticket.overrideReason ? (
          <p className="ticket-override">⚠ {ticket.overrideReason}</p>
        ) : null}

        {ticket.guardrailFlags?.map((flag) => (
          <p key={flag} className="ticket-flag">
            {flag}
          </p>
        ))}

        <div className="ticket-meta">
          <span className="chip soft">{ticket.categoryLabel}</span>
          <span className="chip soft">{department.short}</span>
          <span className={`chip engine engine-${(ticket.engine ?? 'rules').split(':')[0]}`}>
            {(ticket.engine ?? 'rules').split(':')[0]}
          </span>
          <button type="button" className="why" onClick={() => onOpen(ticket)}>
            patient info
          </button>
          <button type="button" className="why" onClick={() => setShowWhy((v) => !v)}>
            why?
          </button>
        </div>

        {showWhy ? (
          <p className="ticket-why">
            engine: {ticket.engine ?? 'rules'} · confidence{' '}
            {Math.round((ticket.confidence ?? 0) * 100)}%
            {ticket.reasoning ? ` · ${ticket.reasoning}` : ''}
            {ticket.matched?.length ? ` · matched: ${ticket.matched.join(', ')}` : ''}
            {ticket.redFlags?.length ? ` · red flags: ${ticket.redFlags.join(', ')}` : ''}
          </p>
        ) : null}

        {ticket.eta ? <p className="ticket-eta-why">{ticket.eta.explanation}</p> : null}

        <div className="ticket-actions">
          {ticket.status === 'new' ? (
            <button type="button" onClick={() => onUpdate(ticket.id, { status: 'accepted' })}>
              Accept
            </button>
          ) : null}
          {ticket.status !== 'done' ? (
            <button type="button" onClick={() => onUpdate(ticket.id, { status: 'done' })}>
              Complete
            </button>
          ) : (
            <span className="done-label">Completed</span>
          )}
        </div>
      </div>
    </article>
  );
}

function PatientDrawer({ ticket, onClose }) {
  const [chart, setChart] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!ticket?.patientId) return;
    setChart(null);
    getPatientChart(ticket.patientId).then(setChart).catch((e) => setError(e.message));
  }, [ticket]);

  if (!ticket) return null;

  const rows = chart
    ? [
        ['Patient ID', chart.patientId],
        ['NFC card', chart.cardId],
        ['Age / sex', `${chart.age} ${chart.sex}`],
        ['Unit / room', `${chart.unit} · ${chart.room}`],
        ['Admitted', chart.admitDate],
        ['Diagnosis', chart.diagnosis],
        ['Treatment plan', chart.treatmentPlan],
        ['Diet order', chart.dietOrder],
        ['Allergies', chart.allergies],
        ['Fall risk', chart.fallRisk],
        ['Mobility', chart.mobility],
        ['Language', chart.language],
        ['Sensory aids', chart.sensoryAids],
        ['Assigned nurse', chart.assignedNurse],
      ]
    : [];

  return (
    <>
      <div className="drawer-scrim" onClick={onClose} role="presentation" />
      <aside className="drawer" aria-label="Patient details">
        <div className="drawer-head">
          <div>
            <h2>{ticket.patientName}</h2>
            <p className="muted">Room {ticket.room}</p>
          </div>
          <button type="button" className="ghost small" onClick={onClose}>
            Close
          </button>
        </div>

        <div className="drawer-request">
          <p className="quiet-label">The request</p>
          <p className="drawer-text">{ticket.text}</p>
          <p className="muted">
            {ticket.categoryLabel} → {ticket.departmentName}
            {ticket.eta ? ` · ${ticket.eta.explanation}` : ''}
          </p>
          {ticket.overrideReason ? (
            <p className="ticket-override">⚠ {ticket.overrideReason}</p>
          ) : null}
        </div>

        {error ? <p className="login-error">{error}</p> : null}
        {!chart && !error ? <p className="muted">Loading chart…</p> : null}

        {chart ? (
          <dl className="chart">
            {rows.map(([label, value]) => (
              <div key={label} className={`chart-row${label === 'Allergies' && value !== 'NKDA' ? ' alert' : ''}`}>
                <dt>{label}</dt>
                <dd>{value || '—'}</dd>
              </div>
            ))}
          </dl>
        ) : null}

        <p className="login-warning">
          Synthetic data. In production this panel is the PHI boundary and every open would be
          written to an access log.
        </p>
      </aside>
    </>
  );
}

function Column({ title, subtitle, tickets, now, onUpdate, onOpen, mine, accent }) {
  return (
    <section className={`column${mine ? ' column-mine' : ''}`}>
      <header className="column-head" style={accent ? { borderColor: accent } : undefined}>
        <h2>{title}</h2>
        <span className="column-count">{tickets.length}</span>
      </header>
      {subtitle ? <p className="column-sub">{subtitle}</p> : null}
      {tickets.length === 0 ? (
        <p className="muted empty-small">Nothing open.</p>
      ) : (
        tickets.map((ticket) => (
          <TicketCard
            key={ticket.id}
            ticket={ticket}
            now={now}
            onUpdate={onUpdate}
            onOpen={onOpen}
            mine={mine}
          />
        ))
      )}
    </section>
  );
}

export default function StaffView({ session, onSignedOut }) {
  const [tickets, setTickets] = useState([]);
  const [connection, setConnection] = useState('connecting');
  const [showDone, setShowDone] = useState(false);
  const [selected, setSelected] = useState(null);
  const now = useNow();

  const myDepartment = ROLES[session.role].department;
  const isNurse = session.role === 'nurse';

  useEffect(() => {
    getStaffRequests().then(setTickets).catch(() => {});
    return subscribeToTickets({}, (event) => {
      if (event.type === 'snapshot') setTickets(event.tickets);
    }, setConnection);
  }, []);

  const onUpdate = useCallback(async (id, patch) => {
    setTickets((prev) => prev.map((x) => (x.id === id ? { ...x, ...patch } : x)));
    try {
      await updateRequest(id, patch);
    } catch {
      /* the next snapshot corrects us */
    }
  }, []);

  const visible = useMemo(
    () => tickets.filter((ticket) => showDone || ticket.status !== 'done'),
    [tickets, showDone],
  );

  const mineAll = visible.filter((t) => t.departmentId === myDepartment);
  const myPatients = isNurse
    ? mineAll.filter((t) => t.assignedNurse === session.chartName)
    : [];
  const myRest = isNurse ? mineAll.filter((t) => t.assignedNurse !== session.chartName) : mineAll;

  const otherDepartments = DEPARTMENT_ORDER.filter((id) => id !== myDepartment);
  const urgentOpen = visible.filter(
    (t) => t.priority === 'critical' && t.status !== 'done',
  ).length;

  return (
    <div className="staff">
      <header className="staff-header">
        <a className="back" href="#/" aria-label="Back to launcher" title="Back to launcher">
          ‹
        </a>
        <h1>
          Belle <span className="staff-sub">board</span>
        </h1>
        <div className="whoami">
          <strong>{session.displayName}</strong>
          <span>{session.roleLabel}</span>
        </div>
        <span className={`conn ${connection}`}>{connection}</span>
        <button type="button" className="ghost small" onClick={() => resetDemo().catch(() => {})}>
          Reset demo
        </button>
        <button
          type="button"
          className="ghost small"
          onClick={() => staffLogout().then(onSignedOut)}
        >
          Sign out
        </button>
      </header>

      {urgentOpen > 0 ? (
        <div className="urgent-banner" role="alert">
          {urgentOpen} urgent clinical {urgentOpen === 1 ? 'request' : 'requests'} escalated to
          nursing
        </div>
      ) : null}

      <div className="board-controls">
        <label className="show-done">
          <input
            type="checkbox"
            checked={showDone}
            onChange={(event) => setShowDone(event.target.checked)}
          />
          show completed
        </label>
      </div>

      <div className="board-split">
        <div className="board-left">
          {isNurse ? (
            <>
              <Column
                title="My patients"
                subtitle={`Assigned to ${session.chartName}`}
                tickets={myPatients}
                now={now}
                onUpdate={onUpdate}
                onOpen={setSelected}
                mine
                accent={DEPARTMENTS[myDepartment].accent}
              />
              <Column
                title="Other nursing requests"
                tickets={myRest}
                now={now}
                onUpdate={onUpdate}
                onOpen={setSelected}
                mine
                accent={DEPARTMENTS[myDepartment].accent}
              />
            </>
          ) : (
            <Column
              title={`My queue · ${DEPARTMENTS[myDepartment].short}`}
              tickets={mineAll}
              now={now}
              onUpdate={onUpdate}
              onOpen={setSelected}
              mine
              accent={DEPARTMENTS[myDepartment].accent}
            />
          )}
        </div>

        <div className="board-right">
          <p className="quiet-label">Other teams</p>
          {otherDepartments.map((id) => (
            <Column
              key={id}
              title={DEPARTMENTS[id].short}
              tickets={visible.filter((t) => t.departmentId === id)}
              now={now}
              onUpdate={onUpdate}
              onOpen={setSelected}
              accent={DEPARTMENTS[id].accent}
            />
          ))}
        </div>
      </div>

      <PatientDrawer ticket={selected} onClose={() => setSelected(null)} />
    </div>
  );
}
