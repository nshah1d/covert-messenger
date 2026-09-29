function dataError(kind) {
  const error = new Error(kind === 'busy' ? 'Data provider is busy.' : 'Data provider unavailable.');
  error.kind = kind;
  return error;
}

function defaultSleep(ms, signal) {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(done, ms);
    function done() {
      signal?.removeEventListener('abort', aborted);
      resolve();
    }
    function aborted() {
      clearTimeout(timer);
      signal.removeEventListener('abort', aborted);
      reject(signal.reason);
    }
    if (signal) signal.addEventListener('abort', aborted, { once: true });
  });
}

/**
 * Fetches the dashboard's public F1 data.
 *
 * Responses are cached in memory by address for the life of the page, and
 * nothing is written to browser storage. Requests to one host start at least
 * 250 ms apart, which keeps within Jolpica's burst limit of four requests a
 * second (https://github.com/jolpica/jolpica-f1/blob/main/docs/rate_limits.md).
 * An aborted request is dropped from the cache so it is fetched again next time;
 * a failed one stays cached until a Retry bypasses it.
 *
 * @param {{fetch?: Function, now?: () => number, sleep?: Function}} [options]
 *   Replaceable in tests.
 * @returns {{fetchJson: (url: string, options?: {signal?: AbortSignal, bypass?: boolean}) => Promise<any>}}
 *   fetchJson rejects with an Error whose kind is 'busy' for HTTP 429 and
 *   'failed' for any other failure. bypass skips the cache, for Retry.
 */
export function createF1Data(options = {}) {
  const fetchImpl = options.fetch || globalThis.fetch?.bind(globalThis);
  const now = options.now || Date.now;
  const sleep = options.sleep || defaultSleep;
  const cache = new Map();
  const hostTails = new Map();
  const lastStarts = new Map();

  function scheduled(url, signal) {
    const host = new URL(url).host;
    const previous = hostTails.get(host) || Promise.resolve();
    const request = previous.catch(() => {}).then(async () => {
      if (signal?.aborted) throw signal.reason;
      const elapsed = now() - (lastStarts.get(host) ?? -Infinity);
      if (elapsed < 250) await sleep(250 - elapsed, signal);
      if (signal?.aborted) throw signal.reason;
      lastStarts.set(host, now());
      let response;
      try {
        response = await fetchImpl(url, { signal });
      } catch {
        if (signal?.aborted) throw signal.reason;
        throw dataError('failed');
      }
      if (signal?.aborted) throw signal.reason;
      if (!response?.ok) throw dataError(response?.status === 429 ? 'busy' : 'failed');
      try {
        const data = await response.json();
        if (signal?.aborted) throw signal.reason;
        return data;
      } catch {
        if (signal?.aborted) throw signal.reason;
        throw dataError('failed');
      }
    });
    hostTails.set(host, request.catch(() => {}));
    return request;
  }

  function fetchJson(url, { signal, bypass = false } = {}) {
    if (signal?.aborted) return Promise.reject(signal.reason);
    if (!bypass && cache.has(url)) return cache.get(url);
    if (bypass) cache.delete(url);
    const request = scheduled(url, signal);
    cache.set(url, request);
    const aborted = () => {
      if (cache.get(url) === request) cache.delete(url);
    };
    if (signal) signal.addEventListener('abort', aborted, { once: true });
    const cleanup = () => signal?.removeEventListener('abort', aborted);
    request.then(cleanup, cleanup);
    request.catch(() => {
      if (signal?.aborted && cache.get(url) === request) cache.delete(url);
    });
    return request;
  }

  return { fetchJson };
}

const client = createF1Data();

export const fetchJson = client.fetchJson;
