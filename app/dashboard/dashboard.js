import { h, replace } from '../lib/dom.js';
import { createHeadToHead } from './headToHead.js';
import { createOverview } from './overview.js';
import { createRaceCentre } from './race.js';
import { createStandings } from './standings.js';

const TABS = [
  ['overview', 'Overview'],
  ['standings', 'Standings'],
  ['race-centre', 'Race Centre'],
  ['head-to-head', 'Head to Head']
];

function gateButton(label, style, action) {
  return h('button', {
    type: 'button',
    style,
    onclick: event => {
      event.stopPropagation();
      action();
    }
  }, label);
}

/**
 * Mounts the public F1 dashboard, which also carries the hidden entry to the chat.
 *
 * Nothing on the page shows that the entry exists. On a desktop, a click on bare
 * background opens an invisible password field that submits on Enter and closes
 * on Escape. On a phone, five taps on the logo, each within a second of the last,
 * open a keypad. After a lockout the entry stops opening and a red dot shows in
 * the header.
 *
 * @param {HTMLElement} root
 * @param {{enter: (passcode: string) => Promise<'chat'|'locked'|'invalid'>}} options
 * @returns {{destroy: () => void}}
 */
export function mountDashboard(root, { enter }) {
  const currentYear = new Date().getFullYear();
  const seasons = ['current', ...Array.from({ length: 5 }, (_, index) => String(currentYear - 1 - index))];
  let activeSeason = 'current';
  let activeTab = 'overview';
  let activeView = null;
  let passcode = '';
  let locked = false;
  let tapCount = 0;
  let tapTimer = null;
  let desktopInput = null;
  let mobileGate = null;
  let lockDot = null;

  const logo = h('div', { class: 'f1-logo-container' },
    h('span', { class: 'f1-logo' }, 'F1 DASHBOARD'),
    h('span', { class: 'f1-logo-accent' }, '·'));
  const seasonSelector = h('div', { class: 'f1-season-selector' });
  const nav = h('nav', { class: 'f1-nav-tabs' });
  const header = h('header', { class: 'f1-header' }, logo, seasonSelector, nav);
  const content = h('main', { class: 'f1-content-box' });
  const ui = h('div', { class: 'f1-ui-layer' }, header, content);
  const dashboard = h('div', { class: 'f1-root' }, ui);

  function closeDesktop(clear = false) {
    const input = desktopInput;
    desktopInput = null;
    if (clear) passcode = '';
    input?.remove();
  }

  function closeMobile(clear = false) {
    const gate = mobileGate;
    mobileGate = null;
    if (clear) passcode = '';
    gate?.remove();
  }

  async function authenticate() {
    let result;
    try {
      result = await enter(passcode);
    } catch {
      result = 'invalid';
    }
    if (result === 'locked') {
      locked = true;
      closeDesktop();
      closeMobile();
      if (!lockDot) {
        lockDot = h('div', {
          style: {
            width: 10,
            height: 10,
            borderRadius: '50%',
            background: 'var(--danger)',
            boxShadow: '0 0 10px var(--danger)'
          }
        });
        header.appendChild(lockDot);
      }
    } else if (result === 'invalid') {
      passcode = '';
      closeDesktop();
      closeMobile();
    }
  }

  function showDesktopGate() {
    if (locked || desktopInput) return;
    desktopInput = h('input', {
      type: 'password',
      value: passcode,
      style: { position: 'absolute', opacity: 0, pointerEvents: 'none', top: 0, left: 0 },
      oninput: event => { passcode = event.target.value; },
      onkeydown: event => {
        if (event.key === 'Enter' && passcode && !locked) authenticate();
        else if (event.key === 'Escape') closeDesktop(true);
      },
      onblur: () => {
        if (!passcode) closeDesktop();
      }
    });
    dashboard.appendChild(desktopInput);
    desktopInput.focus();
  }

  const roundButtonStyle = {
    width: 80,
    height: 80,
    borderRadius: '50%',
    background: 'rgba(255,255,255,0.05)',
    border: '1px solid rgba(255,255,255,0.1)',
    color: '#fff',
    fontSize: '1.8rem',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontFamily: 'var(--font-mono)'
  };

  function showMobileGate() {
    if (locked) return;
    closeDesktop();
    const display = h('div', {
      style: {
        marginBottom: 40,
        fontSize: '2.5rem',
        letterSpacing: '0.4em',
        color: '#fff',
        fontFamily: 'var(--font-mono)',
        minHeight: 60
      }
    });
    const update = () => { display.textContent = passcode.replace(/./g, '•') || 'ENTER KEY'; };
    const digit = value => {
      passcode += value;
      update();
    };
    mobileGate = h('div', {
      style: {
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        background: 'rgba(0,0,0,0.85)',
        backdropFilter: 'blur(10px)',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center'
      }
    },
    display,
    h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 20 } },
      [1, 2, 3, 4, 5, 6, 7, 8, 9].map(value => gateButton(value, roundButtonStyle, () => digit(String(value)))),
      gateButton('ESC', {
        ...roundButtonStyle,
        background: 'transparent',
        border: 'none',
        color: 'var(--f1-red)',
        fontSize: '1.2rem'
      }, () => closeMobile(true)),
      gateButton('0', roundButtonStyle, () => digit('0')),
      gateButton('OK', {
        ...roundButtonStyle,
        background: 'rgba(255,255,255,0.15)',
        border: '1px solid rgba(255,255,255,0.3)',
        color: '#00e676',
        fontSize: '1.5rem',
        fontWeight: 'bold'
      }, authenticate)));
    update();
    dashboard.appendChild(mobileGate);
  }

  function logoTap() {
    if (tapTimer !== null) clearTimeout(tapTimer);
    tapCount += 1;
    tapTimer = setTimeout(() => {
      tapCount = 0;
      tapTimer = null;
    }, 1000);
    if (tapCount >= 5) {
      showMobileGate();
      tapCount = 0;
    }
  }

  function renderSeasonButtons() {
    replace(seasonSelector, seasons.map(value => h('button', {
      class: `f1-season-btn ${activeSeason === value ? 'active' : ''}`,
      type: 'button',
      onclick: event => {
        event.stopPropagation();
        if (activeSeason === value) return;
        activeSeason = value;
        renderSeasonButtons();
        renderView();
      }
    }, value === 'current' ? currentYear : value)));
  }

  function renderTabs() {
    replace(nav, TABS.map(([value, label]) => h('button', {
      class: `f1-tab ${activeTab === value ? 'active' : ''}`,
      type: 'button',
      onclick: event => {
        event.stopPropagation();
        if (activeTab === value) return;
        activeTab = value;
        renderTabs();
        renderView();
      }
    }, label)));
  }

  function renderView() {
    activeView?.destroy();
    if (activeTab === 'standings') activeView = createStandings(activeSeason);
    else if (activeTab === 'race-centre') activeView = createRaceCentre(activeSeason);
    else if (activeTab === 'head-to-head') activeView = createHeadToHead(activeSeason);
    else activeView = createOverview(activeSeason);
    replace(content, activeView.element);
  }

  logo.addEventListener('click', event => {
    event.stopPropagation();
    logoTap();
  });
  // Only the three layout elements count as bare background, never a control or text.
  dashboard.addEventListener('click', event => {
    if (['f1-root', 'f1-content-box', 'f1-ui-layer'].includes(event.target.className)) showDesktopGate();
  });

  renderSeasonButtons();
  renderTabs();
  renderView();
  root.appendChild(dashboard);

  return {
    destroy() {
      activeView?.destroy();
      if (tapTimer !== null) clearTimeout(tapTimer);
      closeDesktop(true);
      closeMobile(true);
      root.replaceChildren();
    }
  };
}
