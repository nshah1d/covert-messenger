/** The browser's time zone, or the zone recorded at entry when the browser reports UTC. */
function resolveZone() {
  let intl = 'UTC';
  try {
    intl = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {}
  let stored = null;
  try {
    stored = sessionStorage.getItem('timezone');
  } catch {}
  return intl !== 'UTC' ? intl : (stored || intl);
}

export const USER_TZ = resolveZone();

export function formatMessageTime(isoString) {
  return new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: USER_TZ
  }).format(new Date(isoString));
}

export function formatMessageDate(isoString, now = new Date()) {
  const d = new Date(isoString);
  const toDateStr = (dt) => new Intl.DateTimeFormat('en-GB', {
    year: 'numeric', month: '2-digit', day: '2-digit', timeZone: USER_TZ
  }).format(dt);

  const msgStr = toDateStr(d);
  const todayStr = toDateStr(now);
  const yesterdayStr = toDateStr(new Date(now.getTime() - 86400000));

  if (msgStr === todayStr) return 'Today';
  if (msgStr === yesterdayStr) return 'Yesterday';

  const sameYear = msgStr.slice(-4) === todayStr.slice(-4);
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' }),
    timeZone: USER_TZ
  }).format(d);
}

export function formatSearchTime(isoString) {
  return new Date(isoString).toLocaleString('en-GB', {
    timeZone: USER_TZ,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  });
}
