import { h, replace } from '../lib/dom.js';
import { fetchJson } from './f1data.js';
import {
  driverCell,
  numberValue,
  panelSkeleton,
  positionBadge,
  retryView,
  teamColour
} from './common.js';
import { gapToLeader } from './season.js';

function driverRows(standings) {
  return standings.map((entry, index) => {
    const colour = teamColour(entry);
    return h('tr', null,
      h('td', null, positionBadge(entry.position)),
      h('td', { style: { fontWeight: 600 } }, driverCell(entry)),
      h('td', { class: 'f1-numeric-cell f1-hide-mobile', style: { color: 'var(--text-muted)' } }, entry.Driver?.nationality || '—'),
      h('td', null,
        h('span', { class: 'f1-team-stripe', style: { color: colour, background: colour } }),
        entry.Constructors?.[0]?.name || 'Unknown'),
      h('td', { class: 'f1-numeric-cell f1-pts', style: { textAlign: 'right', color: colour } }, entry.points),
      h('td', { class: 'f1-numeric-cell f1-gap-cell', style: { textAlign: 'right' } }, gapToLeader(standings, index)),
      h('td', { class: 'f1-numeric-cell f1-hide-mobile', style: { textAlign: 'right', color: 'var(--text-muted)' } }, entry.wins));
  });
}

function driverChart(standings) {
  const maximum = Math.max(...standings.map(entry => numberValue(entry.points) || 1));
  return h('div', { class: 'f1-chart-container' },
    h('div', { class: 'f1-chart-header' }, 'Points Distribution Matrix'),
    standings.slice(0, 10).map((entry, index) => {
      const colour = teamColour(entry);
      const width = numberValue(entry.points) / maximum * 100;
      return h('div', { class: 'f1-bar-row', style: { animationDelay: `${index * 0.05}s` } },
        h('div', { class: 'f1-bar-meta' },
          h('span', { class: 'f1-bar-name' }, entry.Driver?.familyName || ''),
          h('span', { class: 'f1-bar-value' }, `${entry.points} PTS`)),
        h('div', { class: 'f1-bar-track' },
          h('div', {
            class: 'f1-bar-fill',
            style: { width: `${width}%`, background: colour, boxShadow: `0 0 15px ${colour}80` }
          })));
    }));
}

function driverPanel(standings) {
  return h('div', { class: 'f1-panel' },
    h('table', { class: 'f1-table f1-standings-table' },
      h('thead', null,
        h('tr', null,
          h('th', null, 'Pos'),
          h('th', null, 'Driver'),
          h('th', { class: 'f1-hide-mobile' }, 'Nationality'),
          h('th', null, 'Constructor'),
          h('th', { style: { textAlign: 'right' } }, 'Points'),
          h('th', { style: { textAlign: 'right' } }, 'Gap'),
          h('th', { class: 'f1-hide-mobile', style: { textAlign: 'right' } }, 'Wins'))),
      h('tbody', null, driverRows(standings))),
    driverChart(standings));
}

function constructorRows(standings) {
  return standings.map((entry, index) => {
    const colour = teamColour(entry);
    return h('tr', null,
      h('td', null, positionBadge(entry.position)),
      h('td', { style: { fontWeight: 600 } },
        h('span', { class: 'f1-team-stripe', style: { color: colour, background: colour } }),
        entry.Constructor?.name || 'Unknown'),
      h('td', { class: 'f1-numeric-cell f1-hide-mobile', style: { color: 'var(--text-muted)' } }, entry.Constructor?.nationality || '—'),
      h('td', { class: 'f1-numeric-cell f1-pts', style: { textAlign: 'right', color: colour } }, entry.points),
      h('td', { class: 'f1-numeric-cell f1-gap-cell', style: { textAlign: 'right' } }, gapToLeader(standings, index)),
      h('td', { class: 'f1-numeric-cell f1-hide-mobile', style: { textAlign: 'right', color: 'var(--text-muted)' } }, entry.wins));
  });
}

function constructorChart(standings) {
  const maximum = Math.max(...standings.map(entry => numberValue(entry.points) || 1));
  return h('div', { class: 'f1-chart-container' },
    h('div', { class: 'f1-chart-header' }, 'Engineering Performance Matrix'),
    standings.map((entry, index) => {
      const colour = teamColour(entry);
      const width = numberValue(entry.points) / maximum * 100;
      return h('div', { class: 'f1-bar-row', style: { animationDelay: `${index * 0.05}s` } },
        h('div', { class: 'f1-bar-meta' },
          h('span', { class: 'f1-bar-name' }, entry.Constructor?.name || ''),
          h('span', { class: 'f1-bar-value' }, `${entry.points} PTS`)),
        h('div', { class: 'f1-bar-track' },
          h('div', {
            class: 'f1-bar-fill',
            style: { width: `${width}%`, background: colour, boxShadow: `0 0 15px ${colour}80` }
          })));
    }));
}

function constructorPanel(standings) {
  return h('div', { class: 'f1-panel' },
    h('table', { class: 'f1-table f1-standings-table' },
      h('thead', null,
        h('tr', null,
          h('th', null, 'Pos'),
          h('th', null, 'Constructor'),
          h('th', { class: 'f1-hide-mobile' }, 'Nationality'),
          h('th', { style: { textAlign: 'right' } }, 'Points'),
          h('th', { style: { textAlign: 'right' } }, 'Gap'),
          h('th', { class: 'f1-hide-mobile', style: { textAlign: 'right' } }, 'Wins'))),
      h('tbody', null, constructorRows(standings))),
    constructorChart(standings));
}

export function createStandings(season) {
  const body = h('div', null);
  const driverButton = h('button', { class: 'f1-standings-tab active', type: 'button' }, 'Drivers');
  const constructorButton = h('button', { class: 'f1-standings-tab', type: 'button' }, 'Constructors');
  const element = h('div', { class: 'f1-standings-wrapper' },
    h('div', { class: 'f1-standings-tabs' }, driverButton, constructorButton),
    body);
  let active = 'drivers';
  let controller = null;
  let sequence = 0;

  async function load(bypass = false) {
    const current = ++sequence;
    controller?.abort(new Error('stale'));
    controller = new AbortController();
    replace(body, panelSkeleton(active === 'drivers' ? 5 : 4));
    const path = active === 'drivers' ? 'driverStandings' : 'constructorStandings';
    try {
      const data = await fetchJson(`https://api.jolpi.ca/ergast/f1/${season}/${path}.json`, {
        signal: controller.signal,
        bypass
      });
      if (current !== sequence) return;
      const list = data?.MRData?.StandingsTable?.StandingsLists?.[0];
      const standings = active === 'drivers'
        ? list?.DriverStandings || []
        : list?.ConstructorStandings || [];
      replace(body, standings.length
        ? active === 'drivers' ? driverPanel(standings) : constructorPanel(standings)
        : h('div', { class: 'f1-panel' }, 'No telemetry data available for this season.'));
    } catch (error) {
      if (current !== sequence || controller.signal.aborted) return;
      replace(body, retryView(error, () => load(true)));
    }
  }

  function select(value) {
    if (active === value) return;
    active = value;
    driverButton.classList.toggle('active', active === 'drivers');
    constructorButton.classList.toggle('active', active === 'constructors');
    load();
  }

  driverButton.addEventListener('click', () => select('drivers'));
  constructorButton.addEventListener('click', () => select('constructors'));
  load();

  return {
    element,
    destroy() {
      sequence += 1;
      controller?.abort(new Error('destroyed'));
    }
  };
}
