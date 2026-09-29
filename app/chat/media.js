import { apiRaw, ApiError } from '../lib/api.js';
import { h } from '../lib/dom.js';

const RELEASE_DELAY_MS = 30000;
// A thumbnail needs the whole video downloaded, so larger videos show a plain
// frame until opened.
export const THUMBNAIL_VIDEO_MAX_BYTES = 25 * 1024 * 1024;
const entries = new Map();

async function download(id, onProgress) {
  const res = await apiRaw(`/api/media.php?id=${id}`);
  if (!res.ok) throw new ApiError(res.status, null);
  const type = res.headers.get('Content-Type') || 'application/octet-stream';
  const total = parseInt(res.headers.get('Content-Length') || '0', 10);
  if (!res.body || !onProgress) return new Blob([await res.arrayBuffer()], { type });
  const reader = res.body.getReader();
  const chunks = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    if (total > 0) onProgress(Math.round((received / total) * 100));
  }
  return new Blob(chunks, { type });
}

/**
 * Leases an attachment as an object URL.
 *
 * Media requests need the Authorization header, which img and video elements
 * cannot send, so each file is fetched into a blob. Leases count the users of
 * each blob; its URL is revoked 30 seconds after the last release, so scrolling
 * back to a message reuses the download. A failed download is forgotten, and
 * the next lease tries again.
 *
 * @param {number} id Attachment ID.
 * @param {{onProgress?: (percent: number) => void}} [options] Progress applies
 *   only to the request that starts the download.
 * @returns {{ready: Promise<{url: string, blob: Blob}>, release: () => void}}
 */
export function acquireMedia(id, { onProgress } = {}) {
  let entry = entries.get(id);
  if (!entry) {
    entry = { refs: 0, timer: null, url: null, blob: null };
    entry.promise = download(id, onProgress).then((blob) => {
      entry.blob = blob;
      entry.url = URL.createObjectURL(blob);
      return entry;
    });
    entry.promise.catch(() => entries.delete(id));
    entries.set(id, entry);
  }
  entry.refs += 1;
  if (entry.timer) {
    clearTimeout(entry.timer);
    entry.timer = null;
  }
  let released = false;
  return {
    ready: entry.promise,
    release() {
      if (released) return;
      released = true;
      entry.refs -= 1;
      if (entry.refs > 0) return;
      entry.timer = setTimeout(() => {
        if (entry.refs > 0) return;
        if (entry.url) URL.revokeObjectURL(entry.url);
        entries.delete(id);
      }, RELEASE_DELAY_MS);
    },
  };
}

/** Revokes every object URL, so no media remains reachable after the chat closes. */
export function releaseAllMedia() {
  for (const entry of entries.values()) {
    if (entry.timer) clearTimeout(entry.timer);
    if (entry.url) URL.revokeObjectURL(entry.url);
  }
  entries.clear();
}

export function mediaKind(mime, name = '') {
  const type = (mime || '').toLowerCase();
  const lower = (name || '').toLowerCase();
  // SVG can carry script and the server only ever sends it as a download.
  if (type === 'image/svg+xml') return 'file';
  if (type.startsWith('image/')) return 'image';
  if (type.startsWith('video/')) return 'video';
  if (type.startsWith('audio/')) return 'audio';
  if (type === 'application/pdf' || lower.endsWith('.pdf')) return 'pdf';
  if (lower.endsWith('.md')) return 'markdown';
  if (['text/plain', 'application/json', 'text/javascript', 'text/css', 'text/csv'].includes(type)) return 'text';
  return 'file';
}

/**
 * A muted, inert video element showing an early frame. The #t=0.1 fragment
 * (https://www.w3.org/TR/media-frags/#naming-time) starts the media just past
 * zero, which makes browsers that leave a metadata-only video blank paint a frame.
 */
export function videoThumbnail(url, style = {}) {
  return h('video', { src: `${url}#t=0.1`, preload: 'metadata', muted: true, playsInline: true, tabIndex: -1, 'aria-hidden': 'true', style: { objectFit: 'cover', pointerEvents: 'none', ...style } });
}
