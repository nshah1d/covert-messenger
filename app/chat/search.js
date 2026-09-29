import { h, icon, replace } from '../lib/dom.js';
import { IDENTITY_MAP } from '../config/identities.js';
import { formatSearchTime } from '../lib/time.js';

const escapeRegex = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function snippet(text, query) {
  if (!text) return [];
  const radius = 70;
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  const start = Math.max(0, idx === -1 ? 0 : idx - radius);
  const end = Math.min(text.length, idx === -1 ? 140 : idx + query.length + radius);
  const raw = (start > 0 ? '…' : '') + text.slice(start, end) + (end < text.length ? '…' : '');
  return raw.split(new RegExp(`(${escapeRegex(query)})`, 'gi')).map((p) =>
    p.toLowerCase() === query.toLowerCase() ? h('mark', { class: 'search-highlight' }, p) : p);
}

export function createSearch({ request, onJump, container }) {
  let overlay = null;
  let timer = null;
  let controller = null;

  const close = () => {
    if (!overlay) return;
    clearTimeout(timer);
    if (controller) controller.abort();
    overlay.remove();
    overlay = null;
  };

  const open = () => {
    if (overlay) return;
    const results = h('div', { class: 'search-results-list' }, h('p', { class: 'search-hint' }, 'Type at least 2 characters to search.'));
    const input = h('input', { class: 'search-panel-input', type: 'text', placeholder: 'Search messages…', autocomplete: 'off', autocorrect: 'off', spellcheck: false });
    const clearBtn = h('button', { class: 'search-clear-btn', 'aria-label': 'Clear search', hidden: true, onClick: () => { input.value = ''; input.dispatchEvent(new Event('input')); input.focus(); } },
      icon(14, [['line', { x1: 18, y1: 6, x2: 6, y2: 18 }], ['line', { x1: 6, y1: 6, x2: 18, y2: 18 }]], { 'stroke-width': 2.5 }));

    let shown = { query: '', rows: [] };
    const show = (query, rows) => {
      shown = { query, rows: rows.slice(0, 12) };
      if (query.length < 2) {
        replace(results, h('p', { class: 'search-hint' }, 'Type at least 2 characters to search.'));
      } else if (!rows.length) {
        replace(results, h('p', { class: 'search-hint' }, `No messages match “${query}”.`));
      } else {
        replace(results, rows.slice(0, 12).map((r) => h('button', { class: 'search-result-card', onClick: () => { close(); onJump(r, query); } },
          h('div', { class: 'search-result-meta' },
            h('span', { class: `pill pill--${r.sender_identity}` }, IDENTITY_MAP[r.sender_identity] || r.sender_identity),
            h('span', { class: 'search-result-time' }, formatSearchTime(r.created_at))),
          h('div', { class: 'search-result-body' }, snippet(r.message_body, query)))));
      }
    };

    input.addEventListener('input', () => {
      const query = input.value.trim();
      clearBtn.hidden = input.value === '';
      clearTimeout(timer);
      if (controller) controller.abort();
      if (query.length < 2) {
        show(query, []);
        return;
      }
      // Each keystroke cancels the pending request, and results are shown only
      // while the input still holds the query they answer.
      timer = setTimeout(async () => {
        controller = new AbortController();
        try {
          const data = await request(`/api/messages.php?search=${encodeURIComponent(query)}`, { signal: controller.signal });
          if (overlay && input.value.trim() === query) show(query, data.messages);
        } catch (error) {
          if (error.name !== 'AbortError' && overlay) show(query, []);
        }
      }, 150);
    });

    // Enter jumps to the first result, as the footer says.
    input.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' || !shown.rows.length || shown.query !== input.value.trim()) return;
      e.preventDefault();
      const [first] = shown.rows;
      close();
      onJump(first, shown.query);
    });

    overlay = h('div', { class: 'search-overlay', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Search messages' },
      h('div', { class: 'search-panel' },
        h('div', { class: 'search-input-row' },
          icon(16, [['circle', { cx: 11, cy: 11, r: 8 }], ['line', { x1: 21, y1: 21, x2: 16.65, y2: 16.65 }]], { stroke: 'var(--text-dim)', style: { flexShrink: '0' } }),
          input, clearBtn),
        results,
        h('div', { class: 'search-footer' }, h('kbd', null, '↵'), h('span', null, 'jump to message'), h('kbd', null, 'esc'), h('span', null, 'close'))));
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    container.append(overlay);
    setTimeout(() => input.focus(), 40);
  };

  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);

  const button = h('button', { class: 'touch-target header-icon-btn', title: 'Search messages', 'aria-label': 'Search messages', onClick: open },
    icon(20, [['circle', { cx: 11, cy: 11, r: 8 }], ['line', { x1: 21, y1: 21, x2: 16.65, y2: 16.65 }]]));

  return {
    button,
    isOpen: () => overlay !== null,
    destroy() {
      close();
      document.removeEventListener('keydown', onKey);
    },
  };
}
