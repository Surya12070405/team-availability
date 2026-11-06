const BASE = import.meta.env.VITE_API_URL || '/api';

export class ApiError extends Error {
  constructor(status, code, message, details = []) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/** One readable sentence for an error, preferring the specific field messages from the server. */
export const errorText = (err) =>
  err instanceof ApiError && err.details?.length ? err.details.map((d) => d.message).join(' ') : err?.message || 'Something went wrong';

async function request(path, { method = 'GET', body, auth = {} } = {}) {
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (auth.memberToken) headers['X-Member-Token'] = auth.memberToken;
  if (auth.adminToken) headers['X-Admin-Token'] = auth.adminToken;

  let res;
  try {
    res = await fetch(BASE + path, { method, headers, cache: 'no-cache', body: body !== undefined ? JSON.stringify(body) : undefined });
  } catch {
    throw new ApiError(0, 'NETWORK', 'Cannot reach the server. Check your connection and try again.');
  }
  if (res.status === 204) return null;

  let data = null;
  try {
    data = await res.json();
  } catch {
    /* non-JSON response */
  }
  if (!res.ok) {
    const e = data?.error;
    throw new ApiError(res.status, e?.code || 'ERROR', e?.message || `Request failed (${res.status})`, e?.details || []);
  }
  return data;
}

const b = (slug) => `/boards/${encodeURIComponent(slug)}`;

export const api = {
  createBoard: (input) => request('/boards', { method: 'POST', body: input }),
  getBoard: (slug, auth) => request(b(slug), { auth }),
  join: (slug, input) => request(`${b(slug)}/members`, { method: 'POST', body: input }),
  saveAvailability: (slug, memberId, slots, auth) =>
    request(`${b(slug)}/members/${memberId}/availability`, { method: 'PUT', body: { slots }, auth }),
  removeMember: (slug, memberId, auth) => request(`${b(slug)}/members/${memberId}`, { method: 'DELETE', auth }),
  suggestions: (slug, { duration, limit = 6 }) => request(`${b(slug)}/suggestions?duration=${duration}&limit=${limit}`),
  addOption: (slug, input, auth) => request(`${b(slug)}/options`, { method: 'POST', body: input, auth }),
  vote: (slug, optionId, vote, auth) => request(`${b(slug)}/options/${optionId}/vote`, { method: 'PUT', body: { vote }, auth }),
  removeOption: (slug, optionId, auth) => request(`${b(slug)}/options/${optionId}`, { method: 'DELETE', auth }),
  finalize: (slug, optionId, auth) => request(`${b(slug)}/meeting`, { method: 'POST', body: { optionId }, auth }),
  reopen: (slug, auth) => request(`${b(slug)}/meeting`, { method: 'DELETE', auth }),
  deleteBoard: (slug, auth) => request(b(slug), { method: 'DELETE', auth }),
};
