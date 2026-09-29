import { h, replace } from '../lib/dom.js';
import {
  driverName,
  errorText,
  formatLocal,
  numberValue,
  panelSkeleton,
  positionBadge,
  resolvedYear,
  teamColour
} from './common.js';
import { fetchJson } from './f1data.js';
import { countdownParts, gapToLeader, nextSession } from './season.js';
import { createRaceSheet } from './race.js';
import { aboutSection } from './about.js';

function heading(title, label) {
  return h('div', { class: 'f1-overview-heading' },
    h('span', { class: 'f1-overview-kicker' }, label),
    h('h2', null, title));
}

function localSessionTime(date) {
  return formatLocal(date, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  });
}

function marginText(standings) {
  if (standings.length < 2) return '—';
  const margin = Math.max(0, numberValue(standings[0].points) - numberValue(standings[1].points));
  return Number.isInteger(margin) ? String(margin) : margin.toFixed(1).replace(/\.0$/, '');
}

function countdown(start, register, expire) {
  const values = {};
  let interval = null;
  let ended = false;
  const element = h('div', { class: 'f1-countdown' },
    [['days', 'Days'], ['hours', 'Hours'], ['minutes', 'Minutes'], ['seconds', 'Seconds']].map(([key, label]) =>
      h('div', { class: 'f1-countdown-unit' },
        h('strong', { ref: node => { values[key] = node; } }, '0'),
        h('span', null, label))));
  const update = () => {
    const remaining = start.getTime() - Date.now();
    const parts = countdownParts(remaining);
    for (const [key, node] of Object.entries(values)) node.textContent = String(parts[key]).padStart(2, '0');
    if (remaining <= 0 && interval !== null && !ended) {
      ended = true;
      clearInterval(interval);
      expire();
    }
  };
  update();
  interval = setInterval(update, 1000);
  register(interval);
  return element;
}

function nextCard(session, register, openWeekend, expire) {
  const race = session.race;
  return h('section', { class: 'f1-overview-card f1-next-card' },
    heading(session.label, 'Next session'),
    h('div', { class: 'f1-next-race' }, race.raceName),
    h('div', { class: 'f1-overview-meta' },
      h('span', null, `Round ${race.round}`),
      h('span', null, race.Circuit?.circuitName || ''),
      h('span', null, localSessionTime(session.start))),
    countdown(session.start, register, expire),
    h('button', { class: 'f1-action-btn', type: 'button', onclick: () => openWeekend(race) }, 'View weekend'));
}

function leaderBars(standings) {
  const maximum = Math.max(1, ...standings.slice(0, 3).map(entry => numberValue(entry.points)));
  return h('div', { class: 'f1-leader-bars' }, standings.slice(0, 3).map(entry => {
    const colour = teamColour(entry);
    return h('div', { class: 'f1-leader-row' },
      h('div', { class: 'f1-leader-meta' },
        h('span', null, entry.Driver?.familyName || driverName(entry)),
        h('span', null, entry.points)),
      h('div', { class: 'f1-overview-track' },
        h('div', {
          class: 'f1-overview-fill',
          style: { width: `${numberValue(entry.points) / maximum * 100}%`, background: colour }
        })));
  }));
}

function championshipCard(drivers, constructors, past) {
  const leader = drivers[0];
  const second = drivers[1];
  return h('section', { class: 'f1-overview-card f1-championship-card' },
    heading(past ? driverName(leader) : 'Championship', past ? 'Champion' : 'Drivers'),
    h('div', { class: 'f1-margin-line' },
      h('strong', null, marginText(drivers)),
      h('span', null, past ? 'Final margin' : 'Point margin')),
    second ? h('div', { class: 'f1-versus-line' },
      h('span', null, driverName(leader)),
      h('span', null, driverName(second))) : null,
    past && constructors[0]
      ? h('div', { class: 'f1-constructor-champion' },
          h('span', null, 'Constructors champion'),
          h('strong', null, constructors[0].Constructor?.name || ''))
      : null,
    leaderBars(drivers));
}

