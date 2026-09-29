import { h, icon, replace } from '../lib/dom.js';
import { driverName, teamColour } from './common.js';

function optionContent(entry) {
  return [
    h('span', { class: 'f1-picker-pos' }, `P${entry.position}`),
    h('span', { class: 'f1-picker-stripe', style: { background: teamColour(entry) } }),
    h('span', { class: 'f1-picker-name' }, driverName(entry)),
    h('span', { class: 'f1-picker-team' }, entry.Constructors?.[0]?.name || '')
  ];
}

/**
 * A styled driver select built on the WAI-ARIA listbox pattern
 * (https://www.w3.org/WAI/ARIA/apg/patterns/listbox/): arrow keys, Home, End,
 * Enter, Space, Escape and type-ahead on the open list.
 *
 * @param {{entries: object[], value: string, label: string, onChange: (driverId: string) => void}} options
 *   entries are Jolpica driver standings; value and onChange use driverId.
 * @returns {{element: HTMLElement, destroy: () => void}}
 */
export function createDriverPicker({ entries, value, label, onChange }) {
  const id = `picker-${Math.random().toString(36).slice(2, 9)}`;
  let selected = entries.findIndex(entry => entry.Driver?.driverId === value);
  let active = selected;
  let open = false;
  let typed = '';
  let typedTimer = null;

  const current = h('span', { class: 'f1-picker-current' });
  const button = h('button', { type: 'button', class: 'f1-picker-button', 'aria-haspopup': 'listbox', 'aria-expanded': 'false', 'aria-controls': id, 'aria-label': label },
    current,
    icon(16, [['polyline', { points: '6 9 12 15 18 9' }]], { class: 'f1-picker-chevron' }));
  const options = entries.map((entry, index) => h('li', {
    role: 'option',
    class: 'f1-picker-option',
    dataset: { value: entry.Driver?.driverId || '' },
    onclick: event => {
      event.stopPropagation();
      choose(index);
    },
    onmousemove: () => setActive(index, false)
  }, optionContent(entry)));
  const menu = h('ul', { id, role: 'listbox', class: 'f1-picker-menu', tabIndex: -1, hidden: true, 'aria-label': label }, options);
  const element = h('div', { class: 'f1-picker', dataset: { value } }, button, menu);

  function paintCurrent() {
    const entry = entries[selected];
    replace(current, entry ? optionContent(entry).slice(0, 3) : '');
    options.forEach((option, index) => option.setAttribute('aria-selected', String(index === selected)));
  }

  function setActive(index, scroll = true) {
    active = Math.max(0, Math.min(entries.length - 1, index));
    options.forEach((option, i) => option.classList.toggle('is-active', i === active));
    if (scroll) options[active]?.scrollIntoView({ block: 'nearest' });
  }

  function outside(event) {
    if (!element.contains(event.target)) close(false);
  }

  function setOpen(next) {
    open = next;
    menu.hidden = !next;
    button.setAttribute('aria-expanded', String(next));
    element.classList.toggle('is-open', next);
    if (next) {
      document.addEventListener('pointerdown', outside, true);
      setActive(selected < 0 ? 0 : selected);
      menu.focus({ preventScroll: true });
    } else {
      document.removeEventListener('pointerdown', outside, true);
    }
  }

  function close(focusButton = true) {
    if (!open) return;
    setOpen(false);
    if (focusButton) button.focus({ preventScroll: true });
  }

  function choose(index) {
    const changed = index !== selected;
    selected = index;
    element.dataset.value = entries[index]?.Driver?.driverId || '';
    paintCurrent();
    close();
    if (changed) onChange(element.dataset.value);
  }

  function typeAhead(key) {
    clearTimeout(typedTimer);
    typed += key.toLowerCase();
    typedTimer = setTimeout(() => { typed = ''; }, 700);
    const match = entries.findIndex(entry => driverName(entry).toLowerCase().startsWith(typed)
      || (entry.Driver?.familyName || '').toLowerCase().startsWith(typed));
    if (match !== -1) setActive(match);
  }

  button.addEventListener('click', event => {
    event.stopPropagation();
    setOpen(!open);
  });
  button.addEventListener('keydown', event => {
    if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(event.key)) {
      event.preventDefault();
      setOpen(true);
    }
  });
  menu.addEventListener('keydown', event => {
    if (event.key === 'ArrowDown') setActive(active + 1);
    else if (event.key === 'ArrowUp') setActive(active - 1);
    else if (event.key === 'Home') setActive(0);
    else if (event.key === 'End') setActive(entries.length - 1);
    else if (event.key === 'Enter' || event.key === ' ') choose(active);
    else if (event.key === 'Escape') close(true);
    else if (event.key === 'Tab') {
      close(false);
      return;
    }
    else if (event.key.length === 1 && /\S/.test(event.key)) typeAhead(event.key);
    else return;
    event.preventDefault();
  });

  paintCurrent();
  return { element, destroy: () => { clearTimeout(typedTimer); document.removeEventListener('pointerdown', outside, true); } };
}
