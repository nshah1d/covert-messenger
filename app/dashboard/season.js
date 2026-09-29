const SESSION_CONFIG = [
  ['FirstPractice', 'FP1'],
  ['SecondPractice', 'FP2'],
  ['ThirdPractice', 'FP3'],
  ['SprintQualifying', 'Sprint Quali'],
  ['Sprint', 'Sprint'],
  ['Qualifying', 'Qualifying'],
  ['Race', 'Race']
];

function sessionDate(race, key) {
  const value = key === 'Race' ? race : race?.[key];
  if (!value?.date) return null;
  const start = new Date(`${value.date}T${value.time || '00:00:00Z'}`);
  return Number.isNaN(start.getTime()) ? null : start;
}

export function sessionsOf(race) {
  return SESSION_CONFIG.map(([key, label]) => ({
    key,
    label,
    start: sessionDate(race, key)
  }));
}

function futureSessions(races, now) {
  const threshold = now instanceof Date ? now.getTime() : new Date(now).getTime();
  return races.flatMap(race => sessionsOf(race)
    .filter(session => session.start && session.start.getTime() > threshold)
    .map(session => ({ ...session, race })))
    .sort((a, b) => a.start - b.start);
}

export function nextSession(races, now = new Date()) {
  return futureSessions(races, now)[0] || null;
}

export function gapToLeader(standings, index) {
  if (!standings[index] || !standings[0]) return '—';
  if (index === 0) return 'LEADER';
  const leader = Number.parseFloat(standings[0].points) || 0;
  const points = Number.parseFloat(standings[index].points) || 0;
  const gap = Math.max(0, leader - points);
  return `−${Number.isInteger(gap) ? gap : gap.toFixed(1).replace(/\.0$/, '')}`;
}

export function countdownParts(ms) {
  let remaining = Math.max(0, Number.isFinite(ms) ? Math.floor(ms / 1000) : 0);
  const days = Math.floor(remaining / 86400);
  remaining -= days * 86400;
  const hours = Math.floor(remaining / 3600);
  remaining -= hours * 3600;
  const minutes = Math.floor(remaining / 60);
  const seconds = remaining - minutes * 60;
  return { days, hours, minutes, seconds };
}
