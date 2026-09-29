import { h, s, replace } from '../lib/dom.js';
import { driverName, errorText, panelSkeleton, resolvedYear, teamColour } from './common.js';
import { fetchJson } from './f1data.js';
import { better, headToHeadCounts, seasonRecord } from './h2hStats.js';
import { createDriverPicker } from './driverPicker.js';

const BASE = 'https://api.jolpi.ca/ergast/f1';
const SECOND_COLOUR = '#F0F0F5';

function heading(title, kicker) {
  return h('div', { class: 'f1-overview-heading' }, h('span', { class: 'f1-overview-kicker' }, kicker), h('h2', null, title));
}

// Team-mates share a team colour, so the second driver is drawn in off-white.
function colours(left, right) {
  const leftColour = teamColour(left);
  const rightColour = teamColour(right);
  return [leftColour, rightColour === leftColour ? SECOND_COLOUR : rightColour];
}

function surname(entry) {
  return entry?.Driver?.familyName || driverName(entry);
}

function picker(standings, selected, side, colour, onChange, pickers) {
  const entry = standings.find(item => item.Driver?.driverId === selected);
  const control = createDriverPicker({ entries: standings, value: selected, label: side === 'left' ? 'First driver' : 'Second driver', onChange });
  pickers.push(control);
  return h('section', { class: `f1-h2h-pick f1-h2h-pick--${side}`, style: { '--driver-colour': colour } },
    control.element,
    h('div', { class: 'f1-h2h-identity' },
      h('span', { class: 'f1-h2h-position' }, entry ? `P${entry.position}` : ''),
      h('h2', null, entry ? surname(entry) : ''),
      h('div', { class: 'f1-h2h-team' }, entry?.Constructors?.[0]?.name || '')));
}

function statRow(label, leftValue, rightValue, format, { lowerWins = false, bar = false } = {}, [leftColour, rightColour]) {
  const winner = better(leftValue, rightValue, lowerWins);
  const leftText = leftValue === null ? '—' : format(leftValue);
  const rightText = rightValue === null ? '—' : format(rightValue);
  const row = h('div', { class: 'f1-h2h-row' },
    h('div', { class: 'f1-h2h-values' },
      h('strong', { class: winner === -1 ? 'is-ahead' : '', style: winner === -1 ? { color: leftColour } : {} }, leftText),
      h('span', null, label),
      h('strong', { class: winner === 1 ? 'is-ahead' : '', style: winner === 1 ? { color: rightColour } : {} }, rightText)));
  if (bar) {
    const left = leftValue || 0;
    const right = rightValue || 0;
    const total = left + right;
    row.append(h('div', { class: 'f1-h2h-split' },
      h('div', { style: { width: `${total ? left / total * 100 : 50}%`, background: leftColour } }),
      h('div', { style: { width: `${total ? right / total * 100 : 50}%`, background: rightColour } })));
  }
  return row;
}

function sheet(left, right, leftRecord, rightRecord, palette) {
  const counts = leftRecord && rightRecord ? headToHeadCounts(leftRecord, rightRecord) : null;
  const whole = value => String(value);
  const rows = [
    statRow('Championship position', Number(left.position), Number(right.position), value => `P${value}`, { lowerWins: true }, palette),
    statRow('Points', Number(left.points), Number(right.points), whole, { bar: true }, palette),
    statRow('Wins', Number(left.wins), Number(right.wins), whole, { bar: true }, palette)
  ];
  if (leftRecord && rightRecord) {
    rows.push(
      statRow('Finished ahead', counts.raceLeft, counts.raceRight, whole, { bar: true }, palette),
      statRow('Qualified ahead', counts.qualiLeft, counts.qualiRight, whole, { bar: true }, palette),
      statRow('Podiums', leftRecord.podiums, rightRecord.podiums, whole, { bar: true }, palette),
      statRow('Points finishes', leftRecord.pointsFinishes, rightRecord.pointsFinishes, whole, { bar: true }, palette),
      statRow('Best finish', leftRecord.best, rightRecord.best, value => `P${value}`, { lowerWins: true }, palette),
      statRow('Average finish', leftRecord.average, rightRecord.average, value => value.toFixed(1), { lowerWins: true }, palette),
      statRow('Retirements', leftRecord.retirements, rightRecord.retirements, whole, { lowerWins: true }, palette));
  }
  return h('section', { class: 'f1-overview-card f1-h2h-sheet' },
    heading('Season comparison', `${surname(left)} vs ${surname(right)}`),
    h('div', { class: 'f1-h2h-rows' }, rows));
}

