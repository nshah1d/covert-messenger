import { h, icon, replace } from '../lib/dom.js';
import { TEAM_COLORS } from '../config/f1Colors.js';
import { USER_TZ } from '../lib/time.js';
import { errorText, positionBadge, raceSkeleton, resolvedYear } from './common.js';
import { fetchJson } from './f1data.js';

// Practice and sprint qualifying are shown as best laps from OpenF1; sprint,
// qualifying and race are Jolpica results.
const SESSION_CONFIG = [
  { key: 'FirstPractice', label: 'FP1', source: 'openf1', openf1Name: 'Practice 1', durationMins: 60 },
  { key: 'SecondPractice', label: 'FP2', source: 'openf1', openf1Name: 'Practice 2', durationMins: 60 },
  { key: 'ThirdPractice', label: 'FP3', source: 'openf1', openf1Name: 'Practice 3', durationMins: 60 },
  { key: 'SprintQualifying', label: 'Sprint Quali', source: 'openf1', openf1Name: 'Sprint Qualifying', durationMins: 60 },
  { key: 'Sprint', label: 'Sprint', source: 'jolpica', endpoint: (season, round) => `https://api.jolpi.ca/ergast/f1/${season}/${round}/sprint.json`, resultKey: 'SprintResults', durationMins: 30 },
  { key: 'Qualifying', label: 'Qualifying', source: 'jolpica', endpoint: (season, round) => `https://api.jolpi.ca/ergast/f1/${season}/${round}/qualifying.json`, resultKey: 'QualifyingResults', durationMins: 60 },
  { key: 'Race', label: 'Race', source: 'jolpica', endpoint: (season, round) => `https://api.jolpi.ca/ergast/f1/${season}/${round}/results.json`, resultKey: 'Results', durationMins: 120 }
];

function raceDate(race) {
  return new Date(`${race.date}T${race.time || '00:00:00Z'}`);
}

function weekendStart(race) {
  for (const key of ['FirstPractice', 'SecondPractice', 'ThirdPractice', 'SprintQualifying', 'Sprint', 'Qualifying']) {
    if (race[key]?.date) return new Date(`${race[key].date}T${race[key].time || '00:00:00Z'}`);
  }
  return raceDate(race);
}

/** The label of a session running now, counted from 5 minutes before its start to 5 minutes after its scheduled end. */
function detectLiveSession(race, now = new Date()) {
  for (const config of [...SESSION_CONFIG].reverse()) {
    const value = config.key === 'Race' ? race : race[config.key];
    if (!value?.date) continue;
    const start = new Date(`${value.date}T${value.time || '00:00:00Z'}`);
    const duration = config.durationMins * 60000;
    if (now >= start.getTime() - 300000 && now <= start.getTime() + duration + 300000) return config.label;
  }
  return null;
}

function dateText(race) {
  const start = weekendStart(race);
  const end = raceDate(race);
  const startText = start.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: USER_TZ });
  const endText = end.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: USER_TZ });
  return start.toDateString() === end.toDateString() ? endText : `${startText} – ${endText}`;
}

function sessionTime(race, config) {
  const value = config.key === 'Race' ? race : race[config.key];
  if (!value?.date) return h('span', { class: 'rw-tba' }, 'TBA');
  const start = new Date(`${value.date}T${value.time || '00:00:00Z'}`);
  const end = new Date(start.getTime() + config.durationMins * 60000);
  const dateOptions = { weekday: 'short', day: 'numeric', month: 'short', timeZone: USER_TZ };
  const timeOptions = { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: USER_TZ };
  return h('span', { class: 'rw-session-time' },
    start.toLocaleDateString('en-GB', dateOptions),
    ' · ',
    start.toLocaleTimeString('en-GB', timeOptions),
    ' – ',
    end.toLocaleTimeString('en-GB', timeOptions));
}

function teamDot(colour) {
  const color = colour ? `#${colour}` : 'rgba(255,255,255,0.2)';
  return h('span', {
    style: {
      display: 'inline-block',
      width: 9,
      height: 9,
      borderRadius: '50%',
      background: color,
      marginRight: 7,
      flexShrink: 0,
      boxShadow: `0 0 5px ${color}80`
    }
  });
}

function formatLap(seconds) {
  if (!seconds || seconds <= 0) return '—';
  const minutes = Math.floor(seconds / 60);
  const remainder = (seconds - minutes * 60).toFixed(3).padStart(6, '0');
  return minutes > 0 ? `${minutes}:${remainder}` : `${remainder}s`;
}

