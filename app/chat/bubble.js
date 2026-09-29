import { h, s, icon, replace } from '../lib/dom.js';
import { IDENTITY_MAP } from '../config/identities.js';
import { formatMessageTime, formatMessageDate } from '../lib/time.js';
import { renderMarkdown } from '../lib/markdown.js';
import { extractUrls, stripCode, fetchPreview, safeHref, TRAILING_PUNCTUATION } from '../lib/links.js';
import { acquireMedia, mediaKind, videoThumbnail, THUMBNAIL_VIDEO_MAX_BYTES } from './media.js';

// The server allows edits and deletions for 120 seconds after sending.
const EDIT_WINDOW_MS = 2 * 60 * 1000;
export const REACTIONS = ['👍', '❤️', '🔥', '😂', '😮', '😢'];

const escapeRegex = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function highlightText(text, term) {
  if (!term || typeof text !== 'string') return [text];
  return text.split(new RegExp(`(${escapeRegex(term)})`, 'gi')).map((part) =>
    part.toLowerCase() === term.toLowerCase() ? h('mark', { class: 'highlight-mark' }, part) : part);
}

function quoteSnippet(text) {
  const flat = text.replace(/\s*\n\s*/g, ' ');
  if (flat.length <= 50) return [flat];
  return [flat.slice(0, 50), h('span', { class: 'reply-ellipsis' }, '...')];
}

/**
 * Whether this tab sent the message. Edit and delete are offered only then,
 * because the server accepts a change only with the nonce of the login that
 * sent it.
 */
export function sentThisSession(id) {
  try {
    return new Set(JSON.parse(sessionStorage.getItem('sent_ids') || '[]')).has(id);
  } catch {
    return false;
  }
}

export function rememberSent(id) {
  try {
    const ids = JSON.parse(sessionStorage.getItem('sent_ids') || '[]');
    if (!ids.includes(id)) ids.push(id);
    sessionStorage.setItem('sent_ids', JSON.stringify(ids));
  } catch {}
}

function linkPreview(url) {
  const card = h('div', { class: 'link-preview--loading glass' },
    h('div', { class: 'skeleton-thumbnail' }),
    h('div', { class: 'skeleton-content' }, h('div', { class: 'skeleton-line' }), h('div', { class: 'skeleton-line skeleton-line--short' })));
  fetchPreview(url).then((preview) => {
    if (!preview || (!preview.title && !preview.image)) {
      card.remove();
      return;
    }
    const href = safeHref(url);
    const image = preview.image ? safeHref(preview.image) : null;
    const link = h('a', { href: href || '#', target: '_blank', rel: 'noopener noreferrer', class: 'link-preview glass' },
      image && image.startsWith('https:') ? h('div', { class: 'link-preview__image-container' }, h('img', { src: image, alt: '', class: 'link-preview__image', referrerPolicy: 'no-referrer' })) : null,
      h('div', { class: 'link-preview__content' },
        h('div', { class: 'link-preview__site' }, new URL(url).hostname),
        h('div', { class: 'link-preview__title' }, preview.title),
        preview.description ? h('div', { class: 'link-preview__desc' }, preview.description) : null));
    card.replaceWith(link);
  });
  return card;
}