function progression(leftRecord, rightRecord, left, right, [leftColour, rightColour]) {
  const rounds = [...new Set([...leftRecord.cumulative, ...rightRecord.cumulative].map(point => point.round))].sort((a, b) => a - b);
  if (rounds.length < 2) return null;
  const maximum = Math.max(1, ...leftRecord.cumulative.map(p => p.total), ...rightRecord.cumulative.map(p => p.total));
  const x = round => (rounds.indexOf(round) / (rounds.length - 1)) * 100;
  const y = total => 100 - (total / maximum) * 100;
  const line = (record, colour) => s('polyline', {
    points: record.cumulative.map(p => `${x(p.round).toFixed(2)},${y(p.total).toFixed(2)}`).join(' '),
    fill: 'none', stroke: colour, 'stroke-width': 2.5, 'stroke-linejoin': 'round', 'stroke-linecap': 'round', 'vector-effect': 'non-scaling-stroke'
  });
  const levels = [1, 0.5, 0];
  const grid = levels.map(share => s('line', { x1: 0, x2: 100, y1: y(maximum * share), y2: y(maximum * share), stroke: 'rgba(255,255,255,0.07)', 'vector-effect': 'non-scaling-stroke' }));
  const chart = s('svg', { viewBox: '0 0 100 100', preserveAspectRatio: 'none', class: 'f1-h2h-chart', role: 'img', 'aria-label': 'Cumulative points by round' },
    grid, line(leftRecord, leftColour), line(rightRecord, rightColour));
  const ticks = rounds.filter((round, index) => index === 0 || index === rounds.length - 1 || index % 3 === 0);
  return h('section', { class: 'f1-overview-card f1-h2h-progress' },
    heading('Points progression', 'Cumulative, races and sprints'),
    h('div', { class: 'f1-h2h-legend' },
      h('span', null, h('i', { style: { background: leftColour } }), `${surname(left)} ${leftRecord.cumulative.at(-1)?.total ?? 0}`),
      h('span', null, h('i', { style: { background: rightColour } }), `${surname(right)} ${rightRecord.cumulative.at(-1)?.total ?? 0}`)),
    h('div', { class: 'f1-h2h-plot' },
      h('div', { class: 'f1-h2h-yaxis' }, levels.map(share => h('span', null, String(Math.round(maximum * share))))),
      h('div', { class: 'f1-h2h-canvas' },
        chart,
        h('div', { class: 'f1-h2h-xaxis' }, ticks.map(round => h('span', { style: { left: `${x(round)}%` } }, `R${round}`))))));
}

function roundsTable(leftRecord, rightRecord, left, right, [leftColour, rightColour]) {
  const rightByRound = new Map(rightRecord.rounds.map(entry => [entry.round, entry]));
  const all = [...new Set([...leftRecord.rounds, ...rightRecord.rounds].map(entry => entry.round))].sort((a, b) => a - b);
  const leftByRound = new Map(leftRecord.rounds.map(entry => [entry.round, entry]));
  const cell = (entry, other, colour) => {
    if (!entry) return [h('td', null, '—'), h('td', null, '—')];
    const qualiAhead = other && entry.qualifying !== null && other.qualifying !== null && entry.qualifying < other.qualifying;
    const raceAhead = other && entry.order !== null && other.order !== null && entry.order < other.order;
    return [
      h('td', { class: 'f1-h2h-quali', style: qualiAhead ? { color: colour } : {} }, entry.qualifying === null ? '—' : `P${entry.qualifying}`),
      h('td', { class: 'f1-h2h-finish', style: raceAhead ? { color: colour, fontWeight: 700 } : {} }, entry.label)
    ];
  };
  return h('section', { class: 'f1-overview-card f1-h2h-rounds' },
    heading('Race by race', 'Qualifying and finish'),
    h('div', { class: 'f1-h2h-table-wrap' },
      h('table', { class: 'f1-front-table f1-h2h-table' },
        h('thead', null,
          h('tr', null,
            h('th', { rowspan: 2 }, 'Rd'),
            h('th', { rowspan: 2 }, 'Grand Prix'),
            h('th', { colspan: 2, style: { color: leftColour } }, surname(left)),
            h('th', { colspan: 2, style: { color: rightColour } }, surname(right))),
          h('tr', { class: 'f1-h2h-subhead' },
            h('th', null, 'Quali'), h('th', null, 'Race'), h('th', null, 'Quali'), h('th', null, 'Race'))),
        h('tbody', null, all.map(round => {
          const a = leftByRound.get(round);
          const b = rightByRound.get(round);
          return h('tr', null,
            h('td', { class: 'f1-overview-number' }, String(round)),
            h('td', { class: 'f1-h2h-race' }, (a || b).name.replace(/ Grand Prix$/, '')),
            cell(a, b, leftColour),
            cell(b, a, rightColour));
        })))));
}