/**
 * Best lap per driver for an OpenF1 session. The session is the one of that name
 * starting between six days before and one day after the race date; a lap of
 * zero or over ten minutes is not a timed lap.
 */
async function openF1Rows(config, race, year, signal, bypass) {
  const sessionsUrl = `https://api.openf1.org/v1/sessions?year=${year}&session_name=${encodeURIComponent(config.openf1Name)}`;
  const sessions = await fetchJson(sessionsUrl, { signal, bypass });
  const day = new Date(`${race.date}T00:00:00Z`);
  const start = day.getTime() - 6 * 86400000;
  const end = day.getTime() + 86400000;
  const match = sessions.find(item => {
    const time = new Date(item.date_start).getTime();
    return time >= start && time <= end;
  });
  if (!match) return [];
  const [laps, drivers] = await Promise.all([
    fetchJson(`https://api.openf1.org/v1/laps?session_key=${match.session_key}`, { signal, bypass }),
    fetchJson(`https://api.openf1.org/v1/drivers?session_key=${match.session_key}`, { signal, bypass })
  ]);
  const driverMap = new Map(drivers.map(driver => [driver.driver_number, driver]));
  const best = new Map();
  for (const lap of laps) {
    if (!lap.lap_duration || lap.lap_duration <= 0 || lap.lap_duration > 600) continue;
    const previous = best.get(lap.driver_number);
    if (!previous || lap.lap_duration < previous) best.set(lap.driver_number, lap.lap_duration);
  }
  return [...best.entries()]
    .sort((a, b) => a[1] - b[1])
    .map(([number, lapTime], index) => {
      const driver = driverMap.get(number) || {};
      return {
        pos: index + 1,
        driverName: driver.full_name || String(number),
        code: driver.name_acronym || '',
        teamName: driver.team_name || '—',
        teamColour: driver.team_colour || '',
        lapTime: formatLap(lapTime)
      };
    });
}

function openF1Table(rows) {
  return h('div', { class: 'rw-table-wrapper' },
    h('table', { class: 'rw-table' },
      h('thead', null,
        h('tr', null,
          h('th', { style: { width: 40 } }, 'Pos'),
          h('th', null, 'Driver'),
          h('th', { class: 'rw-hide-sm' }, 'Team'),
          h('th', { style: { textAlign: 'right' } }, 'Best Lap'))),
      h('tbody', null, rows.map(row => {
        const parts = row.driverName.split(' ');
        return h('tr', null,
          h('td', null, positionBadge(row.pos, 'rw')),
          h('td', null,
            h('span', { class: 'rw-driver-name' },
              parts.slice(0, -1).join(' '),
              ' ',
              h('strong', { style: { textTransform: 'uppercase' } }, parts.at(-1) || '')),
            row.code ? h('span', { class: 'rw-driver-code' }, row.code) : null),
          h('td', { class: 'rw-hide-sm' },
            h('span', { style: { display: 'flex', alignItems: 'center' } },
              teamDot(row.teamColour),
              h('span', { class: 'rw-team-name' }, row.teamName))),
          h('td', { class: 'rw-mono', style: { textAlign: 'right' } }, row.lapTime));
      }))),
    h('div', { class: 'rw-data-source' }, 'Data: OpenF1'));
}

