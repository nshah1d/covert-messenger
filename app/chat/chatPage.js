import { h, icon } from '../lib/dom.js';
import { api, currentSession, randomHex } from '../lib/api.js';
import { formatSearchTime } from '../lib/time.js';
import { createFeed } from './feed.js';
import { presenceState } from './presence.js';
import { createOutbox } from './outbox.js';
import { createMessageList } from './messageList.js';
import { createComposer } from './composer.js';
import { createSearch } from './search.js';
import { createGallery } from './gallery.js';
import { openPreview } from './preview.js';
import { rememberSent } from './bubble.js';
import { releaseAllMedia } from './media.js';

const TONES = {
  connecting: 'rgba(255,255,255,0.2)',
  error: '#ef4444',
  alone: '#f59e0b',
  together: 'var(--accent-tron)',
};

/**
 * Mounts the chat for the identity in the current session.
 *
 * @param {HTMLElement} root
 * @param {{onExit: () => void}} options onExit runs once, after the chat has torn
 *   itself down, and is expected to clear the session and show the dashboard.
 * @returns {{destroy: () => void, exit: () => void}}
 */
export function mountChat(root, { onExit }) {
  const session = currentSession();
  const cleanups = [];
  let destroyed = false;
  let preview = null;
  let pollStatus = 'connecting';
  let presence = null;
  let lastSnapshot = null;
  let expiredShown = false;

  const request = (path, options) => api(path, options);
  const layout = h('div', { class: 'chat-layout' });

  const dot = h('div', { style: { width: '7px', height: '7px', borderRadius: '50%', flexShrink: '0', marginLeft: '8px', alignSelf: 'center' } });
  const seen = h('span', { style: { fontSize: '0.7rem', color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', letterSpacing: '0.05em', marginLeft: '8px' } });

  function paintPresence() {
    const state = presenceState(pollStatus, presence);
    dot.style.background = TONES[state.tone];
    dot.title = state.label;
    dot.dataset.tone = state.tone;
    const last = presence && presence.other_last_seen;
    seen.textContent = state.tone !== 'together' && last ? formatSearchTime(last) : '';
  }

  const expire = () => {
    if (expiredShown || destroyed) return;
    expiredShown = true;
    layout.append(h('div', { style: { position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: '12px' } },
      h('div', { style: { width: '12px', height: '12px', borderRadius: '50%', background: 'var(--danger)', boxShadow: '0 0 16px var(--danger)' } }),
      h('p', { style: { color: 'var(--text-primary)', fontFamily: 'var(--font-mono)', fontSize: '0.85rem', letterSpacing: '0.1em' } }, 'SESSION EXPIRED, RETURNING')));
    setTimeout(() => exit(), 2000);
  };

  const onError = (error) => {
    if (error && error.status === 401) expire();
  };

  const ctx = {
    identity: () => session.identity,
    nonce: () => sessionStorage.getItem('session_nonce'),
    request: (path, options) => request(path, options).catch((error) => { onError(error); throw error; }),
    apply: (message) => feed.apply(message),
    patch: (id, updater) => feed.patch(id, updater),
    onReply: (message) => composer.replyTo(message),
    onQuote: (id) => jumpTo({ id }, '', true),
    onPreview: (attachment) => showPreview(attachment),
    onError,
  };

  const jumpButton = h('button', { class: 'touch-target', hidden: true, onClick: () => toLatest(),
    style: { position: 'fixed', bottom: '90px', right: '24px', zIndex: 1000, background: 'var(--bg-panel)', border: '1px solid var(--border-glass)', borderRadius: '50%', width: '48px', height: '48px', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 4px 12px rgba(0,0,0,0.5)' } },
    icon(24, [['polyline', { points: '6 9 12 15 18 9' }]], { stroke: 'var(--accent-tron)' }));
  let scrolledAway = false;
  const syncJump = () => { jumpButton.hidden = !(scrolledAway || (lastSnapshot && lastSnapshot.context)); };

  const contextBar = h('div', { class: 'context-banner', hidden: true },
    h('span', null, 'Viewing earlier messages'),
    h('button', { class: 'context-banner__action', onClick: () => toLatest() }, 'Back to latest'));

  const list = createMessageList({
    ctx,
    onLoadOlder: async () => {
      const before = lastSnapshot ? lastSnapshot.messages.length : 0;
      pendingOlder = true;
      let count = 0;
      try {
        count = await feed.loadOlder();
      } catch (error) {
        onError(error);
      } finally {
        pendingOlder = false;
      }
      if (lastSnapshot && count > 0) list.setMessages(lastSnapshot.messages, { prepended: lastSnapshot.messages.length - before });
    },
    onScrollStatus: (away) => { scrolledAway = away; syncJump(); },
  });

  let pendingOlder = false;
  const feed = createFeed({
    request,
    onChange: (snapshot) => {
      const wasContext = lastSnapshot ? lastSnapshot.context : false;
      const first = lastSnapshot === null;
      lastSnapshot = snapshot;
      contextBar.hidden = !snapshot.context;
      if (first || wasContext !== snapshot.context) list.reset(snapshot.messages);
      else if (!pendingOlder) list.setMessages(snapshot.messages);
      syncJump();
    },
    onStatus: (status) => { pollStatus = status; paintPresence(); },
    onPresence: (value) => { if (value) presence = value; paintPresence(); },
    onExpired: expire,
  });

  const outbox = createOutbox(() => randomHex(16));
  const composer = createComposer({
    request: ctx.request,
    outbox,
    onError,
    onSend: async (message) => {
      rememberSent(message.id);
      if (lastSnapshot && lastSnapshot.context) await feed.returnToLatest().catch(onError);
      feed.apply(message);
      list.scrollToBottom();
    },
  });

  const search = createSearch({ request: ctx.request, container: layout, onJump: (message, query) => jumpTo(message, query, false) });
  const gallery = createGallery({
    request: ctx.request,
    onJump: (message) => { gallery.close(); jumpTo(message, '', true); },
    onPreview: (attachment) => showPreview(attachment),
  });

  async function jumpTo(message, term, flash) {
    if (list.jump(message.id, { term, flash })) return;
    try {
      await feed.openContext(message.id);
      setTimeout(() => list.jump(message.id, { term, flash }), 0);
    } catch (error) {
      onError(error);
    }
  }

  async function toLatest() {
    if (lastSnapshot && lastSnapshot.context) {
      try {
        await feed.returnToLatest();
      } catch (error) {
        onError(error);
        return;
      }
    }
    list.scrollToBottom();
  }

  function showPreview(attachment) {
    if (preview) preview.close();
    preview = openPreview(attachment, { container: layout, onClose: () => { preview = null; } });
  }

  const header = h('header', { class: 'chat-header' },
    h('div', { class: 'header-left' }, h('h1', null, 'The Bunker'), dot, seen),
    h('div', { class: 'header-right' },
      search.button,
      h('button', { class: 'touch-target gallery-toggle', onClick: () => gallery.toggle() },
        icon(20, [['rect', { x: 3, y: 3, width: 18, height: 18, rx: 2, ry: 2 }], ['circle', { cx: 8.5, cy: 8.5, r: 1.5 }], ['polyline', { points: '21 15 16 10 5 21' }]])),
      h('button', { class: 'touch-target exit-action', onClick: () => exit() },
        icon(20, [['path', { d: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4' }], ['polyline', { points: '16 17 21 12 16 7' }], ['line', { x1: 21, y1: 12, x2: 9, y2: 12 }]], { stroke: 'var(--danger)' }))));

  layout.append(h('main', { class: 'chat-main' }, header, contextBar, list.node, jumpButton, composer.node), gallery.node);
  root.replaceChildren(layout);
  paintPresence();

  // Hiding the page leaves the chat at once: the chat is torn down, the session
  // cleared and the dashboard shown, so returning to the tab never reopens it.
  const onVisibility = () => {
    if (document.visibilityState === 'hidden') exit();
  };
  document.addEventListener('visibilitychange', onVisibility);
  cleanups.push(() => document.removeEventListener('visibilitychange', onVisibility));

  const onPlay = (e) => {
    document.querySelectorAll('video').forEach((v) => { if (v !== e.target && !v.paused) v.pause(); });
  };
  document.addEventListener('play', onPlay, true);
  cleanups.push(() => document.removeEventListener('play', onPlay, true));

  const onClick = (e) => {
    if (!e.target.closest('.search-overlay')) list.clearHighlight();
  };
  document.addEventListener('click', onClick);
  cleanups.push(() => document.removeEventListener('click', onClick));

  feed.start();

  function exit() {
    if (destroyed) return;
    destroy();
    onExit();
  }

  function destroy() {
    destroyed = true;
    feed.stop();
    if (preview) preview.close();
    search.destroy();
    gallery.destroy();
    composer.destroy();
    list.destroy();
    for (const cleanup of cleanups) cleanup();
    releaseAllMedia();
    root.replaceChildren();
  }

  return { destroy, exit };
}
