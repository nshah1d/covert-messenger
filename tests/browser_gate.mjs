import { createRequire } from 'node:module';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { startSite, dateKeys, PROJECT } from './support/site.mjs';

const require = createRequire(process.env.MIRAGE_BROWSER_TOOLS ? join(process.env.MIRAGE_BROWSER_TOOLS, 'package.json') : import.meta.url);
const { chromium } = require('playwright');

const ZONE = 'Asia/Dubai';
const FIXTURES = join(PROJECT, 'tests', 'fixtures', 'f1');
const SHOTS = process.env.MIRAGE_GATE_SHOTS || null;
const NOW = new Date('2026-09-28T06:00:00+04:00');

let passed = 0;
const failures = [];
function check(name, ok, detail = '') {
  if (ok) passed++;
  else failures.push(`${name}${detail ? `: ${detail}` : ''}`);
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${!ok && detail ? ` :: ${detail}` : ''}`);
}

const fixture = (name) => {
  const file = join(FIXTURES, name);
  return existsSync(file) ? readFileSync(file, 'utf8') : null;
};
const EMPTY_ERGAST = JSON.stringify({ MRData: { RaceTable: { Races: [] }, StandingsTable: { StandingsLists: [] } } });
const provider = { fail: null, delay: {}, requests: [] };

async function routeProviders(context) {
  await context.route(/^https:\/\/api\.(jolpi\.ca|openf1\.org)\//, async (route) => {
    const url = new URL(route.request().url());
    provider.requests.push(url.href);
    let body = null;
    let key = '';
    if (url.hostname === 'api.jolpi.ca') {
      key = url.pathname.replace(/^\/ergast\/f1\//, '').replace(/\.json$/, '').replace(/^current/, '2026');
      body = fixture(`${key.replace(/\//g, '_')}.json`) || EMPTY_ERGAST;
    } else {
      const kind = url.pathname.split('/').pop();
      key = `openf1/${kind}`;
      if (kind === 'sessions') body = url.searchParams.get('session_name') === 'Practice 1' && url.searchParams.get('year') === '2026' ? fixture('openf1_sessions_2026_practice_1.json') : '[]';
      else body = fixture(`openf1_${kind}_${url.searchParams.get('session_key')}.json`) || '[]';
    }
    const wait = Object.entries(provider.delay).find(([k]) => key.includes(k));
    if (wait) await new Promise((r) => setTimeout(r, wait[1]));
    if (provider.fail && key.includes(provider.fail.match)) {
      await route.fulfill({ status: provider.fail.status, contentType: 'application/json', body: '{}', headers: { 'Access-Control-Allow-Origin': '*' } });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body, headers: { 'Access-Control-Allow-Origin': '*' } });
  });
}

const site = await startSite();
const base = site.base.replace('127.0.0.1', 'localhost');
const browser = await chromium.launch(process.env.MIRAGE_CHROMIUM ? { executablePath: process.env.MIRAGE_CHROMIUM } : {});
const consoleProblems = [];
const keys = dateKeys(ZONE);

async function newContext({ mobile = false, ip, clock = false } = {}) {
  const context = await browser.newContext({
    timezoneId: ZONE,
    viewport: mobile ? { width: 390, height: 844 } : { width: 1280, height: 860 },
    isMobile: mobile,
    hasTouch: mobile,
    extraHTTPHeaders: { 'X-Gate-Remote-Addr': ip || `10.1.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` },
  });
  await routeProviders(context);
  const page = await context.newPage();
  if (clock) await page.clock.install({ time: NOW });
  page.on('console', (msg) => {
    if (msg.type() === 'error' || /Content Security Policy/i.test(msg.text())) consoleProblems.push(msg.text());
  });
  page.on('pageerror', (err) => consoleProblems.push(`pageerror: ${err.message}`));
  await page.goto(base + '/');
  return { context, page };
}

async function shot(page, name) {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: join(SHOTS, `${name}.png`), fullPage: false });
}

const waitFor = (page, fn, arg, timeout = 15000) => page.waitForFunction(fn, arg, { timeout }).then(() => true, () => false);
const dotTone = (page) => page.evaluate(() => document.querySelector('.chat-header .header-left div')?.dataset.tone || null);

