import { h, s, icon, replace } from '../lib/dom.js';
import { renderDocument } from '../lib/markdown.js';
import { acquireMedia, mediaKind } from './media.js';

function fileIcon(kind, name) {
  const lower = (name || '').toLowerCase();
  if (kind === 'image') return '🖼️';
  if (kind === 'video') return '🎬';
  if (kind === 'audio') return '🎵';
  if (kind === 'pdf') return '📄';
  if (lower.endsWith('.md')) return '📝';
  if (lower.endsWith('.zip') || lower.endsWith('.rar')) return '📦';
  return '📎';
}

function spinner() {
  return h('div', { class: 'up-loading' }, h('div', { class: 'up-spinner' }));
}

function imageView(url, filename) {
  let scale = 1;
  const img = h('img', { src: url, alt: filename, class: 'up-image', draggable: false });
  const label = h('span', { style: { fontSize: '0.75rem', minWidth: '3.5ch', textAlign: 'center' } }, '100%');
  const setScale = (value) => {
    scale = Math.min(10, Math.max(0.1, value));
    img.style.transform = `scale(${scale})`;
    label.textContent = `${Math.round(scale * 100)}%`;
  };
  let hideTimer = null;
  const controls = h('div', { class: 'up-image-controls' },
    h('button', { class: 'up-ctrl-btn', title: 'Zoom out', onClick: () => setScale(scale - 0.25) }, s('svg', { viewBox: '0 0 24 24', width: 15, height: 15, fill: 'currentColor' }, s('path', { d: 'M19 13H5v-2h14v2z' }))),
    label,
    h('button', { class: 'up-ctrl-btn', title: 'Zoom in', onClick: () => setScale(scale + 0.25) }, s('svg', { viewBox: '0 0 24 24', width: 15, height: 15, fill: 'currentColor' }, s('path', { d: 'M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z' }))),
    h('div', { class: 'up-ctrl-divider' }),
    h('button', { class: 'up-ctrl-btn', title: 'Reset', onClick: () => setScale(1) }, icon(15, [['path', { d: 'M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8' }], ['path', { d: 'M3 3v5h5' }]])));
  const show = () => {
    controls.style.opacity = '1';
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => { controls.style.opacity = '0'; }, 2500);
  };
  controls.addEventListener('mouseenter', show);
  controls.addEventListener('mousemove', show);
  show();
  const wrapper = h('div', { class: 'up-image-wrapper' }, img, controls);
  wrapper.addEventListener('wheel', (e) => {
    e.preventDefault();
    setScale(scale - e.deltaY * 0.001);
  }, { passive: false });
  return wrapper;
}

function audioView(url, filename) {
  const bars = Array.from({ length: 20 }, (_, i) => h('div', { class: 'up-viz-bar', style: { animationDelay: `${i * 0.05}s`, animationDuration: `${0.4 + (i % 5) * 0.1}s` } }));
  const setPlaying = (on) => bars.forEach((b) => b.classList.toggle('playing', on));
  const audio = h('audio', { src: url, controls: true, autoplay: true, style: { width: '100%', marginTop: '24px' } });
  audio.addEventListener('play', () => setPlaying(true));
  audio.addEventListener('pause', () => setPlaying(false));
  audio.addEventListener('ended', () => setPlaying(false));
  return h('div', { class: 'up-audio-card' }, h('div', { class: 'up-audio-viz' }, bars), audio, h('p', { class: 'up-audio-name' }, filename));
}

export function openPreview(attachment, { container, onClose }) {
  const filename = attachment.original_name || 'file';
  const kind = mediaKind(attachment.mime_type, filename);
  const previewable = kind !== 'file';
  let lease = null;
  let closed = false;

  const main = h('main', { class: 'up-content' }, spinner());
  const headerRight = h('div', { class: 'up-header-right' });

  const download = async () => {
    if (!lease) lease = acquireMedia(attachment.id);
    try {
      const entry = await lease.ready;
      if (closed) return;
      h('a', { href: entry.url, download: filename }).click();
    } catch {}
  };

  const downloadButton = h('button', { class: 'up-icon-btn', title: 'Download', onClick: download },
    icon(17, [['path', { d: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4' }], ['polyline', { points: '7 10 12 15 17 10' }], ['line', { x1: 12, y1: 15, x2: 12, y2: 3 }]]));
  headerRight.append(downloadButton,
    h('button', { class: 'up-icon-btn up-close-btn', title: 'Close', onClick: () => close() },
      icon(17, [['line', { x1: 18, y1: 6, x2: 6, y2: 18 }], ['line', { x1: 6, y1: 6, x2: 18, y2: 18 }]], { 'stroke-width': 2.5 })));

  const overlay = h('div', { class: 'up-overlay', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'File preview', onClick: () => close() },
    h('div', { class: 'up-window', onClick: (e) => e.stopPropagation() },
      h('header', { class: 'up-header' },
        h('div', { class: 'up-header-left' },
          h('span', { class: 'up-file-icon', 'aria-hidden': 'true' }, fileIcon(kind, filename)),
          h('span', { class: 'up-filename', title: filename }, filename)),
        headerRight),
      main));

  function close() {
    if (closed) return;
    closed = true;
    overlay.remove();
    if (lease) lease.release();
    onClose();
  }

  if (!previewable) {
    replace(main, h('div', { class: 'up-unsupported' },
      icon(60, [['path', { d: 'M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z' }], ['polyline', { points: '13 2 13 9 20 9' }]], { 'stroke-width': 1 }),
      h('p', null, 'No preview for this file type.'),
      h('button', { class: 'up-download-btn', onClick: download }, `Download ${filename}`)));
  } else {
    const track = h('div', { class: 'up-progress-fill', style: { width: '0%' } });
    const percent = h('span', null, '0%');
    lease = acquireMedia(attachment.id, {
      onProgress: (p) => {
        if (closed || p >= 100) return;
        replace(main, h('div', { class: 'up-loading' }, h('div', { class: 'up-progress-track' }, track), percent));
        track.style.width = `${p}%`;
        percent.textContent = `${p}%`;
      },
    });
    lease.ready.then(async (entry) => {
      if (closed) return;
      if (kind === 'image') replace(main, imageView(entry.url, filename));
      else if (kind === 'video') replace(main, h('video', { src: entry.url, controls: true, playsInline: true, autoplay: true, class: 'up-video' }));
      else if (kind === 'audio') replace(main, audioView(entry.url, filename));
      else if (kind === 'pdf') replace(main, h('iframe', { src: `${entry.url}#toolbar=0`, class: 'up-pdf', title: filename }));
      else {
        // Text and Markdown files are rendered as text nodes; nothing in a file is parsed as HTML.
        const text = await entry.blob.text();
        if (closed) return;
        replace(main, kind === 'markdown'
          ? h('div', { class: 'up-md-wrapper' }, h('div', { class: 'up-md' }, renderDocument(text)))
          : h('pre', { class: 'up-code' }, text));
      }
    }).catch(() => {
      if (!closed) replace(main, h('div', { class: 'up-error' }, 'Failed to load file.'));
    });
  }

  container.append(overlay);
  return { close };
}
