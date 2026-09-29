const KEYS = ['token', 'fingerprint', 'session_nonce', 'identity', 'timezone'];

function read(key) {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

/**
 * The entry values held for this tab. They live in sessionStorage only, so
 * closing the tab ends the session and nothing survives in the browser.
 */
export function currentSession() {
  return {
    token: read('token'),
    fingerprint: read('fingerprint'),
    nonce: read('session_nonce'),
    identity: read('identity'),
  };
}

export function storeSession({ token, fingerprint, nonce, identity, timezone }) {
  const values = { token, fingerprint, session_nonce: nonce, identity, timezone };
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined && value !== null) sessionStorage.setItem(key, value);
  }
}

export function clearSession() {
  try {
    for (const key of KEYS) sessionStorage.removeItem(key);
    sessionStorage.clear();
  } catch {}
}

export class ApiError extends Error {
  constructor(status, body) {
    super(body && body.error ? body.error : `http_${status}`);
    this.status = status;
    this.body = body || {};
  }
}

export function authHeaders(extra) {
  const headers = new Headers(extra || {});
  const { token, fingerprint } = currentSession();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (fingerprint) headers.set('X-Fingerprint', fingerprint);
  return headers;
}

export async function apiRaw(path, { method = 'GET', body, signal, headers } = {}) {
  const init = { method, signal, headers: authHeaders(headers), cache: 'no-store', credentials: 'same-origin' };
  if (body instanceof FormData) {
    init.body = body;
  } else if (body !== undefined) {
    init.headers.set('Content-Type', 'application/json');
    init.body = JSON.stringify(body);
  }
  return fetch(path, init);
}

/**
 * Calls a chat endpoint with the session's Authorization and X-Fingerprint headers.
 *
 * @param {string} path Same-origin API path.
 * @param {{method?: string, body?: object|FormData, signal?: AbortSignal, headers?: HeadersInit}} [options]
 *   A plain object body is sent as JSON; FormData is sent as multipart.
 * @returns {Promise<any>} The parsed JSON response, or null when the body is not JSON.
 * @throws {ApiError} For any non-2xx status, carrying the status and the JSON error body.
 */
export async function api(path, options = {}) {
  const res = await apiRaw(path, options);
  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  if (!res.ok) throw new ApiError(res.status, data);
  return data;
}

export function randomHex(bytes) {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('');
}