export function createHeadToHead(season) {
  const element = h('div', { class: 'f1-head-to-head' });
  const year = resolvedYear(season);
  let controller = null;
  let detailController = null;
  let sequence = 0;
  let detailSequence = 0;
  let standings = [];
  let leftId = '';
  let rightId = '';
  let pickers = [];

  async function driverRecord(id, signal, bypass) {
    const [results, sprint, qualifying] = await Promise.all(['results', 'sprint', 'qualifying'].map(kind =>
      fetchJson(`${BASE}/${season}/drivers/${encodeURIComponent(id)}/${kind}.json?limit=100`, { signal, bypass })));
    return seasonRecord(results, sprint, qualifying);
  }

  function render() {
    const left = standings.find(entry => entry.Driver?.driverId === leftId);
    const right = standings.find(entry => entry.Driver?.driverId === rightId);
    const palette = left && right ? colours(left, right) : ['var(--text-muted)', SECOND_COLOUR];
    pickers.forEach(control => control.destroy());
    pickers = [];
    const header = h('div', { class: 'f1-h2h-header' },
      picker(standings, leftId, 'left', palette[0], value => { leftId = value; render(); }, pickers),
      h('div', { class: 'f1-h2h-vs' }, 'VS'),
      picker(standings, rightId, 'right', palette[1], value => { rightId = value; render(); }, pickers));
    if (!left || !right || leftId === rightId) {
      detailController?.abort(new Error('stale'));
      replace(element, header, h('div', { class: 'f1-h2h-note' }, 'Choose two different drivers.'));
      return;
    }
    const sheetSlot = h('div', null, sheet(left, right, null, null, palette));
    const detailSlot = h('div', { class: 'f1-h2h-details' }, panelSkeleton(4));
    replace(element, header, sheetSlot, detailSlot);
    loadDetails(left, right, palette, sheetSlot, detailSlot, false);
  }

  async function loadDetails(left, right, palette, sheetSlot, detailSlot, bypass) {
    const current = ++detailSequence;
    detailController?.abort(new Error('stale'));
    detailController = new AbortController();
    const { signal } = detailController;
    try {
      const [leftRecord, rightRecord] = await Promise.all([
        driverRecord(left.Driver.driverId, signal, bypass),
        driverRecord(right.Driver.driverId, signal, bypass)
      ]);
      if (current !== detailSequence) return;
      replace(sheetSlot, sheet(left, right, leftRecord, rightRecord, palette));
      replace(detailSlot,
        progression(leftRecord, rightRecord, left, right, palette),
        leftRecord.rounds.length || rightRecord.rounds.length ? roundsTable(leftRecord, rightRecord, left, right, palette) : null);
    } catch (error) {
      if (current !== detailSequence || signal.aborted) return;
      replace(detailSlot,
        h('div', { class: 'f1-panel f1-state' },
          h('div', { class: 'f1-state-text' }, errorText(error)),
          h('button', { class: 'f1-retry-btn', type: 'button', onclick: () => loadDetails(left, right, palette, sheetSlot, detailSlot, true) }, 'Retry')));
    }
  }

  async function load(bypass = false) {
    const current = ++sequence;
    controller?.abort(new Error('stale'));
    controller = new AbortController();
    replace(element, panelSkeleton(5));
    try {
      const data = await fetchJson(`${BASE}/${season}/driverStandings.json`, { signal: controller.signal, bypass });
      if (current !== sequence) return;
      standings = data?.MRData?.StandingsTable?.StandingsLists?.[0]?.DriverStandings || [];
      if (!standings.length) {
        replace(element, h('div', { class: 'f1-panel' }, 'No telemetry data available for this season.'));
        return;
      }
      leftId = standings[0]?.Driver?.driverId || '';
      rightId = standings[1]?.Driver?.driverId || leftId;
      render();
    } catch (error) {
      if (current !== sequence || controller.signal.aborted) return;
      replace(element,
        h('div', { class: 'f1-panel f1-state' },
          h('div', { class: 'f1-state-text' }, errorText(error)),
          h('button', { class: 'f1-retry-btn', type: 'button', onclick: () => load(true) }, 'Retry')));
    }
  }

  load();
  return {
    element,
    destroy() {
      pickers.forEach(control => control.destroy());
      sequence += 1;
      detailSequence += 1;
      controller?.abort(new Error('destroyed'));
      detailController?.abort(new Error('destroyed'));
    }
  };
}