function playOverlay(isUserA, filename) {
  return h('div', { style: { position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '8px' } },
    h('div', { style: { width: '44px', height: '44px', borderRadius: '50%', background: isUserA ? 'rgba(0,255,208,0.85)' : 'rgba(255,0,255,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: isUserA ? '0 0 20px rgba(0,255,208,0.4)' : '0 0 20px rgba(255,0,255,0.4)' } },
      s('svg', { viewBox: '0 0 24 24', width: 20, height: 20, fill: '#000' }, s('path', { d: 'M8 5v14l11-7z' }))),
    h('div', { style: { fontSize: '0.68rem', color: 'rgba(255,255,255,0.8)', fontFamily: 'monospace', textAlign: 'center', padding: '0 8px', maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, filename));
}

function assetView(attachment, isUserA, holder) {
  const kind = mediaKind(attachment.mime_type, attachment.original_name);
  const filename = attachment.original_name || 'file';

  if (kind === 'audio') {
    const bars = [14, 28, 20, 36, 24, 16, 32, 20, 28, 14, 24, 32, 18, 26, 14];
    return h('div', { style: { width: '100%', height: '100%', cursor: 'pointer', background: 'linear-gradient(135deg, rgba(0,0,0,0.6), rgba(0,0,0,0.3))', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '10px' } },
      h('div', { style: { display: 'flex', alignItems: 'flex-end', gap: '3px', height: '36px' } },
        bars.map((height) => h('div', { style: { width: '3px', height: `${height}px`, background: 'linear-gradient(180deg, var(--accent-neon), var(--accent-tron))', borderRadius: '2px', opacity: 0.7 } }))),
      h('div', { style: { fontSize: '0.68rem', color: 'rgba(255,255,255,0.7)', fontFamily: 'monospace', textAlign: 'center', padding: '0 8px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '100%' } }, filename),
      h('div', { style: { fontSize: '0.65rem', color: 'var(--accent-neon)', letterSpacing: '0.08em' } }, '♪ TAP TO PLAY'));
  }

  if (kind === 'video') {
    const frame = h('div', { style: { position: 'relative', width: '100%', height: '100%', cursor: 'pointer', overflow: 'hidden' } }, h('div', { class: 'skeleton-asset' }), playOverlay(isUserA, filename));
    if ((attachment.file_size || 0) <= THUMBNAIL_VIDEO_MAX_BYTES) {
      const lease = acquireMedia(attachment.id);
      holder.leases.push(lease);
      lease.ready.then((entry) => {
        if (holder.destroyed) return;
        frame.firstChild.replaceWith(videoThumbnail(entry.url, { width: '100%', height: '100%', display: 'block' }));
      }).catch(() => {});
    } else {
      frame.firstChild.replaceWith(h('div', { style: { width: '100%', height: '100%', background: '#0a0a0a' } }));
    }
    return frame;
  }

  if (kind === 'image') {
    const slot = h('div', { class: 'skeleton-asset' });
    const lease = acquireMedia(attachment.id);
    holder.leases.push(lease);
    lease.ready.then((entry) => {
      if (holder.destroyed) return;
      slot.replaceWith(h('img', { src: entry.url, loading: 'lazy', alt: filename }));
    }).catch(() => {});
    return slot;
  }

  return h('div', { class: 'file-asset', style: { display: 'flex', alignItems: 'center', gap: '12px', padding: '16px', background: 'rgba(255,255,255,0.02)', color: 'var(--text-primary)' } },
    icon(24, [['path', { d: 'M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z' }], ['polyline', { points: '13 2 13 9 20 9' }]]),
    h('span', { style: { fontSize: '0.9rem', fontWeight: 500 } }, `Attachment: ${filename}`));
}

function lazyAsset(attachment, isUserA, onPreview, holder) {
  const container = h('div', { class: 'lazy-asset-container', onClick: (e) => { e.stopPropagation(); onPreview(attachment); } }, h('div', { class: 'skeleton-asset' }));
  const observer = new IntersectionObserver(([entry]) => {
    if (!entry.isIntersecting) return;
    observer.disconnect();
    if (!holder.destroyed) replace(container, assetView(attachment, isUserA, holder));
  }, { rootMargin: '600px' });
  observer.observe(container);
  holder.observers.push(observer);
  return container;
}

export function createBubble(message, ctx) {
  const holder = { leases: [], observers: [], destroyed: false };
  const state = { message, editing: false, picker: false, editTimer: null, flash: false, highlight: '' };
  const row = h('div', { id: `msg-${message.id}` });

  const cleanupAssets = () => {
    for (const o of holder.observers) o.disconnect();
    for (const l of holder.leases) l.release();
    holder.observers = [];
    holder.leases = [];
  };

  const canModify = () => {
    const m = state.message;
    return !m.is_deleted && sentThisSession(m.id) && Date.now() - new Date(m.created_at).getTime() < EDIT_WINDOW_MS;
  };

  const scheduleEditExpiry = () => {
    if (state.editTimer) clearTimeout(state.editTimer);
    const remaining = EDIT_WINDOW_MS - (Date.now() - new Date(state.message.created_at).getTime());
    if (remaining > 0 && sentThisSession(state.message.id)) {
      state.editTimer = setTimeout(() => { state.editTimer = null; render(); }, remaining + 50);
    }
  };

  const react = async (emoji) => {
    state.picker = false;
    const me = ctx.identity();
    const before = state.message;
    const reactions = [...(before.reactions || [])];
    const index = reactions.findIndex((r) => r.emoji === emoji && r.identity === me);
    if (index !== -1) reactions.splice(index, 1);
    else reactions.push({ emoji, identity: me });
    ctx.patch(before.id, (m) => ({ ...m, reactions }));
    try {
      const data = await ctx.request('/api/reactions.php', { method: 'POST', body: { message_id: before.id, emoji } });
      ctx.apply(data.message);
    } catch (error) {
      ctx.patch(before.id, (m) => ({ ...m, reactions: before.reactions }));
      ctx.onError(error);
    }
  };

  const submitEdit = async (text) => {
    const m = state.message;
    const body = text.replace(/\r\n/g, '\n').trim();
    state.editing = false;
    if (body === m.message_body || (!body && !(m.attachments || []).length)) {
      render();
      return;
    }
    ctx.patch(m.id, (x) => ({ ...x, message_body: body, edited_at: new Date().toISOString() }));
    try {
      const data = await ctx.request('/api/messages.php', { method: 'PATCH', body: { id: m.id, message_body: body, session_nonce: ctx.nonce() } });
      ctx.apply(data);
    } catch (error) {
      ctx.patch(m.id, (x) => ({ ...x, message_body: m.message_body, edited_at: m.edited_at }));
      ctx.onError(error);
    }
  };

  const remove = async () => {
    const m = state.message;
    ctx.patch(m.id, (x) => ({ ...x, is_deleted: 1, message_body: '', attachments: [], reactions: [] }));
    try {
      const data = await ctx.request('/api/messages.php', { method: 'DELETE', body: { id: m.id, session_nonce: ctx.nonce() } });
      ctx.apply(data);
    } catch (error) {
      ctx.patch(m.id, () => m);
      ctx.onError(error);
    }
  };

  const actionButton = (title, className, paths, onClick) =>
    h('button', { class: `msg-action-btn${className ? ` ${className}` : ''}`, title, onClick }, icon(13, paths, { 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));

  function render() {
    cleanupAssets();
    const m = state.message;
    const me = ctx.identity();
    const isUserA = m.sender_identity === 'user-a';
    const isMine = m.sender_identity === me;
    const isDeleted = !!m.is_deleted;
    const name = IDENTITY_MAP[m.sender_identity] || m.sender_identity;
    row.className = `message-row ${isMine ? 'is-mine' : 'is-other'}${state.flash ? ' is-flashing' : ''}`;

    const header = h('div', { class: 'msg-header' },
      h('span', { class: `msg-author ${isUserA ? 'user-a' : 'user-b'}` }, name),
      h('time', { class: 'msg-time', title: new Date(m.created_at).toLocaleString() },
        `${formatMessageDate(m.created_at)} · ${formatMessageTime(m.created_at)}`,
        m.edited_at && !isDeleted ? h('span', { class: 'msg-edited' }, ' · edited') : null));

    if (!isDeleted && !state.editing) {
      const actions = h('div', { class: 'msg-actions' },
        actionButton('Reply', '', [['polyline', { points: '9 17 4 12 9 7' }], ['path', { d: 'M20 18v-2a4 4 0 0 0-4-4H4' }]], () => ctx.onReply(state.message)));
      if (canModify()) {
        actions.append(
          actionButton('Edit', '', [['path', { d: 'M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7' }], ['path', { d: 'M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z' }]], () => { state.editing = true; render(); }),
          actionButton('Delete', 'delete', [['polyline', { points: '3 6 5 6 21 6' }], ['path', { d: 'M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6' }], ['path', { d: 'M10 11v6M14 11v6' }], ['path', { d: 'M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2' }]], remove));
      }
      header.append(actions);
    }

    const content = h('div', { class: 'msg-content' }, header);

    if (m.reply_to_id) {
      const replyClass = m.reply_to_sender === 'user-a' ? 'user-a' : 'user-b';
      content.append(h('div', { class: `reply-quote ${replyClass}`, onClick: () => ctx.onQuote(m.reply_to_id) },
        h('span', { class: `reply-quote__sender ${replyClass}` }, IDENTITY_MAP[m.reply_to_sender] || m.reply_to_sender),
        h('span', { class: 'reply-quote__body' }, m.reply_to_is_deleted ? 'Message deleted' : quoteSnippet(m.reply_to_body || '…'))));
    }

    if (state.editing) {
      const textarea = h('textarea', { class: 'edit-textarea', value: m.message_body });
      const resize = () => { textarea.style.height = 'auto'; textarea.style.height = `${textarea.scrollHeight}px`; };
      textarea.addEventListener('input', resize);
      textarea.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submitEdit(textarea.value); }
        if (e.key === 'Escape') { state.editing = false; render(); }
      });
      content.append(h('div', { class: 'edit-mode' }, textarea,
        h('div', { class: 'edit-actions' },
          h('span', { class: 'edit-hint' }, 'Enter to save · Esc to cancel'),
          h('button', { class: 'edit-btn edit-btn--cancel', onClick: () => { state.editing = false; render(); } }, 'Cancel'),
          h('button', { class: 'edit-btn edit-btn--save', onClick: () => submitEdit(textarea.value) }, 'Save'))));
      requestAnimationFrame(() => { resize(); textarea.focus(); textarea.setSelectionRange(textarea.value.length, textarea.value.length); });
    } else {
      const renderText = (plain) => plain.split(/(https?:\/\/[^\s]+)/g).map((part) => {
        if (/^https?:\/\//.test(part)) {
          const address = part.replace(TRAILING_PUNCTUATION, '');
          const href = safeHref(address);
          return href ? [h('a', { href, target: '_blank', rel: 'noopener noreferrer' }, address), highlightText(part.slice(address.length), state.highlight)] : part;
        }
        return highlightText(part, state.highlight);
      });
      content.append(h('div', { class: 'msg-body' }, isDeleted ? h('span', { class: 'msg-deleted' }, 'Message deleted') : renderMarkdown(m.message_body || '', renderText)));

      const urls = isDeleted ? [] : extractUrls(stripCode(m.message_body));
      if (urls.length) content.append(h('div', { style: { marginTop: '8px' } }, urls.map(linkPreview)));

      if (!isDeleted && (m.attachments || []).length) {
        content.append(h('div', { class: 'msg-attachments' }, m.attachments.map((a) => lazyAsset(a, isUserA, (att) => ctx.onPreview(att, m), holder))));
      }

      if (!isDeleted) {
        const counts = {};
        const mine = new Set();
        for (const r of m.reactions || []) {
          counts[r.emoji] = (counts[r.emoji] || 0) + 1;
          if (r.identity === me) mine.add(r.emoji);
        }
        const trigger = h('div', { class: 'reaction-trigger', style: { position: 'relative' } },
          h('button', { class: 'reaction-add reaction-pill', onClick: () => { state.picker = !state.picker; render(); } }, '+'),
          state.picker ? h('div', { class: 'reaction-picker' }, REACTIONS.map((emoji) =>
            h('button', { class: 'touch-target', style: { background: 'none', border: 'none', fontSize: '1.2rem', cursor: 'pointer' }, onClick: () => react(emoji) }, emoji))) : null);
        content.append(h('div', { class: 'bubble__reactions' },
          Object.entries(counts).map(([emoji, count]) => h('div', { class: `reaction-pill${mine.has(emoji) ? ' active' : ''}`, onClick: () => react(emoji) }, h('span', null, emoji), h('span', null, String(count)))),
          trigger));
      }
    }

    replace(row,
      h('div', { class: 'avatar-col', style: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' } },
        h('div', { class: `msg-avatar ${isUserA ? 'user-a' : 'user-b'}` }, (IDENTITY_MAP[m.sender_identity] || 'U')[0])),
      content);
    scheduleEditExpiry();
  }

  render();

  return {
    node: row,
    get message() { return state.message; },
    update(next) {
      if (next === state.message) return;
      state.message = next;
      if (state.editing && !next.is_deleted) return;
      state.editing = false;
      render();
    },
    setHighlight(term) {
      if (term === state.highlight) return;
      state.highlight = term;
      if (!state.editing) render();
    },
    flash() {
      state.flash = true;
      row.classList.add('is-flashing');
      setTimeout(() => { state.flash = false; row.classList.remove('is-flashing'); }, 1400);
    },
    destroy() {
      holder.destroyed = true;
      cleanupAssets();
      if (state.editTimer) clearTimeout(state.editTimer);
    },
  };
}
