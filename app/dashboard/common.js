import { h } from '../lib/dom.js';
import { TEAM_COLORS } from '../config/f1Colors.js';
import { USER_TZ } from '../lib/time.js';

export function resolvedYear(season) {
  return season === 'current' ? new Date().getFullYear() : Number.parseInt(season, 10);
}

export function driverName(entry) {
  return `${entry?.Driver?.givenName || ''} ${entry?.Driver?.familyName || ''}`.trim();
}

export function driverCell(entry, className = '') {
  return h('span', { class: className },
    entry?.Driver?.givenName || '',
    ' ',
    h('span', { style: { textTransform: 'uppercase' } }, entry?.Driver?.familyName || ''));
}

export function teamColour(entry) {
  const id = entry?.Constructors?.[0]?.constructorId || entry?.Constructor?.constructorId;
  return TEAM_COLORS[id] || 'var(--text-muted)';
}

export function errorText(error) {
  return error?.kind === 'busy'
    ? 'Data provider is busy. Try again shortly.'
    : 'Data provider unavailable.';
}

export function retryView(error, retry, className = 'f1-panel f1-state') {
  return h('div', { class: className },
    h('div', { class: 'f1-state-text' }, errorText(error)),
    h('button', { class: 'f1-retry-btn', type: 'button', onclick: retry }, 'Retry'));
}

export function panelSkeleton(count = 5) {
  return h('div', { class: 'f1-panel' },
    h('div', { class: 'f1-loader' },
      Array.from({ length: count }, () => h('div', { class: 'f1-skeleton' }))));
}

export function raceSkeleton(count = 8) {
  return h('div', { class: 'rc-skeleton-grid' },
    Array.from({ length: count }, () => h('div', { class: 'rc-skeleton-card' })));
}

export function formatLocal(date, options) {
  return new Intl.DateTimeFormat('en-GB', { ...options, timeZone: USER_TZ }).format(date);
}

export function numberValue(value) {
  const number = Number.parseFloat(value);
  return Number.isFinite(number) ? number : 0;
}

export function positionBadge(position, base = 'f1') {
  const value = Number.parseInt(position, 10);
  if (base === 'rw') {
    const suffix = value >= 1 && value <= 3 ? ` rw-pos--${value}` : '';
    return h('span', { class: `rw-pos${suffix}` }, position);
  }
  const suffix = value >= 1 && value <= 3 ? ` f1-pos-${value}` : '';
  return h('span', { class: `f1-pos-badge${suffix}` }, position);
}
