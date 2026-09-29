export const POLL_VISIBLE_MS = 4000;
export const POLL_HIDDEN_MS = 30000;
export const POLL_MAX_BACKOFF_MS = 60000;
export const PAGE_SIZE = 50;

function byId(a, b) {
  return a.id - b.id;
}

/**
 * The client side of the ordered change feed.
 *
 * One poll runs at a time: every 4 seconds while visible, every 30 seconds
 * otherwise, and after failures at a doubling interval capped at 60 seconds.
 * When the server reports more events waiting, the next poll runs at once. A 401
 * stops polling and calls onExpired.
 *
 * The list stays contiguous. While a context window around an older message is
 * open, changes to messages outside it are not merged; newerWaiting is set
 * instead, and returnToLatest() reloads the newest page.
 *
 * @param {object} options
 * @param {Function} options.request API call returning parsed JSON.
 * @param {object} [options.timers] setTimeout and clearTimeout, replaceable in tests.
 * @param {(snapshot: object) => void} [options.onChange]
 * @param {(status: 'connecting'|'live'|'error') => void} [options.onStatus]
 * @param {(presence: object|null) => void} [options.onPresence]
 * @param {() => void} [options.onExpired]
 */
export function createFeed({ request, timers = globalThis, onChange = () => {}, onStatus = () => {}, onPresence = () => {}, onExpired = () => {} }) {
  const messages = new Map();
  let cursor = null;
  let hasOlder = false;
  let context = null;
  let newerWaiting = false;
  let stopped = false;
  let timer = null;
  let inFlight = null;
  let failures = 0;
  let visible = true;

  const snapshot = () => ({
    messages: Array.from(messages.values()).sort(byId),
    hasOlder,
    context: context !== null,
    contextTarget: context,
    newerWaiting,
  });

  const emit = () => onChange(snapshot());

  const expire = () => {
    stopped = true;
    if (timer) timers.clearTimeout(timer);
    timer = null;
    onStatus('error');
    onExpired();
  };

  const schedule = (ms) => {
    if (stopped) return;
    if (timer) timers.clearTimeout(timer);
    timer = timers.setTimeout(() => {
      timer = null;
      tick();
    }, ms);
  };

  const nextDelay = () => {
    if (failures === 0) return visible ? POLL_VISIBLE_MS : POLL_HIDDEN_MS;
    return Math.min(POLL_VISIBLE_MS * 2 ** failures, POLL_MAX_BACKOFF_MS);
  };

  const failed = (error) => {
    if (error && error.status === 401) {
      expire();
      return true;
    }
    failures += 1;
    onStatus('error');
    return false;
  };

  const merge = (incoming, { onlyKnown = false } = {}) => {
    let changed = false;
    for (const message of incoming) {
      if (onlyKnown && !messages.has(message.id)) {
        newerWaiting = true;
        changed = true;
        continue;
      }
      messages.set(message.id, message);
      changed = true;
    }
    return changed;
  };

  const loadLatest = async () => {
    const data = await request('/api/messages.php?initial=1');
    messages.clear();
    merge(data.messages);
    cursor = data.cursor;
    hasOlder = Boolean(data.has_older);
    context = null;
    newerWaiting = false;
    onPresence(data.presence || null);
  };

  const tick = async () => {
    if (stopped || inFlight) return;
    let drainAgain = false;
    inFlight = (async () => {
      try {
        if (cursor === null) {
          await loadLatest();
        } else {
          const data = await request(`/api/messages.php?after=${cursor}`);
          if (stopped) return;
          merge(data.messages, { onlyKnown: context !== null });
          cursor = data.cursor;
          drainAgain = Boolean(data.has_more);
          onPresence(data.presence || null);
        }
        failures = 0;
        onStatus('live');
        emit();
      } catch (error) {
        if (failed(error)) return;
      }
    })();
    await inFlight;
    inFlight = null;
    if (!stopped) schedule(drainAgain ? 0 : nextDelay());
  };

  return {
    start() {
      stopped = false;
      onStatus('connecting');
      tick();
    },
    stop() {
      stopped = true;
      if (timer) timers.clearTimeout(timer);
      timer = null;
    },
    setVisible(isVisible) {
      visible = isVisible;
      if (visible && !stopped && !inFlight) schedule(0);
    },
    pollNow() {
      if (!stopped && !inFlight) schedule(0);
    },
    // A message returned by a send, edit, delete or reaction. It never moves the
    // cursor, so other changes made before it are still fetched by the next poll.
    apply(message) {
      if (context !== null && !messages.has(message.id)) {
        newerWaiting = true;
      } else {
        messages.set(message.id, message);
      }
      emit();
    },
    patch(id, updater) {
      const current = messages.get(id);
      if (!current) return;
      messages.set(id, updater(current));
      emit();
    },
    get(id) {
      return messages.get(id) || null;
    },
    has(id) {
      return messages.has(id);
    },
    async loadOlder() {
      if (!hasOlder || messages.size === 0) return 0;
      const oldest = Math.min(...messages.keys());
      const data = await request(`/api/messages.php?before=${oldest}&limit=${PAGE_SIZE}`);
      if (stopped) return 0;
      merge(data.messages);
      hasOlder = Boolean(data.has_older);
      emit();
      return data.messages.length;
    },
    async openContext(id) {
      const data = await request(`/api/messages.php?around=${id}`);
      if (stopped) return;
      messages.clear();
      merge(data.messages);
      hasOlder = Boolean(data.has_older);
      context = id;
      newerWaiting = false;
      emit();
    },
    async returnToLatest() {
      await loadLatest();
      emit();
    },
    snapshot,
  };
}
