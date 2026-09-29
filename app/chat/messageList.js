import { h } from '../lib/dom.js';
import { createBubble } from './bubble.js';

// At most 100 messages are in the DOM at once. Sentinels at either end slide the
// window by 30, and reaching the top of what is loaded asks for an older page.
const WINDOW = 100;
const STEP = 30;
const PREPEND_SHOW = 20;

export function createMessageList({ ctx, onLoadOlder, onScrollStatus }) {
  const top = h('div', { style: { height: '1px' } });
  const bottom = h('div', { style: { height: '1px', overflowAnchor: 'auto' } });
  const list = h('div', { class: 'message-list' }, top, bottom);
  const bubbles = new Map();

  let messages = [];
  let winStart = 0;
  let anchorId = null;
  let pinned = true;
  let prependHeight = null;
  let highlight = { id: null, term: '' };
  let scrollTimer = null;
  let loadingOlder = false;

  const indexOf = (id) => messages.findIndex((m) => m.id === id);
  const maxStart = () => Math.max(0, messages.length - WINDOW);

  const fromBottom = () => list.scrollHeight - list.scrollTop - list.clientHeight;

  function reportScroll() {
    onScrollStatus(fromBottom() > 150 || winStart + WINDOW < messages.length);
  }

  function paint() {
    winStart = Math.max(0, Math.min(winStart, maxStart()));
    const visible = messages.slice(winStart, winStart + WINDOW);
    anchorId = visible.length ? visible[0].id : null;
    const keep = new Set(visible.map((m) => m.id));
    for (const [id, bubble] of bubbles) {
      if (!keep.has(id)) {
        bubble.destroy();
        bubble.node.remove();
        bubbles.delete(id);
      }
    }
    let ref = top.nextSibling;
    for (const message of visible) {
      let bubble = bubbles.get(message.id);
      if (!bubble) {
        bubble = createBubble(message, ctx);
        bubbles.set(message.id, bubble);
      } else {
        bubble.update(message);
      }
      bubble.setHighlight(highlight.id === message.id ? highlight.term : '');
      if (bubble.node === ref) {
        ref = ref.nextSibling;
      } else {
        list.insertBefore(bubble.node, ref);
      }
    }
    while (ref && ref !== bottom) {
      const next = ref.nextSibling;
      ref.remove();
      ref = next;
    }
    // Content added above moves the scroll position down by its own height, so
    // the message being read stays where it was.
    if (prependHeight !== null) {
      list.scrollTop += list.scrollHeight - prependHeight;
      prependHeight = null;
    } else if (pinned) {
      list.scrollTop = list.scrollHeight;
    }
  }

  const resize = new ResizeObserver(() => {
    if (pinned) list.scrollTop = list.scrollHeight;
  });
  resize.observe(list);

  // Whether the reader is at the bottom is recorded on every scroll event. A
  // repaint during a scroll, from a poll or from reaching the top, must see
  // where the reader is now, or it snaps the list back to the newest message.
  list.addEventListener('scroll', () => {
    pinned = fromBottom() < 80;
    clearTimeout(scrollTimer);
    scrollTimer = setTimeout(reportScroll, 80);
  }, { passive: true });

  const sentinels = new IntersectionObserver(async (entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      if (entry.target === top) {
        if (winStart === 0) {
          if (loadingOlder) continue;
          loadingOlder = true;
          try {
            await onLoadOlder();
          } finally {
            loadingOlder = false;
          }
        } else {
          prependHeight = list.scrollHeight;
          winStart = Math.max(0, winStart - STEP);
          paint();
        }
      } else if (entry.target === bottom && winStart < maxStart()) {
        winStart = Math.min(maxStart(), winStart + STEP);
        paint();
      }
    }
  }, { root: list, threshold: 0.1 });
  sentinels.observe(top);
  sentinels.observe(bottom);

  return {
    node: list,
    setMessages(next, { prepended = 0 } = {}) {
      const grew = next.length > messages.length;
      messages = next;
      if (prepended > 0) {
        const anchor = anchorId !== null ? indexOf(anchorId) : prepended;
        prependHeight = list.scrollHeight;
        winStart = Math.max(0, anchor - Math.min(prepended, PREPEND_SHOW));
      } else if (grew && pinned) {
        winStart = maxStart();
      } else if (anchorId !== null && indexOf(anchorId) !== -1) {
        winStart = indexOf(anchorId);
      }
      paint();
    },
    reset(next) {
      messages = next;
      pinned = true;
      winStart = maxStart();
      paint();
      list.scrollTop = list.scrollHeight;
    },
    jump(id, { term = '', flash = false } = {}) {
      const index = indexOf(id);
      if (index === -1) return false;
      pinned = false;
      if (term) highlight = { id, term };
      winStart = Math.max(0, index - Math.floor(WINDOW / 2));
      paint();
      setTimeout(() => {
        const bubble = bubbles.get(id);
        if (!bubble) return;
        bubble.node.scrollIntoView({ behavior: 'smooth', block: 'center' });
        if (flash) bubble.flash();
      }, 50);
      return true;
    },
    clearHighlight() {
      if (highlight.id === null) return;
      highlight = { id: null, term: '' };
      paint();
    },
    scrollToBottom() {
      pinned = true;
      winStart = maxStart();
      paint();
      list.scrollTop = list.scrollHeight;
    },
    destroy() {
      clearTimeout(scrollTimer);
      sentinels.disconnect();
      resize.disconnect();
      for (const bubble of bubbles.values()) bubble.destroy();
      bubbles.clear();
    },
  };
}
