import { h, icon, replace } from '../lib/dom.js';
import { acquireMedia, mediaKind, videoThumbnail, THUMBNAIL_VIDEO_MAX_BYTES } from './media.js';

const CATEGORIES = ['All', 'Images', 'Videos', 'Documents', 'Others'];
const DOC_EXTS = ['.doc', '.docx', '.pages', '.odt', '.rtf', '.md'];

function category(attachment) {
  const mime = (attachment.mime_type || '').toLowerCase();
  const name = (attachment.original_name || '').toLowerCase();
  const kind = mediaKind(mime, name);
  if (kind === 'image') return 'Images';
  if (kind === 'video') return 'Videos';
  if (mime === 'application/pdf' || mime.startsWith('text/') || DOC_EXTS.some((ext) => name.endsWith(ext))) return 'Documents';
  return 'Others';
}

function truncate(name) {
  if (!name) return '';
  return name.length > 20 ? `${name.substring(0, 17)}...` : name;
}

export function createGallery({ request, onJump, onPreview }) {
  const items = [];
  let filter = 'All';
  let before = null;
  let hasMore = true;
  let loading = false;
  let loadedOnce = false;
  const cards = new Map();

  const grid = h('div', { class: 'inspector-grid' });
  const chips = h('div', { class: 'inspector-filters' });
  const closeBtn = h('button', { class: 'touch-target', onClick: () => setOpen(false) },
    icon(20, [['line', { x1: 18, y1: 6, x2: 6, y2: 18 }], ['line', { x1: 6, y1: 6, x2: 18, y2: 18 }]]));
  const aside = h('aside', { class: 'media-inspector is-closed' },
    h('div', { class: 'inspector-header' }, h('h2', null, 'Media Inspector'), closeBtn), chips, grid);

  const syncClose = () => { closeBtn.style.display = window.innerWidth >= 768 ? 'none' : 'flex'; };
  window.addEventListener('resize', syncClose);
  syncClose();

  function card(item) {
    const key = `${item.message.id}-${item.attachment.id}`;
    if (cards.has(key)) return cards.get(key).node;
    const a = item.attachment;
    const kind = mediaKind(a.mime_type, a.original_name);
    const titleBar = h('div', { style: { position: 'absolute', bottom: 0, left: 0, right: 0, background: 'rgba(0,0,0,0.6)', color: 'white', padding: '4px 8px', fontSize: '0.75rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', backdropFilter: 'blur(4px)' } }, truncate(a.original_name));
    const content = h('div', { class: 'asset-card-content' }, h('div', { class: 'skeleton-asset' }));
    const record = { node: null, lease: null, observer: null };

    const body = () => {
      if (kind === 'image') {
        const img = h('img', { alt: '', loading: 'lazy', style: { width: '100%', height: '100%', objectFit: 'cover' } });
        record.lease = acquireMedia(a.id);
        record.lease.ready.then((entry) => { img.src = entry.url; }).catch(() => {});
        return h('div', { style: { position: 'relative', width: '100%', height: '100%' } }, img, titleBar);
      }
      if (kind === 'video') {
        const frame = h('div', { style: { position: 'relative', width: '100%', height: '100%', background: '#0a0a0a', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '6px' } },
          icon(32, [['path', { d: 'M8 5v14l11-7z' }]], { fill: 'white', stroke: 'none', style: { opacity: 0.85, position: 'relative', zIndex: 1 } }),
          titleBar);
        if ((a.file_size || 0) <= THUMBNAIL_VIDEO_MAX_BYTES) {
          record.lease = acquireMedia(a.id);
          record.lease.ready.then((entry) => {
            frame.prepend(videoThumbnail(entry.url, { position: 'absolute', inset: '0', width: '100%', height: '100%' }));
          }).catch(() => {});
        }
        return frame;
      }
      const ext = (a.original_name || '').split('.').pop().toUpperCase();
      return h('div', { class: 'skeleton-asset', style: { position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-hover)', color: 'var(--text-dim)', height: '100%' } },
        icon(32, [['path', { d: 'M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z' }], ['polyline', { points: '13 2 13 9 20 9' }]], { 'stroke-width': 1.5 }),
        h('span', { style: { fontSize: '0.7rem', marginTop: '4px' } }, ext),
        titleBar);
    };

    content.append(h('div', { class: 'asset-overlay' },
      h('button', { class: 'touch-target', style: { width: '32px', height: '32px', background: 'rgba(255,255,255,0.2)', color: 'white', borderRadius: '4px' }, onClick: (e) => { e.stopPropagation(); onJump(item.message); } },
        icon(16, [['path', { d: 'M15 3h6v6' }], ['path', { d: 'M10 14L21 3' }], ['path', { d: 'M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6' }]]))));
    record.node = h('div', { class: 'asset-card', onClick: () => onPreview(a, item.message) }, content);
    record.observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return;
      record.observer.disconnect();
      content.firstChild.replaceWith(body());
    }, { root: grid, rootMargin: '100px' });
    record.observer.observe(record.node);
    cards.set(key, record);
    return record.node;
  }

  function paint() {
    replace(chips, CATEGORIES.map((cat) => h('button', { class: `filter-chip touch-target${filter === cat ? ' active' : ''}`, onClick: () => { filter = cat; paint(); } }, cat)));
    const shown = items.filter((item) => filter === 'All' || category(item.attachment) === filter);
    replace(grid, shown.map(card));
    if (loadedOnce && !loading && !shown.length && !hasMore) {
      grid.append(h('p', { class: 'search-hint' }, 'No media yet.'));
    }
  }

  async function loadMore() {
    if (loading || !hasMore) return;
    loading = true;
    try {
      const data = await request(`/api/messages.php?media_only=1&limit=50${before ? `&before=${before}` : ''}`);
      for (const message of data.messages) {
        for (const attachment of message.attachments || []) items.push({ message, attachment });
        before = before === null ? message.id : Math.min(before, message.id);
      }
      hasMore = Boolean(data.has_more) && data.messages.length > 0;
      loadedOnce = true;
    } catch {
      hasMore = false;
    } finally {
      loading = false;
      paint();
    }
  }

  grid.addEventListener('scroll', () => {
    if (grid.scrollHeight - grid.scrollTop <= grid.clientHeight + 200) loadMore();
  });

  function reset() {
    for (const record of cards.values()) {
      record.observer.disconnect();
      if (record.lease) record.lease.release();
    }
    cards.clear();
    items.length = 0;
    before = null;
    hasMore = true;
    loadedOnce = false;
  }

  function setOpen(open) {
    const wasOpen = aside.classList.contains('is-open');
    aside.classList.toggle('is-open', open);
    aside.classList.toggle('is-closed', !open);
    if (open && !wasOpen) {
      reset();
      paint();
      loadMore();
    }
  }

  paint();

  return {
    node: aside,
    toggle() { setOpen(!aside.classList.contains('is-open')); },
    close() { setOpen(false); },
    destroy() {
      window.removeEventListener('resize', syncClose);
      reset();
    },
  };
}