function frontTable(standings) {
  return h('section', { class: 'f1-overview-card f1-front-card' },
    heading('Front of the field', 'Top eight'),
    h('div', { class: 'f1-front-table-wrap' },
      h('table', { class: 'f1-front-table' },
        h('thead', null,
          h('tr', null,
            h('th', null, 'Pos'),
            h('th', null, 'Driver'),
            h('th', null, 'Team'),
            h('th', null, 'Points'),
            h('th', null, 'Gap'))),
        h('tbody', null, standings.slice(0, 8).map((entry, index) => {
          const colour = teamColour(entry);
          return h('tr', null,
            h('td', null, positionBadge(entry.position)),
            h('td', null, driverName(entry)),
            h('td', null,
              h('span', { class: 'f1-mini-stripe', style: { background: colour } }),
              entry.Constructors?.[0]?.name || 'Unknown'),
            h('td', { class: 'f1-overview-number' }, entry.points),
            h('td', { class: 'f1-overview-number f1-overview-gap' }, gapToLeader(standings, index)));
        })))));
}

function completeCard(year, past) {
  return h('section', { class: 'f1-overview-card f1-complete-card' },
    heading(String(year), past ? 'Final standings' : 'Season complete'));
}

export function createOverview(season) {
  const body = h('div', null);
  const element = h('div', { class: 'f1-overview' }, body, aboutSection());
  let controller = null;
  let sequence = 0;
  let timer = null;
  let sheet = null;

  function clearTimer() {
    if (timer !== null) clearInterval(timer);
    timer = null;
  }

  function closeSheet() {
    sheet?.destroy();
    sheet?.element.remove();
    sheet = null;
  }

  function openWeekend(race) {
    closeSheet();
    sheet = createRaceSheet(race, season, closeSheet);
    element.appendChild(sheet.element);
  }

  function paint(drivers, constructors, races) {
    clearTimer();
    closeSheet();
    const past = season !== 'current';
    const next = past ? null : nextSession(races, new Date());
    const cards = [];
    // When the countdown reaches zero the overview repaints and counts down to the following session.
    if (next) cards.push(nextCard(next, value => { timer = value; }, openWeekend, () => paint(drivers, constructors, races)));
    else cards.push(completeCard(resolvedYear(season), past));
    cards.push(championshipCard(drivers, constructors, past));
    cards.push(frontTable(drivers));
    replace(body, h('div', { class: 'f1-overview-grid' }, cards));
  }

  async function load(bypass = false) {
    const current = ++sequence;
    controller?.abort(new Error('stale'));
    controller = new AbortController();
    clearTimer();
    closeSheet();
    replace(body,
      h('div', { class: 'f1-overview-loading' }, panelSkeleton(5), panelSkeleton(4)));
    const year = resolvedYear(season);
    try {
      const requests = [
        fetchJson(`https://api.jolpi.ca/ergast/f1/${season}/driverStandings.json`, { signal: controller.signal, bypass }),
        fetchJson(`https://api.jolpi.ca/ergast/f1/${season}/constructorStandings.json`, { signal: controller.signal, bypass })
      ];
      if (season === 'current') {
        requests.push(fetchJson(`https://api.jolpi.ca/ergast/f1/${year}.json`, { signal: controller.signal, bypass }));
      }
      const [driverData, constructorData, scheduleData] = await Promise.all(requests);
      if (current !== sequence) return;
      const drivers = driverData?.MRData?.StandingsTable?.StandingsLists?.[0]?.DriverStandings || [];
      const constructors = constructorData?.MRData?.StandingsTable?.StandingsLists?.[0]?.ConstructorStandings || [];
      const races = scheduleData?.MRData?.RaceTable?.Races || [];
      if (!drivers.length || (season !== 'current' && !constructors.length)) {
        replace(body, h('div', { class: 'f1-panel' }, 'No telemetry data available for this season.'));
      } else if (season === 'current' && !races.length) {
        replace(body, h('div', { class: 'rc-empty' }, `No schedule available for ${year}.`));
      } else {
        paint(drivers, constructors, races);
      }
    } catch (error) {
      if (current !== sequence || controller.signal.aborted) return;
      replace(body,
        h('div', { class: 'f1-panel f1-state' },
          h('div', { class: 'f1-state-text' }, errorText(error)),
          h('button', { class: 'f1-retry-btn', type: 'button', onclick: () => load(true) }, 'Retry')));
    }
  }

  load();
  return {
    element,
    destroy() {
      sequence += 1;
      controller?.abort(new Error('destroyed'));
      clearTimer();
      closeSheet();
    }
  };
}