async function enterDesktop(page, code) {
  await page.locator('.f1-content-box').first().click({ position: { x: 5, y: 5 } });
  await page.keyboard.type(code);
  await page.keyboard.press('Enter');
}

try {
  const seed = [];
  for (let i = 1; i <= 80; i++) {
    const who = i % 2 ? 'user-a' : 'user-b';
    const body = i === 5 ? 'the zebracrossing plan' : `seed message ${i}`;
    seed.push(`('${who}', '${body}', UTC_TIMESTAMP() - INTERVAL ${200 - i} MINUTE)`);
  }
  site.sql(`INSERT INTO messages (sender_identity, message_body, created_at) VALUES ${seed.join(',')}`);

  const dash = await newContext({ ip: '10.2.0.1' });
  const P = dash.page;
  await P.waitForSelector('.f1-header', { timeout: 15000 });
  check('dashboard renders its header', await P.locator('.f1-logo').innerText() === 'F1 DASHBOARD');
  check('six season buttons', await P.locator('.f1-season-btn').count() === 6);
  const tabs = await P.locator('.f1-tab').allTextContents();
  check('tabs in order', JSON.stringify(tabs.map((t) => t.trim())) === JSON.stringify(['Overview', 'Standings', 'Race Centre', 'Head to Head']), tabs.join('|'));
  check('overview opens first', (await P.locator('.f1-tab.active').textContent()).trim() === 'Overview');
  check('no entry element visible', await P.evaluate(() => !document.querySelector('input[type=password]')));
  const bodyText = await P.evaluate(() => document.body.innerText);
  check('nothing on the page hints at the chat', !/bunker|chat|passcode|password|log ?in|sign ?in|messag/i.test(bodyText), bodyText.match(/bunker|chat|passcode|password|log ?in|sign ?in|messag/i)?.[0]);
  const schedule = JSON.parse(fixture('2026.json')).MRData.RaceTable.Races;
  const nextRace = schedule.find((r) => ['FirstPractice', 'SecondPractice', 'ThirdPractice', 'SprintQualifying', 'Sprint', 'Qualifying'].map((k) => r[k]).concat([{ date: r.date, time: r.time }]).some((x) => x && x.date && Date.parse(`${x.date}T${x.time || '00:00:00Z'}`) > Date.now()));
  check('overview names the next race', await waitFor(P, (name) => document.querySelector('.f1-content-box').innerText.toLowerCase().includes(name.toLowerCase()), nextRace ? nextRace.raceName : 'none'));
  const t1 = await P.evaluate(() => document.querySelector('.f1-content-box').innerText);
  await P.waitForTimeout(2100);
  const t2 = await P.evaluate(() => document.querySelector('.f1-content-box').innerText);
  check('countdown ticks', t1 !== t2);
  const standings = JSON.parse(fixture('2026_driverStandings.json')).MRData.StandingsTable.StandingsLists[0].DriverStandings;
  const margin = Number(standings[0].points) - Number(standings[1].points);
  check('overview shows the championship margin', await waitFor(P, (m) => new RegExp(`\\b${m}\\s*\\n?\\s*POINT MARGIN`, 'i').test(document.querySelector('.f1-content-box').innerText), margin));
  check('overview shows the front of the field', await waitFor(P, () => /FRONT OF THE FIELD/i.test(document.body.innerText) && document.querySelectorAll('.f1-content-box table tbody tr').length === 8));
  check('overview has no upcoming sessions panel', !/UPCOMING SESSIONS/i.test(await P.evaluate(() => document.querySelector('.f1-content-box').innerText)));
  await shot(P, 'dashboard-overview');
  const home = await P.request.get(base + '/');
  check('page sends its content security policy', /script-src 'self'/.test(home.headers()['content-security-policy'] || ''));
  const about = await P.evaluate(() => {
    const card = document.querySelector('.f1-overview > .f1-about');
    if (!card) return null;
    return {
      last: card === card.parentElement.lastElementChild,
      heading: card.querySelector('h2')?.textContent,
      credit: card.querySelector('p')?.textContent,
      links: [...card.querySelectorAll('a')].map((a) => [a.textContent, a.getAttribute('href'), a.target, a.rel, a.classList.contains('support')]),
    };
  });
  check('about card closes the overview', Boolean(about && about.last && about.heading === 'About' && about.credit === 'Made by Nauman Shahid.'
    && JSON.stringify(about.links) === JSON.stringify([
      ['nauman.cc', 'https://www.nauman.cc', '_blank', 'noopener noreferrer', false],
      ['GitHub', 'https://github.com/nshah1d', '_blank', 'noopener noreferrer', false],
      ['LinkedIn', 'https://www.linkedin.com/in/nshah1d/', '_blank', 'noopener noreferrer', false],
      ['Support on Ko-fi', 'https://ko-fi.com/nshah1d', '_blank', 'noopener noreferrer', true],
    ])), JSON.stringify(about));
  await P.locator('.f1-about').scrollIntoViewIfNeeded();
  await shot(P, 'dashboard-about');

  await P.locator('.f1-tab', { hasText: 'Standings' }).click();
  await waitFor(P, () => document.querySelectorAll('.f1-table tbody tr').length > 0);
  check('driver standings rows', await P.locator('.f1-table tbody tr').count() === standings.length);
  const gapCells = await P.evaluate(() => {
    const table = document.querySelector('.f1-table');
    const heads = [...table.querySelectorAll('thead th')].map((th) => th.textContent.trim().toLowerCase());
    const col = heads.indexOf('gap');
    return [...table.querySelectorAll('tbody tr')].slice(0, 2).map((tr) => tr.children[col]?.textContent.trim());
  });
  check('gap column shows leader and deficit', gapCells[0] === 'LEADER' && gapCells[1] === `−${margin}`, gapCells.join('|'));
  const tableScale = () => P.evaluate(() => {
    const row = document.querySelector('.f1-table tbody tr');
    const bar = document.querySelector('.f1-bar-track');
    const name = document.querySelector('.f1-bar-name');
    return [getComputedStyle(row.children[1]).fontSize, getComputedStyle(row.children[row.children.length - 3]).fontSize, getComputedStyle(bar).height, getComputedStyle(name).fontSize].join('|');
  });
  const driverScale = await tableScale();
  await P.locator('.f1-standings-tab', { hasText: 'Constructors' }).click();
  const constructors = JSON.parse(fixture('2026_constructorStandings.json')).MRData.StandingsTable.StandingsLists[0].ConstructorStandings;
  check('constructor standings rows', await waitFor(P, (n) => document.querySelectorAll('.f1-table tbody tr').length === n, constructors.length));
  const constructorScale = await tableScale();
  check('constructors use the drivers table scale', constructorScale === driverScale, `${driverScale} vs ${constructorScale}`);
  await shot(P, 'dashboard-standings');

  await P.locator('.f1-tab', { hasText: 'Race Centre' }).click();
  const races = JSON.parse(fixture('2026.json')).MRData.RaceTable.Races;
  check('race centre lists every round', await waitFor(P, (n) => document.querySelectorAll('.rc-card').length === n, races.length));
  await P.locator('.rc-card', { hasText: 'Azerbaijan Grand Prix' }).click();
  const results = JSON.parse(fixture('2026_15_results.json')).MRData.RaceTable.Races[0].Results;
  check('weekend sheet shows race results', await waitFor(P, (n) => document.querySelectorAll('.rw-table tbody tr').length === n, results.length));
  await P.locator('.rw-tab', { hasText: 'FP1' }).click();
  check('practice best laps from the second provider', await waitFor(P, () => /Data: OpenF1/.test(document.body.innerText) && document.querySelectorAll('.rw-table tbody tr').length > 10));
  await shot(P, 'dashboard-weekend');
  await P.locator('.rc-detail-close').click();
  check('weekend sheet closes', await P.locator('.rc-detail-overlay').count() === 0);

  await P.locator('.f1-tab', { hasText: 'Head to Head' }).click();
  check('head to head offers two drivers', await waitFor(P, () => document.querySelectorAll('.f1-h2h-pick .f1-picker').length === 2 && !document.querySelector('.f1-h2h-pick select')));
  const pickers = P.locator('.f1-h2h-pick .f1-picker');
  const firstValue = await pickers.nth(0).getAttribute('data-value');
  const secondValue = await pickers.nth(1).getAttribute('data-value');
  check('head to head defaults to two different drivers', firstValue && secondValue && firstValue !== secondValue);
  const antonelliRaces = JSON.parse(fixture('2026_drivers_antonelli_results.json')).MRData.RaceTable.Races.length;
  check('season comparison fills in from race results', await waitFor(P, () => ['Finished ahead', 'Qualified ahead', 'Podiums', 'Average finish', 'Retirements'].every((l) => [...document.querySelectorAll('.f1-h2h-values span')].some((s) => s.textContent === l))));
  check('points progression draws both drivers', await P.evaluate(() => document.querySelectorAll('.f1-h2h-chart polyline').length === 2));
  check('teammates get distinct colours', await P.evaluate(() => { const lines = [...document.querySelectorAll('.f1-h2h-chart polyline')].map((l) => l.getAttribute('stroke')); return lines[0] !== lines[1]; }));
  check('race by race lists every round', await P.evaluate((n) => document.querySelectorAll('.f1-h2h-table tbody tr').length === n, antonelliRaces));
  const offsets = await P.evaluate(() => {
    const heads = [...document.querySelectorAll('.f1-h2h-subhead th')];
    const cells = [...document.querySelector('.f1-h2h-table tbody tr').children].slice(2);
    const centre = (el) => { const r = el.getBoundingClientRect(); return r.left + r.width / 2; };
    const textCentre = (el) => { const range = document.createRange(); range.selectNodeContents(el); const r = range.getBoundingClientRect(); return r.left + r.width / 2; };
    return heads.map((th, i) => Math.abs(textCentre(th) - centre(cells[i])));
  });
  check('race by race labels sit over their columns', offsets.length === 4 && offsets.every((d) => d <= 2), offsets.map((d) => d.toFixed(1)).join(','));
  await shot(P, 'dashboard-h2h');
  await pickers.nth(1).locator('.f1-picker-button').click();
  check('driver list opens with the dashboard scrollbar', await waitFor(P, () => { const m = document.querySelectorAll('.f1-picker-menu')[1]; return m && !m.hidden && getComputedStyle(m).scrollbarWidth === 'thin' && m.querySelectorAll('.f1-picker-option').length > 10; }));
  await shot(P, 'dashboard-picker');
  await P.mouse.click(5, 300);
  check('clicking elsewhere closes the list', await waitFor(P, () => [...document.querySelectorAll('.f1-picker-menu')].every((m) => m.hidden)));
  await pickers.nth(1).locator('.f1-picker-button').focus();
  await P.keyboard.press('ArrowDown');
  await P.keyboard.press('Home');
  await P.keyboard.press('Enter');
  check('keyboard picks a driver', await waitFor(P, (v) => document.querySelectorAll('.f1-h2h-pick .f1-picker')[1]?.dataset.value === v && /two different drivers/i.test(document.body.innerText), firstValue));
  await pickers.nth(1).locator('.f1-picker-button').click();
  await P.locator('.f1-picker-menu:not([hidden]) .f1-picker-option', { hasText: 'George Russell' }).click();
  check('choosing from the list updates the comparison', await waitFor(P, () => document.querySelectorAll('.f1-h2h-row').length === 10));
  await pickers.nth(1).locator('.f1-picker-button').click();
  await P.locator(`.f1-picker-menu:not([hidden]) .f1-picker-option[data-value="${firstValue}"]`).click();
  check('same driver twice asks for two', await waitFor(P, () => /two different drivers/i.test(document.body.innerText)));

  await P.locator('.f1-tab', { hasText: 'Overview' }).click();
  await P.locator('.f1-season-btn', { hasText: '2025' }).click();
  const champion2025 = JSON.parse(fixture('2025_driverStandings.json')).MRData.StandingsTable.StandingsLists[0].DriverStandings[0].Driver.familyName;
  check('past season overview names the champion', await waitFor(P, (n) => document.body.innerText.toLowerCase().includes(n.toLowerCase()), champion2025));

  await P.locator('.f1-season-btn', { hasText: '2026' }).click();
  await P.locator('.f1-tab', { hasText: 'Standings' }).click();
  provider.fail = { match: '2024/driverStandings', status: 500 };
  await P.locator('.f1-season-btn', { hasText: '2024' }).click();
  check('provider failure is not reported as an empty season', await waitFor(P, () => /unavailable/i.test(document.body.innerText) && !/No telemetry/i.test(document.body.innerText)));
  provider.fail = null;
  await P.getByRole('button', { name: /retry/i }).first().click();
  check('retry after failure', await waitFor(P, () => /No telemetry data available/i.test(document.body.innerText) || document.querySelectorAll('.f1-table tbody tr').length > 0));
  provider.fail = { match: '2023/driverStandings', status: 429 };
  await P.locator('.f1-season-btn', { hasText: '2023' }).click();
  check('rate limit reads as busy', await waitFor(P, () => /busy/i.test(document.body.innerText)));
  provider.fail = null;
  provider.delay = { '2025/driverStandings': 1500 };
  await P.locator('.f1-season-btn', { hasText: '2025' }).click();
  await P.locator('.f1-season-btn', { hasText: '2026' }).click();
  await P.waitForTimeout(2500);
  const leader2026 = standings[0].Driver.familyName.toUpperCase();
  const firstRow = await P.locator('.f1-table tbody tr').first().innerText();
  check('a late response for another season is discarded', firstRow.toUpperCase().includes(leader2026), firstRow);
  provider.delay = {};
  check('dashboard writes nothing to storage', await P.evaluate(() => localStorage.length === 0 && sessionStorage.length === 0 && document.cookie === ''));
  check('dashboard stays within its width', await P.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));

  await P.locator('.f1-tab', { hasText: 'Standings' }).click();
  await P.locator('.f1-standings-wrapper').click({ position: { x: 2, y: 2 } }).catch(() => {});
  check('clicking content does not open the entry', await P.evaluate(() => !document.querySelector('input[type=password]')));
  await enterDesktop(P, '12345678');
  await P.waitForTimeout(800);
  check('a wrong key leaves the dashboard as it was', await P.evaluate(() => !!document.querySelector('.f1-header') && !document.querySelector('.chat-layout') && !document.querySelector('input[type=password]')));
  await dash.context.close();

  const lockCtx = await newContext({ ip: '10.3.0.1' });
  for (const code of ['11111111', '22222222', '33333333']) {
    await enterDesktop(lockCtx.page, code);
    await lockCtx.page.waitForTimeout(700);
  }
  check('three wrong keys show the lock dot', await waitFor(lockCtx.page, () => [...document.querySelectorAll('.f1-header div')].some((d) => getComputedStyle(d).borderRadius === '50%' && d.style.background.includes('danger'))));
  await lockCtx.page.locator('.f1-content-box').first().click({ position: { x: 5, y: 5 } });
  check('entry stays closed while locked', await lockCtx.page.evaluate(() => !document.querySelector('input[type=password]')));
  await lockCtx.context.close();

  const a = await newContext({ ip: '10.4.0.1' });
  const A = a.page;
  await enterDesktop(A, keys.alpha);
  check('desktop entry opens the chat', await waitFor(A, () => document.querySelector('.chat-header h1')?.textContent === 'The Bunker'));
  check('url never changes', new URL(A.url()).pathname === '/');
  check('latest fifty messages load', await waitFor(A, () => document.querySelectorAll('.message-row').length === 50));
  check('alone while the other is away', await waitFor(A, () => document.querySelector('.chat-header .header-left div')?.dataset.tone === 'alone'));

  const b = await newContext({ mobile: true, ip: '10.4.0.2' });
  const B = b.page;
  await B.waitForSelector('.f1-about', { timeout: 15000 });
  check('about card fits a phone', await B.evaluate(() => document.querySelector('.f1-about').getBoundingClientRect().right <= window.innerWidth && document.documentElement.scrollWidth <= window.innerWidth));
  await B.locator('.f1-about').scrollIntoViewIfNeeded();
  await shot(B, 'dashboard-about-mobile');
  for (let i = 0; i < 5; i++) await B.locator('.f1-logo-container').tap();
  check('five taps open the keypad', await waitFor(B, () => /ENTER KEY/.test(document.body.innerText)));
  for (const digit of keys.bravo) await B.getByRole('button', { name: digit, exact: true }).tap();
  await B.getByRole('button', { name: 'OK', exact: true }).tap();
  check('keypad entry opens the chat', await waitFor(B, () => !!document.querySelector('.chat-layout')));
  check('both here once both poll', await waitFor(A, () => document.querySelector('.chat-header .header-left div')?.dataset.tone === 'together', null, 20000) && await waitFor(B, () => document.querySelector('.chat-header .header-left div')?.dataset.tone === 'together', null, 20000));
  await shot(A, 'chat-desktop');

  await A.locator('.chat-input').fill('hello from the gate');
  await A.keyboard.press('Control+Enter');
  check('sent message shows for the sender', await waitFor(A, () => [...document.querySelectorAll('.msg-body')].some((n) => n.innerText === 'hello from the gate')));
  check('sent message reaches the other', await waitFor(B, () => [...document.querySelectorAll('.msg-body')].some((n) => n.innerText === 'hello from the gate')));
  const sentRow = (page) => page.locator('.message-row', { hasText: 'hello from the gate' }).last();

  await sentRow(B).locator('.reaction-add').tap();
  await B.locator('.reaction-picker button', { hasText: '🔥' }).tap();
  check('reaction reaches the sender', await waitFor(A, () => [...document.querySelectorAll('.message-row')].some((r) => r.innerText.includes('hello from the gate') && r.querySelector('.reaction-pill:not(.reaction-add)')?.innerText.includes('🔥'))));

  await sentRow(A).hover();
  await sentRow(A).locator('.msg-action-btn[title=Edit]').click();
  await A.locator('.edit-textarea').fill('hello, edited');
  await A.keyboard.press('Enter');
  check('edit reaches the other', await waitFor(B, () => [...document.querySelectorAll('.message-row')].some((r) => r.innerText.includes('hello, edited') && r.innerText.includes('edited'))));
  check('other identity has no edit control', await B.locator('.message-row', { hasText: 'hello, edited' }).locator('.msg-action-btn[title=Edit]').count() === 0);

  await B.locator('.message-row', { hasText: 'hello, edited' }).locator('.msg-action-btn[title=Reply]').tap();
  await B.locator('.chat-input').fill('a reply');
  await B.locator('.send-action').tap();
  check('reply carries its quote', await waitFor(A, () => [...document.querySelectorAll('.message-row')].some((r) => r.innerText.includes('a reply') && r.querySelector('.reply-quote')?.innerText.includes('hello, edited'))));

  await A.locator('.message-row', { hasText: 'hello, edited' }).first().hover();
  await A.locator('.message-row', { hasText: 'hello, edited' }).first().locator('.msg-action-btn[title=Delete]').click();
  check('deletion reaches the other', await waitFor(B, () => [...document.querySelectorAll('.msg-deleted')].length >= 1));
  check('reply quote shows the deletion', await waitFor(B, () => [...document.querySelectorAll('.reply-quote__body')].some((q) => q.innerText === 'Message deleted')));

  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFklEQVR4nGP8z8DAwMDAxMDAwMDAAAANHQEDasKb6QAAAABJRU5ErkJggg==', 'base64');
  await A.locator('input[type=file]').setInputFiles({ name: 'pixel.png', mimeType: 'image/png', buffer: png });
  check('upload shows a pending attachment', await waitFor(A, () => document.querySelectorAll('.attachment-mini').length === 1));
  check('send is enabled with an attachment and no text', await A.locator('.send-action').isEnabled());
  await A.locator('.send-action').click();
  check('attachment-only message reaches the other as an image', await waitFor(B, () => [...document.querySelectorAll('.msg-attachments img')].some((img) => img.src.startsWith('blob:')), null, 20000));
  await B.locator('.msg-attachments .lazy-asset-container').last().tap();
  check('preview opens the image', await waitFor(B, () => !!document.querySelector('.up-overlay img.up-image')));
  await B.locator('.up-close-btn').tap();

  const webm = await A.evaluate(async () => {
    const canvas = Object.assign(document.createElement('canvas'), { width: 160, height: 90 });
    const g = canvas.getContext('2d');
    const recorder = new MediaRecorder(canvas.captureStream(15), { mimeType: 'video/webm;codecs=vp8' });
    const parts = [];
    recorder.ondataavailable = (e) => parts.push(e.data);
    const done = new Promise((r) => { recorder.onstop = r; });
    recorder.start();
    for (let i = 0; i < 12; i++) { g.fillStyle = `hsl(${i * 30},80%,50%)`; g.fillRect(0, 0, 160, 90); await new Promise((r) => setTimeout(r, 70)); }
    recorder.stop();
    await done;
    const bytes = new Uint8Array(await new Blob(parts).arrayBuffer());
    let text = '';
    for (const b of bytes) text += String.fromCharCode(b);
    return btoa(text);
  });
  await A.locator('input[type=file]').setInputFiles({ name: 'clip.webm', mimeType: 'video/webm', buffer: Buffer.from(webm, 'base64') });
  await waitFor(A, () => document.querySelectorAll('.attachment-mini').length === 1);
  await A.locator('.send-action').click();
  check('video thumbnail shows a frame in the chat', await waitFor(B, () => [...document.querySelectorAll('.msg-attachments video')].some((v) => v.readyState >= 2 && v.videoWidth > 0 && v.src.endsWith('#t=0.1')), null, 20000));

  await A.locator('.gallery-toggle').click();
  check('gallery lists the photo and the video from the server', await waitFor(A, () => document.querySelectorAll('.media-inspector.is-open .asset-card').length === 2));
  check('gallery video thumbnail shows a frame', await waitFor(A, () => [...document.querySelectorAll('.media-inspector video')].some((v) => v.readyState >= 2 && v.videoWidth > 0), null, 20000));
  await shot(A, 'chat-gallery');
  await A.locator('.gallery-toggle').click();

  await A.locator('.header-icon-btn[title="Search messages"]').click();
  await A.locator('.search-panel-input').fill('zebracrossing');
  await waitFor(A, () => document.querySelectorAll('.search-result-card').length === 1);
  await A.locator('.search-panel-input').press('Enter');
  check('enter in search jumps to the first result', await waitFor(A, () => !document.querySelector('.search-overlay') && !document.querySelector('.context-banner').hidden && [...document.querySelectorAll('.message-row')].some((r) => r.innerText.includes('zebracrossing'))));
  await A.locator('.context-banner__action').click();
  await waitFor(A, () => document.querySelector('.context-banner').hidden);

  await B.locator('.header-icon-btn[title="Search messages"]').tap();
  await B.locator('.search-panel-input').fill('zebracrossing');
  check('search finds an old message', await waitFor(B, () => document.querySelectorAll('.search-result-card').length === 1));
  await B.locator('.search-result-card').tap();
  check('an old result opens the context view', await waitFor(B, () => !document.querySelector('.context-banner').hidden && [...document.querySelectorAll('.message-row')].some((r) => r.innerText.includes('zebracrossing'))));
  check('the live list is not spliced', await B.evaluate(() => ![...document.querySelectorAll('.msg-body')].some((n) => n.innerText === 'a reply')));
  await A.locator('.chat-input').fill('arrives during context');
  await A.keyboard.press('Control+Enter');
  await B.waitForTimeout(6000);
  check('new messages wait outside the context view', await B.evaluate(() => ![...document.querySelectorAll('.msg-body')].some((n) => n.innerText === 'arrives during context')));
  await B.locator('.context-banner__action').tap();
  check('back to latest restores the live list', await waitFor(B, () => document.querySelector('.context-banner').hidden && [...document.querySelectorAll('.msg-body')].some((n) => n.innerText === 'arrives during context')));

  await A.route('**/api/link_preview.php*', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ title: 'Preview without image', description: '', image: '' }) }));
  await A.locator('.chat-input').fill('see https://example.org/no-image');
  await A.keyboard.press('Control+Enter');
  check('a preview without an image draws no image', await waitFor(A, () => [...document.querySelectorAll('.link-preview')].some((c) => c.innerText.includes('Preview without image') && !c.querySelector('img'))));
  await A.unroute('**/api/link_preview.php*');

  const firstVisible = () => A.evaluate(() => {
    const list = document.querySelector('.message-list');
    const top = list.getBoundingClientRect().top;
    const row = [...list.querySelectorAll('.message-row')].find((r) => r.getBoundingClientRect().bottom > top + 1);
    return row ? Number(row.id.replace('msg-', '')) : -1;
  });
  const listBox = await A.locator('.message-list').boundingBox();
  await A.mouse.move(listBox.x + listBox.width / 2, listBox.y + listBox.height / 2);
  const seenWhileScrolling = [await firstVisible()];
  const wheelStart = Date.now();
  while (Date.now() - wheelStart < 6000) {
    await A.mouse.wheel(0, -40);
    await A.waitForTimeout(40);
    seenWhileScrolling.push(await firstVisible());
  }
  check('scrolling up at a normal pace never jumps back to newer messages', seenWhileScrolling.every((id, i) => i === 0 || id <= seenWhileScrolling[i - 1]), seenWhileScrolling.join(','));
  const restedAt = await firstVisible();
  await A.waitForTimeout(5000);
  check('a poll leaves a reader who scrolled up where they are', await firstVisible() === restedAt);

  await A.evaluate(() => { document.querySelector('.message-list').scrollTop = 0; });
  check('scrolling up loads older messages', await waitFor(A, () => [...document.querySelectorAll('.msg-body')].some((n) => /seed message 2\d$/.test(n.innerText)) || document.querySelectorAll('.message-row').length > 55, null, 20000));

  await B.route('**/api/messages.php?after=*', (route) => route.abort());
  check('a failing connection turns the dot red', await waitFor(B, () => document.querySelector('.chat-header .header-left div')?.dataset.tone === 'error', null, 20000));
  await B.unroute('**/api/messages.php?after=*');
  check('recovery clears the error', await waitFor(B, () => document.querySelector('.chat-header .header-left div')?.dataset.tone !== 'error', null, 30000));

  await A.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  check('hiding the tab returns to the dashboard', await waitFor(A, () => !!document.querySelector('.f1-header') && !document.querySelector('.chat-layout')));
  check('leaving clears the session', await A.evaluate(() => sessionStorage.length === 0 && localStorage.length === 0));
  site.sql(`UPDATE user_presence SET last_seen = UTC_TIMESTAMP() - INTERVAL 60 SECOND WHERE identity = 'user-a'`);
  check('the other sees the departure', await waitFor(B, () => document.querySelector('.chat-header .header-left div')?.dataset.tone === 'alone', null, 20000));

  await B.route('**/api/messages.php?after=*', (route) => route.fulfill({ status: 401, contentType: 'application/json', body: '{"error":"invalid"}' }));
  check('an expired token returns to the dashboard', await waitFor(B, () => !!document.querySelector('.f1-header'), null, 20000));
  check('expiry clears the session', await B.evaluate(() => sessionStorage.length === 0));

  const swReady = await A.evaluate(() => Promise.race([navigator.serviceWorker.ready.then(() => true), new Promise((r) => setTimeout(() => r(false), 5000))]));
  check('service worker registers', swReady);
  const cached = await A.evaluate(async () => {
    const names = await caches.keys();
    const urls = [];
    for (const name of names) for (const req of await (await caches.open(name)).keys()) urls.push(req.url);
    return { names, urls };
  });
  check('service worker cache holds no API response', cached.urls.every((u) => !u.includes('/api/')), cached.urls.join(','));
  check('service worker cache has a neutral name', cached.names.every((n) => n === 'f1-shell'), cached.names.join(','));

  const unexpected = consoleProblems.filter((m) => !/^Failed to load resource|net::ERR_/.test(m));
  check('no console errors or policy violations', unexpected.length === 0, unexpected.slice(0, 5).join(' | '));
  check('only the two data providers are contacted', provider.requests.every((u) => /^https:\/\/api\.(jolpi\.ca|openf1\.org)\//.test(u)));
} catch (error) {
  failures.push(`gate crashed: ${error.stack}`);
  console.log(error.stack);
} finally {
  await browser.close();
  await site.stop();
}

for (const failure of failures) console.log(`FAIL ${failure}`);
console.log(`browser gate: ${passed} passed, ${failures.length} failed`);
process.exit(failures.length ? 1 : 0);
