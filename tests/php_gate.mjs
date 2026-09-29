import { randomBytes, createHash } from 'node:crypto';
import { existsSync, readdirSync, mkdtempSync, mkdirSync, copyFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { startSite, dateKeys } from './support/site.mjs';

const ZONE = 'Asia/Dubai';
let passed = 0;
const failures = [];

function check(name, condition, detail = '') {
  if (condition) passed++;
  else failures.push(`${name}${detail ? `: ${detail}` : ''}`);
}

const site = await startSite();
const fingerprint = (seed) => createHash('sha256').update(seed).digest('hex');
const clientId = () => randomBytes(16).toString('hex');

async function call(path, { method = 'GET', session, body, ip = '10.0.0.1', raw = false } = {}) {
  const headers = { 'X-Gate-Remote-Addr': ip };
  if (session) {
    headers.Authorization = `Bearer ${session.token}`;
    headers['X-Fingerprint'] = session.fingerprint;
  }
  let payload = body;
  if (body && !(body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch(site.base + path, { method, headers, body: payload });
  if (raw) return res;
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { status: res.status, json, text, headers: res.headers };
}

async function login(code, seed, ip) {
  const fp = fingerprint(seed);
  const res = await call('/api/auth.php', { method: 'POST', body: { passcode: code, timezone: ZONE, fingerprint: fp }, ip });
  return { res, session: res.json && res.json.token ? { token: res.json.token, fingerprint: fp, nonce: res.json.nonce, identity: res.json.identity } : null };
}

try {
  const keys = dateKeys(ZONE);

  const a = await login(keys.alpha, 'alpha-browser', '10.0.0.1');
  check('alpha key enters as user-a', a.res.status === 200 && a.session?.identity === 'user-a', a.res.text);
  const b = await login(keys.bravo, 'bravo-browser', '10.0.0.2');
  check('bravo key enters as user-b', b.res.status === 200 && b.session?.identity === 'user-b', b.res.text);
  check('nonce is 64 hex', /^[0-9a-f]{64}$/.test(a.session?.nonce || ''));
  const A = a.session;
  const B = b.session;

  const badFp = await call('/api/auth.php', { method: 'POST', body: { passcode: keys.alpha, timezone: ZONE, fingerprint: 'nope' }, ip: '10.0.0.9' });
  check('malformed fingerprint refused', badFp.status === 400);
  const noToken = await call('/api/messages.php?initial=1');
  check('missing token refused', noToken.status === 401);
  const forged = await call('/api/messages.php?initial=1', { session: { token: 'f'.repeat(64), fingerprint: A.fingerprint } });
  check('forged token refused', forged.status === 401);
  const wrongFp = await call('/api/messages.php?initial=1', { session: { token: A.token, fingerprint: fingerprint('other') } });
  check('token bound to its fingerprint', wrongFp.status === 401);

  const lockIp = '10.9.9.9';
  const first = await login('11111111', 'x', lockIp);
  const second = await login('22222222', 'x', lockIp);
  const third = await login('33333333', 'x', lockIp);
  check('first wrong key is 401', first.res.status === 401);
  check('second wrong key is 401', second.res.status === 401);
  check('third wrong key locks', third.res.status === 423);
  const whileLocked = await login(keys.alpha, 'x', lockIp);
  check('correct key refused while locked', whileLocked.res.status === 423);
  const hash = site.ipHash(lockIp);
  check('one row per address', site.sql(`SELECT COUNT(*) FROM users_meta WHERE ip_address='${hash}'`) === '1');
  site.sql(`UPDATE users_meta SET locked_until = UTC_TIMESTAMP() - INTERVAL 1 MINUTE WHERE ip_address='${hash}'`);
  const afterExpiry = await login('44444444', 'x', lockIp);
  check('expired lock resets the count', afterExpiry.res.status === 401);
  const unlocked = await login(keys.alpha, 'x', lockIp);
  check('entry works after the lock expires', unlocked.res.status === 200);
  site.sql(`UPDATE users_meta SET failed_attempts = 2, last_attempt = UTC_TIMESTAMP() - INTERVAL 2 DAY WHERE ip_address='${hash}'`);
  const stale = await login('55555555', 'x', lockIp);
  check('a day-old count does not carry over', stale.res.status === 401);
  const dupIp = '10.8.8.8';
  const dupHash = site.ipHash(dupIp);
  site.sql(`INSERT INTO users_meta (ip_address, failed_attempts, last_attempt) VALUES ('${dupHash}', 0, UTC_TIMESTAMP()), ('${dupHash}', 0, UTC_TIMESTAMP())`);
  for (const code of ['1', '2']) await login(code.repeat(8), 'x', dupIp);
  const dupThird = await login('99999999', 'x', dupIp);
  check('lockout holds with duplicate legacy rows', dupThird.res.status === 423);

  const empty = await call('/api/messages.php?initial=1', { session: A });
  check('initial on empty history', empty.status === 200 && empty.json.messages.length === 0 && empty.json.cursor === 0, empty.text);
  check('presence present on initial', empty.json && 'presence' in empty.json);

  const cid = clientId();
  const sent = await call('/api/messages.php', { method: 'POST', session: A, body: { message_body: 'hello from alpha', client_id: cid, session_nonce: A.nonce } });
  check('send stores a message', sent.status === 201 && sent.json.sender_identity === 'user-a', sent.text);
  const again = await call('/api/messages.php', { method: 'POST', session: A, body: { message_body: 'hello from alpha', client_id: cid, session_nonce: A.nonce } });
  check('repeated request returns the same message', again.status === 200 && again.json.id === sent.json.id, again.text);
  check('repeated request stores one row', site.sql('SELECT COUNT(*) FROM messages') === '1');
  const sameIdOther = await call('/api/messages.php', { method: 'POST', session: B, body: { message_body: 'bravo', client_id: cid } });
  check('request ids are per identity', sameIdOther.status === 201 && sameIdOther.json.id !== sent.json.id);
  const spoof = await call('/api/messages.php', { method: 'POST', session: B, body: { message_body: 'spoof', client_id: clientId(), sender_identity: 'user-a' } });
  check('sender comes from the token', spoof.json?.sender_identity === 'user-b');

  const noBody = await call('/api/messages.php', { method: 'POST', session: A, body: { message_body: '   ', client_id: clientId() } });
  check('empty message without attachments refused', noBody.status === 400 && noBody.json.error === 'empty_body');
  const noClient = await call('/api/messages.php', { method: 'POST', session: A, body: { message_body: 'x' } });
  check('request id required', noClient.status === 400);
  const badReply = await call('/api/messages.php', { method: 'POST', session: A, body: { message_body: 'x', client_id: clientId(), reply_to_id: 999999 } });
  check('reply to a missing message refused', badReply.status === 400 && badReply.json.error === 'invalid_reply');
  const tooLong = await call('/api/messages.php', { method: 'POST', session: A, body: { message_body: 'x'.repeat(60001), client_id: clientId() } });
  check('over-long message refused', tooLong.status === 400);

  const bFeed = await call('/api/messages.php?after=0', { session: B });
  check('feed from zero delivers every message', bFeed.status === 200 && bFeed.json.messages.length === 3, bFeed.text);
  let bCursor = bFeed.json.cursor;
  check('feed cursor advances', bCursor >= 3);

  const concurrent = [];
  for (let i = 0; i < 20; i++) {
    concurrent.push(call('/api/messages.php', { method: 'POST', session: A, body: { message_body: `a${i}`, client_id: clientId(), session_nonce: A.nonce } }));
    concurrent.push(call('/api/messages.php', { method: 'POST', session: B, body: { message_body: `b${i}`, client_id: clientId(), session_nonce: B.nonce } }));
  }
  const seen = new Map();
  let pollCursor = bCursor;
  let polling = true;
  const poller = (async () => {
    while (polling) {
      const r = await call(`/api/messages.php?after=${pollCursor}`, { session: B });
      if (r.status === 200) {
        for (const m of r.json.messages) seen.set(m.id, (seen.get(m.id) || 0) + 1);
        pollCursor = r.json.cursor;
      }
    }
  })();
  const results = await Promise.all(concurrent);
  polling = false;
  await poller;
  const drain = await call(`/api/messages.php?after=${pollCursor}`, { session: B });
  for (const m of drain.json.messages) seen.set(m.id, (seen.get(m.id) || 0) + 1);
  const newIds = results.map((r) => r.json?.id);
  check('forty concurrent sends stored', results.every((r) => r.status === 201), results.map((r) => r.status).join(','));
  check('a concurrent poller sees every send', newIds.every((id) => seen.has(id)), `${newIds.filter((id) => !seen.has(id)).length} missed`);
  const events = site.sql('SELECT id, message_id FROM message_events ORDER BY id').split('\n').map((l) => l.split('\t').map(Number));
  check('event ids are unique and increasing', events.every((e, i) => i === 0 || e[0] > events[i - 1][0]));
  const perMessage = site.sql('SELECT COUNT(*) FROM message_events').trim();
  check('one event per new message', Number(perMessage) === 43, perMessage);

  const page = await call(`/api/messages.php?after=${bCursor}`, { session: B });
  check('feed returns messages in id order', page.json.messages.every((m, i, all) => i === 0 || m.id > all[i - 1].id));

  const target = sent.json.id;
  const reactB = await call('/api/reactions.php', { method: 'POST', session: B, body: { message_id: target, emoji: '👍', sender_identity: 'user-a' } });
  check('reaction added', reactB.status === 200 && reactB.json.action === 'added', reactB.text);
  check('reaction identity comes from the token', reactB.json?.message.reactions.some((r) => r.identity === 'user-b' && r.emoji === '👍'));
  const aCursorStart = drain.json.cursor;
  const aFeed = await call(`/api/messages.php?after=${aCursorStart}`, { session: A });
  check('reaction reaches the other identity', aFeed.json.messages.some((m) => m.id === target && m.reactions.length === 1), aFeed.text);
  const unreact = await call('/api/reactions.php', { method: 'POST', session: B, body: { message_id: target, emoji: '👍' } });
  check('reaction toggles off', unreact.json?.action === 'removed');
  const aFeed2 = await call(`/api/messages.php?after=${aFeed.json.cursor}`, { session: A });
  check('reaction removal reaches the other identity', aFeed2.json.messages.some((m) => m.id === target && m.reactions.length === 0));
  const badEmoji = await call('/api/reactions.php', { method: 'POST', session: B, body: { message_id: target, emoji: '💀' } });
  check('unknown emoji refused', badEmoji.status === 400);
  const missingMsg = await call('/api/reactions.php', { method: 'POST', session: B, body: { message_id: 999999, emoji: '👍' } });
  check('reaction on a missing message refused', missingMsg.status === 404);

  const parent = await call('/api/messages.php', { method: 'POST', session: A, body: { message_body: 'parent', client_id: clientId(), session_nonce: A.nonce } });
  const child = await call('/api/messages.php', { method: 'POST', session: B, body: { message_body: 'child', client_id: clientId(), session_nonce: B.nonce, reply_to_id: parent.json.id } });
  check('reply carries its quote', child.json?.reply_to_body === 'parent' && child.json?.reply_to_sender === 'user-a');
  const beforeEdit = feedCursorOf(await call(`/api/messages.php?after=0`, { session: B }));
  const edit = await call('/api/messages.php', { method: 'PATCH', session: A, body: { id: parent.json.id, message_body: 'parent edited', session_nonce: A.nonce } });
  check('owner edits within the window', edit.status === 200 && edit.json.message_body === 'parent edited' && edit.json.edited_at);
  const afterEdit = await call(`/api/messages.php?after=${beforeEdit}`, { session: B });
  check('edit reaches the other identity', afterEdit.json.messages.some((m) => m.id === parent.json.id && m.message_body === 'parent edited'));
  check('edit refreshes the reply quote', afterEdit.json.messages.some((m) => m.id === child.json.id && m.reply_to_body === 'parent edited'));
  const otherEdit = await call('/api/messages.php', { method: 'PATCH', session: B, body: { id: parent.json.id, message_body: 'x', session_nonce: B.nonce } });
  check('other identity cannot edit', otherEdit.status === 403);
  const wrongNonce = await call('/api/messages.php', { method: 'PATCH', session: A, body: { id: parent.json.id, message_body: 'x', session_nonce: 'a'.repeat(64) } });
  check('another session cannot edit', wrongNonce.status === 403);
  const emptyEdit = await call('/api/messages.php', { method: 'PATCH', session: A, body: { id: parent.json.id, message_body: ' ', session_nonce: A.nonce } });
  check('edit to empty text refused without attachments', emptyEdit.status === 400);
  const del = await call('/api/messages.php', { method: 'DELETE', session: A, body: { id: parent.json.id, session_nonce: A.nonce } });
  check('owner deletes within the window', del.status === 200 && del.json.is_deleted === 1 && del.json.message_body === '');
  const afterDel = await call(`/api/messages.php?after=${afterEdit.json.cursor}`, { session: B });
  check('deletion marks the reply quote', afterDel.json.messages.some((m) => m.id === child.json.id && m.reply_to_is_deleted === 1 && m.reply_to_body === null));
  const delAgain = await call('/api/messages.php', { method: 'DELETE', session: A, body: { id: parent.json.id, session_nonce: A.nonce } });
  check('second deletion reports conflict', delAgain.status === 409);
  const reactDeleted = await call('/api/reactions.php', { method: 'POST', session: B, body: { message_id: parent.json.id, emoji: '👍' } });
  check('reaction on a deleted message refused', reactDeleted.status === 404);
  const old = await call('/api/messages.php', { method: 'POST', session: A, body: { message_body: 'old', client_id: clientId(), session_nonce: A.nonce } });
  site.sql(`UPDATE messages SET created_at = UTC_TIMESTAMP() - INTERVAL 3 MINUTE WHERE id = ${old.json.id}`);
  const late = await call('/api/messages.php', { method: 'PATCH', session: A, body: { id: old.json.id, message_body: 'late', session_nonce: A.nonce } });
  check('edit window closes after two minutes', late.status === 403 && late.json.error === 'edit_window_expired');

  await call('/api/messages.php', { method: 'POST', session: A, body: { message_body: 'rate 50% off', client_id: clientId() } });
  await call('/api/messages.php', { method: 'POST', session: A, body: { message_body: 'rate 50x off', client_id: clientId() } });
  await call('/api/messages.php', { method: 'POST', session: A, body: { message_body: 'snake_case', client_id: clientId() } });
  const pct = await call(`/api/messages.php?search=${encodeURIComponent('50%')}`, { session: B });
  check('search treats % literally', pct.json.messages.length === 1 && pct.json.messages[0].message_body === 'rate 50% off', pct.text);
  const under = await call(`/api/messages.php?search=${encodeURIComponent('e_c')}`, { session: B });
  check('search treats _ literally', under.json.messages.length === 1);
  const deletedHidden = await call(`/api/messages.php?search=parent`, { session: B });
  check('search skips deleted messages', deletedHidden.json.messages.every((m) => m.is_deleted === 0));
  const blank = await call(`/api/messages.php?search=${encodeURIComponent('  ')}`, { session: B });
  check('blank search returns nothing', blank.status === 200 && blank.json.messages.length === 0);

  const around = await call(`/api/messages.php?around=${parent.json.id}`, { session: B });
  check('context includes the tombstone', around.status === 200 && around.json.messages.some((m) => m.id === parent.json.id && m.is_deleted === 1));
  check('context is contiguous', around.json.messages.every((m, i, all) => i === 0 || m.id > all[i - 1].id));
  const aroundMissing = await call(`/api/messages.php?around=999999`, { session: B });
  check('context for a missing message is 404', aroundMissing.status === 404);

  const one = await call('/api/messages.php?limit=0', { session: B });
  check('limit clamps to at least one', one.json.messages.length === 1);
  const big = await call('/api/messages.php?limit=100000', { session: B });
  check('limit clamps to at most one hundred', big.json.messages.length <= 100 && big.status === 200);
  const olderPage = await call(`/api/messages.php?before=${sent.json.id + 5}&limit=3`, { session: B });
  check('older page is below the cursor', olderPage.json.messages.every((m) => m.id < sent.json.id + 5) && olderPage.json.messages.length === 3);
  const badBefore = await call('/api/messages.php?before=abc', { session: B });
  check('invalid before refused', badBefore.status === 400);
  const badAfter = await call('/api/messages.php?after=-1', { session: B });
  check('invalid cursor refused', badAfter.status === 400);
  const put = await call('/api/messages.php', { method: 'PUT', session: B, body: {} });
  check('unsupported method refused', put.status === 405);

  await call('/api/messages.php?after=0', { session: B });
  const presenceA = await call('/api/messages.php?initial=1', { session: A });
  check('other present when recently polled', presenceA.json.presence.other_age_seconds !== null && presenceA.json.presence.other_age_seconds <= 3, JSON.stringify(presenceA.json.presence));
  site.sql(`UPDATE user_presence SET last_seen = UTC_TIMESTAMP() - INTERVAL 90 SECOND WHERE identity = 'user-b'`);
  const presenceAway = await call('/api/messages.php?initial=1', { session: A });
  check('other away reports its age', presenceAway.json.presence.other_age_seconds >= 90 && presenceAway.json.presence.other_last_seen);

  const png = Buffer.concat([Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex'), randomBytes(2600000)]);
  const init = await call('/api/upload_init.php', { method: 'POST', session: A, body: { filename: 'photo.png', file_size: png.length } });
  check('upload starts with a server chunk count', init.status === 200 && init.json.total_chunks === 3 && init.json.chunk_size === 1048576, init.text);
  const uploadId = init.json.upload_id;
  const chunkForm = (id, index, bytes) => {
    const form = new FormData();
    form.set('upload_id', id);
    form.set('chunk_index', String(index));
    form.set('chunk', new Blob([bytes]), 'chunk.bin');
    return form;
  };
  const traversal = await call('/api/upload_chunk.php', { method: 'POST', session: A, body: chunkForm('../includes', 0, png.subarray(0, 1048576)) });
  check('path segments in upload id refused', traversal.status === 400);
  const past = await call('/api/upload_chunk.php', { method: 'POST', session: A, body: chunkForm(uploadId, 3, png.subarray(0, 10)) });
  check('index past the count refused', past.status === 400);
  const short = await call('/api/upload_chunk.php', { method: 'POST', session: A, body: chunkForm(uploadId, 0, png.subarray(0, 1000)) });
  check('short chunk refused', short.status === 400 && short.json.error === 'chunk_size_mismatch');
  const foreign = await call('/api/upload_chunk.php', { method: 'POST', session: B, body: chunkForm(uploadId, 0, png.subarray(0, 1048576)) });
  check('another identity cannot write the upload', foreign.status === 404);
  for (let i = 0; i < 2; i++) {
    await call('/api/upload_chunk.php', { method: 'POST', session: A, body: chunkForm(uploadId, i, png.subarray(i * 1048576, (i + 1) * 1048576)) });
  }
  const incomplete = await call('/api/upload_complete.php', { method: 'POST', session: A, body: { upload_id: uploadId } });
  check('completion with a missing chunk refused', incomplete.status === 400 && incomplete.json.error === 'missing_chunks');
  await call('/api/upload_chunk.php', { method: 'POST', session: A, body: chunkForm(uploadId, 2, png.subarray(2 * 1048576)) });
  const done = await call('/api/upload_complete.php', { method: 'POST', session: A, body: { upload_id: uploadId, file_size: 5 } });
  check('upload completes with actual size and detected type', done.status === 200 && done.json.file_size === png.length && done.json.mime_type === 'image/png', done.text);
  check('staging directory removed', !existsSync(join(site.root, 'uploads', uploadId)));

  const photoOnly = await call('/api/messages.php', { method: 'POST', session: A, body: { message_body: '', attachment_ids: [done.json.id], client_id: clientId() } });
  check('attachment-only message stored', photoOnly.status === 201 && photoOnly.json.attachments.length === 1 && photoOnly.json.message_body === '', photoOnly.text);
  const reuse = await call('/api/messages.php', { method: 'POST', session: B, body: { message_body: 'steal', attachment_ids: [done.json.id], client_id: clientId() } });
  check('a sent attachment cannot be attached again', reuse.status === 409);
  const media = await call(`/api/media.php?id=${done.json.id}`, { session: B, raw: true });
  const mediaBytes = Buffer.from(await media.arrayBuffer());
  check('media served inline with its type', media.status === 200 && media.headers.get('content-type') === 'image/png' && media.headers.get('content-disposition').startsWith('inline'));
  check('media bytes are intact', mediaBytes.equals(png));
  check('media makes no range claim', media.headers.get('accept-ranges') === null);

  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
  const svgInit = await call('/api/upload_init.php', { method: 'POST', session: B, body: { filename: 'x.svg', file_size: svg.length } });
  await call('/api/upload_chunk.php', { method: 'POST', session: B, body: chunkForm(svgInit.json.upload_id, 0, svg) });
  const svgDone = await call('/api/upload_complete.php', { method: 'POST', session: B, body: { upload_id: svgInit.json.upload_id } });
  check('upload records its uploader', site.sql(`SELECT sender_identity FROM attachment_owners WHERE attachment_id=${svgDone.json.id}`) === 'user-b');
  const svgMedia = await call(`/api/media.php?id=${svgDone.json.id}`, { session: B, raw: true });
  check('svg served as a download', svgMedia.headers.get('content-type') === 'application/octet-stream' && svgMedia.headers.get('content-disposition').startsWith('attachment'));
  const peek = await call(`/api/media.php?id=${svgDone.json.id}`, { session: A });
  check('another identity cannot read a pending attachment', peek.status === 404 && peek.json.error === 'not_found');
  const takeOver = await call('/api/messages.php', { method: 'POST', session: A, body: { message_body: 'mine now', attachment_ids: [svgDone.json.id], client_id: clientId() } });
  check('another identity cannot send a pending attachment', takeOver.status === 409 && takeOver.json.error === 'attachment_unavailable');
  const foreignDiscard = await call(`/api/media.php?id=${svgDone.json.id}`, { method: 'DELETE', session: A });
  check('another identity cannot discard a pending attachment', foreignDiscard.status === 404 && site.sql(`SELECT COUNT(*) FROM attachments WHERE id=${svgDone.json.id}`) === '1');
  const discard = await call(`/api/media.php?id=${svgDone.json.id}`, { method: 'DELETE', session: B });
  check('pending attachment discarded with its owner row', discard.status === 200 && site.sql(`SELECT COUNT(*) FROM attachments WHERE id=${svgDone.json.id}`) === '0' && site.sql(`SELECT COUNT(*) FROM attachment_owners WHERE attachment_id=${svgDone.json.id}`) === '0');
  const discardSent = await call(`/api/media.php?id=${done.json.id}`, { method: 'DELETE', session: A });
  check('a sent attachment cannot be discarded', discardSent.status === 409);

  const php = Buffer.from('<?php echo 1;');
  const phpInit = await call('/api/upload_init.php', { method: 'POST', session: A, body: { filename: 'shell.php', file_size: php.length } });
  await call('/api/upload_chunk.php', { method: 'POST', session: A, body: chunkForm(phpInit.json.upload_id, 0, php) });
  const phpDone = await call('/api/upload_complete.php', { method: 'POST', session: A, body: { upload_id: phpInit.json.upload_id } });
  check('blocked extension refused', phpDone.status === 415);
  const cancelInit = await call('/api/upload_init.php', { method: 'POST', session: A, body: { filename: 'c.bin', file_size: 10 } });
  const cancel = await call('/api/upload_init.php', { method: 'DELETE', session: A, body: { upload_id: cancelInit.json.upload_id } });
  check('upload cancel removes staging', cancel.status === 200 && !existsSync(join(site.root, 'uploads', cancelInit.json.upload_id)));
  const badSize = await call('/api/upload_init.php', { method: 'POST', session: A, body: { filename: 'x', file_size: '10' } });
  check('non-integer size refused', badSize.status === 400);

  const delPhoto = await call('/api/messages.php', { method: 'DELETE', session: A, body: { id: photoOnly.json.id, session_nonce: A.nonce } });
  check('deleting a message with media is refused without the nonce', delPhoto.status === 403);
  const leftover = readdirSync(join(site.root, 'uploads')).filter((n) => n !== '.htaccess' && n !== '.gitkeep');
  check('only the stored photo remains in uploads', leftover.length === 1, leftover.join(','));

  const gallery = await call('/api/messages.php?media_only=1', { session: B });
  check('gallery lists messages with media only', gallery.status === 200 && gallery.json.messages.length === 1 && gallery.json.messages[0].id === photoOnly.json.id);

  const port = await call(`/api/link_preview.php?url=${encodeURIComponent('https://example.com:8080/')}`, { session: A });
  check('link preview refuses other ports', port.status === 400);
  const creds = await call(`/api/link_preview.php?url=${encodeURIComponent('https://user:pw@example.com/')}`, { session: A });
  check('link preview refuses credentials', creds.status === 400);
  const internal = await call(`/api/link_preview.php?url=${encodeURIComponent('http://127.0.0.1/')}`, { session: A });
  check('link preview refuses private addresses', internal.status === 403);
  const noAddress = await call('/api/link_preview.php?url=', { session: A });
  check('link preview refuses an empty address', noAddress.status === 400 && noAddress.json.error === 'invalid_url');

  const previewPhp = (code) => JSON.parse(execFileSync('php', ['-r', `require 'includes/preview.php'; ${code}`], { cwd: site.root, encoding: 'utf8' }));
  const resolved = previewPhp(`echo json_encode([
    resolveLocation('http://example.com/a/b?q=1', 'https://example.com/a/b'),
    resolveLocation('http://example.com/a/b', '//cdn.example.com/x'),
    resolveLocation('https://example.com/a/b', '/root'),
    resolveLocation('https://example.com/a/b', 'c'),
    resolveLocation('https://example.com/a/b', 'javascript:alert(1)'),
    resolveLocation('https://example.com/', '')
  ]);`);
  check('redirect locations resolve against the page', JSON.stringify(resolved) === JSON.stringify(['https://example.com/a/b', 'http://cdn.example.com/x', 'https://example.com/root', 'https://example.com/a/c', null, null]), JSON.stringify(resolved));
  const refusal = previewPhp(`try { previewTarget('https://localhost/'); echo json_encode('allowed'); } catch (ApiFailure $e) { echo json_encode($e->status); }`);
  check('a redirect to a private host is refused by the same check', refusal === 403);
  const fields = previewPhp(`echo json_encode(previewFields('<title>Plain</title><meta content="Shown" property="og:title"><meta name="description" content="Words"><meta property="og:image" content="http://x/i.png">', 'host.example'));`);
  check('preview fields prefer Open Graph and keep only an https image', fields.title === 'Shown' && fields.description === 'Words' && fields.image === '', JSON.stringify(fields));
  check('preview title falls back to the host', previewPhp(`echo json_encode(previewFields('', 'host.example'));`).title === 'host.example');

  const configDir = mkdtempSync(join(tmpdir(), 'mirage-config-'));
  mkdirSync(join(configDir, 'api'));
  copyFileSync(join(site.root, 'api', 'config.php'), join(configDir, 'api', 'config.php'));
  const loadConfig = (env) => {
    writeFileSync(join(configDir, '.env'), env);
    return execFileSync('php', ['-r', `try { require 'api/config.php'; echo json_encode(DB_PASS); } catch (RuntimeException $e) { echo json_encode('refused'); }`], { cwd: configDir, encoding: 'utf8' });
  };
  check('a required value of 0 is accepted', JSON.parse(loadConfig('DB_HOST=h\nDB_USER=u\nDB_PASS=0\nDB_NAME=n\nTOKEN_SALT=s\n')) === '0');
  check('an empty required value stops the request', JSON.parse(loadConfig('DB_HOST=h\nDB_USER=u\nDB_PASS=\nDB_NAME=n\nTOKEN_SALT=s\n')) === 'refused');
  rmSync(configDir, { recursive: true, force: true });
} catch (error) {
  failures.push(`gate crashed: ${error.stack}`);
} finally {
  await site.stop();
}

function feedCursorOf(res) {
  return res.json.cursor;
}

for (const failure of failures) console.log(`FAIL ${failure}`);
console.log(`php gate: ${passed} passed, ${failures.length} failed`);
process.exit(failures.length ? 1 : 0);
