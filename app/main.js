import { mountDashboard } from './dashboard/dashboard.js';
import { mountChat } from './chat/chatPage.js';
import { h } from './lib/dom.js';
import { storeSession, clearSession } from './lib/api.js';

const root = document.getElementById('root');
let current = null;

/**
 * A SHA-256 of the user agent, screen size and colour depth. The token is bound
 * to it, so a token copied to another device fails. The screen sides are sorted
 * so rotating the device does not change it.
 */
async function fingerprint() {
  const dims = [screen.width, screen.height].sort((a, b) => a - b);
  const raw = navigator.userAgent + dims[0] + 'x' + dims[1] + screen.colorDepth;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

async function enter(passcode) {
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const hash = await fingerprint();
  const res = await fetch('/api/auth.php', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ passcode, timezone, fingerprint: hash }),
    cache: 'no-store',
  });
  if (res.status === 423) return 'locked';
  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  if (!res.ok || !data || !data.token || (data.identity !== 'user-a' && data.identity !== 'user-b')) return 'invalid';
  clearSession();
  storeSession({ token: data.token, fingerprint: hash, nonce: data.nonce || '', identity: data.identity, timezone });
  show('chat');
  return 'chat';
}

function show(view) {
  if (current) current.destroy();
  current = null;
  if (view === 'chat') {
    current = mountChat(root, {
      onExit: () => {
        clearSession();
        show('f1');
      },
    });
  } else {
    current = mountDashboard(root, { enter });
  }
}

// The token and date key must never cross the network in clear.
if (location.protocol !== 'https:' && location.hostname !== 'localhost') {
  root.replaceChildren(h('div', { class: 'https-required' }, 'HTTPS REQUIRED'));
} else {
  show('f1');
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}
