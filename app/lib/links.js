import { api } from './api.js';

// Explicit http(s) and www links anywhere, and bare domains only on a short list
// of common endings, so ordinary words with a full stop are not taken for links.
const urlRegex = /((https?:\/\/|www\.)[^\s]+\.[a-z]{2,63}([^\s]*))|((?:[a-z0-9-]+\.)+(?:com|net|org|io|gov|edu|uk|cc|me)(?:\/[^\s]*)?)/gi;

// Punctuation that ends a sentence after an address is not part of the address.
export const TRAILING_PUNCTUATION = /[.,;:!?)\]}'"]+$/;

/**
 * Addresses in a message, in order and without repeats. An address keeps the
 * scheme it was written with; one written without a scheme is read as HTTPS.
 */
export function extractUrls(text) {
  if (!text) return [];
  const matches = text.match(urlRegex);
  if (!matches) return [];
  return [...new Set(matches.map((m) => {
    const address = m.replace(TRAILING_PUNCTUATION, '');
    return /^https?:\/\//i.test(address) ? address : `https://${address}`;
  }))];
}

/** Removes inline and fenced code, so addresses quoted as code get no preview. */
export function stripCode(text) {
  return (text || '').replace(/```[\s\S]*?```|`[^`]+`/g, '');
}

const previews = new Map();

/** One preview request per address for the life of the page; a failure is kept as no preview. */
export function fetchPreview(url) {
  if (!previews.has(url)) {
    previews.set(url, api(`/api/link_preview.php?url=${encodeURIComponent(url)}`).catch(() => null));
  }
  return previews.get(url);
}

/** The absolute address when it is http or https, otherwise null, so javascript: and data: never become links. */
export function safeHref(url) {
  try {
    const parsed = new URL(url, location.origin);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.href : null;
  } catch {
    return null;
  }
}
