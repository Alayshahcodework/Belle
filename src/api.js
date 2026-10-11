const TOKEN_KEY = 'belle.staffToken';

export const getToken = () => localStorage.getItem(TOKEN_KEY);
export const setToken = (token) => localStorage.setItem(TOKEN_KEY, token);
export const clearToken = () => localStorage.removeItem(TOKEN_KEY);

async function json(res) {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const error = new Error(body.error || `${res.status} ${res.statusText}`);
    error.status = res.status;
    throw error;
  }
  return res.json();
}

const authHeaders = () => {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
};

const post = (url, body, auth = false) =>
  fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(auth ? authHeaders() : {}),
    },
    body: JSON.stringify(body ?? {}),
  }).then(json);

// --- patient / NFC -----------------------------------------------------------
export const getMeta = () => fetch('/api/meta').then(json);
export const getStaffing = () => fetch('/api/staffing').then(json);

/** Resolve an NFC card tap into a bedside profile. */
export const getCardSession = (cardId) => fetch(`/api/session/${cardId}`).then(json);

export const classifyPreview = (text, cardId) => post('/api/classify', { text, cardId });

export const createRequest = (payload) => post('/api/requests', payload);

export const getMyRequests = (cardId) => fetch(`/api/my-requests/${cardId}`).then(json);

// --- staff -------------------------------------------------------------------
export const listDemoAccounts = () => fetch('/api/auth/accounts').then(json);

export async function staffLogin(username, password) {
  const session = await post('/api/auth/login', { username, password });
  setToken(session.token);
  return session;
}

export const staffMe = () => fetch('/api/auth/me', { headers: authHeaders() }).then(json);

export async function staffLogout() {
  try {
    await post('/api/auth/logout', {}, true);
  } finally {
    clearToken();
  }
}

export const getStaffRequests = () =>
  fetch('/api/staff/requests', { headers: authHeaders() }).then(json);

export const getPatientChart = (patientId) =>
  fetch(`/api/staff/patient/${patientId}`, { headers: authHeaders() }).then(json);

export const updateRequest = (id, patch) =>
  fetch(`/api/requests/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(patch),
  }).then(json);

export const resetDemo = () => post('/api/reset', {}, true);

/**
 * Live ticket feed.
 * Pass {card} for a bedside tablet (own tickets only) or nothing for a signed
 * in staff board (whole floor). Returns an unsubscribe function.
 */
export function subscribeToTickets({ card } = {}, onEvent, onStatus) {
  const query = card
    ? `card=${encodeURIComponent(card)}`
    : `token=${encodeURIComponent(getToken() ?? '')}`;
  const source = new EventSource(`/api/stream?${query}`);

  source.onopen = () => onStatus?.('live');
  source.onerror = () => onStatus?.('reconnecting');
  source.onmessage = (event) => {
    try {
      onEvent(JSON.parse(event.data));
    } catch {
      // ignore malformed frames rather than killing the feed
    }
  };

  return () => source.close();
}