function jolpicaTable(rows, config) {
  const qualifying = config.key === 'Qualifying';
  const raceResult = config.key === 'Race' || config.key === 'Sprint';
  const resultHeaders = qualifying
    ? [h('th', null, 'Q1'), h('th', { class: 'rw-hide-sm' }, 'Q2'), h('th', { class: 'rw-hide-sm' }, 'Q3')]
    : raceResult
      ? [
          h('th', { class: 'rw-hide-sm', style: { textAlign: 'right' } }, 'Grid'),
          h('th', { style: { textAlign: 'right' } }, 'Time'),
          h('th', { style: { textAlign: 'right' } }, 'Pts')
        ]
      : [h('th', { style: { textAlign: 'right' } }, 'Time')];
  return h('div', { class: 'rw-table-wrapper' },
    h('table', { class: 'rw-table' },
      h('thead', null,
        h('tr', null,
          h('th', { style: { width: 40 } }, 'Pos'),
          h('th', null, 'Driver'),
          h('th', { class: 'rw-hide-sm' }, 'Team'),
          resultHeaders)),
      h('tbody', null, rows.map((row, index) => {
        const teamId = row.Constructor?.constructorId;
        const colour = TEAM_COLORS[teamId]?.replace('#', '') || '';
        const position = row.position || row.positionText || String(index + 1);
        const resultCells = qualifying
          ? [
              h('td', { class: 'rw-mono' }, row.Q1 || '—'),
              h('td', { class: 'rw-mono rw-hide-sm' }, row.Q2 || '—'),
              h('td', { class: 'rw-mono rw-hide-sm' }, row.Q3 || '—')
            ]
          : raceResult
            ? [
                h('td', { class: 'rw-mono rw-hide-sm', style: { textAlign: 'right' } }, row.grid || '—'),
                h('td', { class: 'rw-mono', style: { textAlign: 'right' } }, row.Time?.time || row.status || '—'),
                h('td', { class: 'rw-mono', style: { textAlign: 'right', color: '#FFD700' } }, row.points || '0')
              ]
            : [h('td', { class: 'rw-mono', style: { textAlign: 'right' } }, row.Time?.time || '—')];
        return h('tr', null,
          h('td', null, positionBadge(position, 'rw')),
          h('td', null,
            h('span', { class: 'rw-driver-name' },
              row.Driver?.givenName || '',
              ' ',
              h('strong', { style: { textTransform: 'uppercase' } }, row.Driver?.familyName || '')),
            row.Driver?.code ? h('span', { class: 'rw-driver-code' }, row.Driver.code) : null),
          h('td', { class: 'rw-hide-sm' }, teamId
            ? h('span', { style: { display: 'flex', alignItems: 'center' } },
                teamDot(colour),
                h('span', { class: 'rw-team-name' }, row.Constructor?.name || teamId))
            : null),
          resultCells);
      }))));
}

function createRaceWeekend(race, season) {
  const year = String(resolvedYear(season));
  const available = SESSION_CONFIG.filter(config => config.key === 'Race' || race[config.key]);
  const initial = raceDate(race) < new Date() ? 'Race' : available[0]?.label || 'Race';
  const tabs = h('div', { class: 'rw-tabs' });
  const meta = h('div', { class: 'rw-session-meta' });
  const content = h('div', { class: 'rw-result-content' });
  const element = h('div', { class: 'rw-root' }, tabs, meta, content);
  let active = initial;
  let controller = null;
  let sequence = 0;

  function paintTabs() {
    replace(tabs, available.map(config => h('button', {
      class: `rw-tab ${active === config.label ? 'is-active' : ''}`,
      type: 'button',
      onclick: () => select(config.label)
    }, config.label)));
  }

  async function load(bypass = false) {
    const config = SESSION_CONFIG.find(item => item.label === active);
    if (!config) return;
    const current = ++sequence;
    controller?.abort(new Error('stale'));
    controller = new AbortController();
    replace(meta, sessionTime(race, config));
    replace(content,
      h('div', { class: 'rw-loading' },
        Array.from({ length: 8 }, (_, index) => h('div', {
          class: 'rw-skeleton-row',
          style: { opacity: 1 - index * 0.1 }
        }))));
    try {
      let rows;
      if (config.source === 'openf1') {
        rows = await openF1Rows(config, race, year, controller.signal, bypass);
      } else {
        const data = await fetchJson(config.endpoint(year, race.round), { signal: controller.signal, bypass });
        const raceData = data?.MRData?.RaceTable?.Races?.[0];
        rows = raceData?.[config.resultKey] || [];
      }
      if (current !== sequence) return;
      replace(content, rows.length
        ? config.source === 'openf1' ? openF1Table(rows) : jolpicaTable(rows, config)
        : h('div', { class: 'rw-no-data' }, 'Results not yet available for this session.'));
    } catch (error) {
      if (current !== sequence || controller.signal.aborted) return;
      replace(content,
        h('div', { class: 'rw-no-data' },
          h('div', { class: 'f1-state-text' }, errorText(error)),
          h('button', { class: 'f1-retry-btn', type: 'button', onclick: () => load(true) }, 'Retry')));
    }
  }

  function select(label) {
    if (label === active) return;
    active = label;
    paintTabs();
    load();
  }

  paintTabs();
  load();
  return {
    element,
    destroy() {
      sequence += 1;
      controller?.abort(new Error('destroyed'));
    }
  };
}

export function createRaceSheet(race, season, onClose) {
  const weekend = createRaceWeekend(race, season);
  const closeButton = h('button', {
    class: 'rc-detail-close',
    type: 'button',
    'aria-label': 'Close weekend sheet',
    onclick: onClose
  }, icon(20, [
    ['line', { x1: 18, y1: 6, x2: 6, y2: 18 }],
    ['line', { x1: 6, y1: 6, x2: 18, y2: 18 }]
  ]));
  const sheet = h('div', { class: 'rc-detail-sheet' },
    h('div', { class: 'rc-detail-header' },
      h('div', { style: { flex: 1, minWidth: 0 } },
        h('div', { class: 'rc-detail-round' }, `Round ${race.round} · ${resolvedYear(season)}`),
        h('h2', { class: 'rc-detail-title' }, race.raceName),
        h('div', { class: 'rc-detail-circuit' },
          race.Circuit?.circuitName || '',
          ' — ',
          race.Circuit?.Location?.locality || '',
          ', ',
          race.Circuit?.Location?.country || '')),
      closeButton),
    weekend.element);
  const element = h('div', {
    class: 'rc-detail-overlay',
    onclick: event => {
      if (event.target.classList.contains('rc-detail-overlay')) onClose();
    }
  }, sheet);
  return { element, destroy: weekend.destroy };
}

function badge(kind, text) {
  return h('span', { class: `rc-badge rc-badge--${kind}` }, text);
}

export function createRaceCentre(season) {
  const element = h('div', { class: 'race-centre' });
  let controller = null;
  let sequence = 0;
  let selectedRound = null;
  let sheet = null;

  function closeSheet() {
    sheet?.destroy();
    sheet?.element.remove();
    sheet = null;
    selectedRound = null;
    element.querySelector('.rc-card.is-selected')?.classList.remove('is-selected');
  }

  function openSheet(race, card) {
    if (selectedRound === race.round) {
      closeSheet();
      return;
    }
    closeSheet();
    selectedRound = race.round;
    card.classList.add('is-selected');
    sheet = createRaceSheet(race, season, closeSheet);
    element.appendChild(sheet.element);
  }

  function calendar(schedule) {
    const now = new Date();
    let nextFound = false;
    return h('div', { class: 'rc-calendar' }, schedule.map(race => {
      const start = raceDate(race);
      const isPast = new Date(start.getTime() + 10800000) < now;
      const live = detectLiveSession(race, now);
      let status;
      let modifier = '';
      if (live) {
        status = badge('live', `● LIVE · ${live}`);
        modifier = 'is-live';
      } else if (!isPast && !nextFound) {
        status = badge('next', 'NEXT UP');
        modifier = 'is-next';
        nextFound = true;
      } else if (isPast) {
        status = badge('done', 'COMPLETED');
        modifier = 'is-past';
      } else {
        status = badge('upcoming', 'UPCOMING');
      }
      let card;
      card = h('button', {
        class: `rc-card ${modifier}`,
        type: 'button',
        onclick: () => openSheet(race, card)
      },
      h('div', { class: 'rc-card-top' },
        h('span', { class: 'rc-round' }, `RD ${race.round}`),
        status),
      h('div', { class: 'rc-race-name' }, race.raceName),
      h('div', { class: 'rc-meta' },
        h('span', { class: 'rc-circuit' }, race.Circuit?.circuitName || ''),
        h('span', { class: 'rc-location' },
          race.Circuit?.Location?.locality || '',
          ', ',
          race.Circuit?.Location?.country || '')),
      h('div', { class: 'rc-date' }, dateText(race)));
      return card;
    }));
  }

  async function load(bypass = false) {
    const current = ++sequence;
    controller?.abort(new Error('stale'));
    controller = new AbortController();
    closeSheet();
    replace(element, raceSkeleton());
    try {
      const data = await fetchJson(`https://api.jolpi.ca/ergast/f1/${resolvedYear(season)}.json`, {
        signal: controller.signal,
        bypass
      });
      if (current !== sequence) return;
      const schedule = data?.MRData?.RaceTable?.Races || [];
      replace(element, schedule.length
        ? calendar(schedule)
        : h('div', { class: 'rc-empty' }, `No schedule available for ${resolvedYear(season)}.`));
    } catch (error) {
      if (current !== sequence || controller.signal.aborted) return;
      replace(element,
        h('div', { class: 'rc-empty' },
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
      closeSheet();
    }
  };
}
