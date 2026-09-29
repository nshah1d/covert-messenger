import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFeed, POLL_VISIBLE_MS, POLL_HIDDEN_MS, POLL_MAX_BACKOFF_MS } from '../../app/chat/feed.js';
import { presenceState, PRESENT_WITHIN_SECONDS } from '../../app/chat/presence.js';
import { createOutbox } from '../../app/chat/outbox.js';
import { uploadFile } from '../../app/chat/upload.js';

function fakeTimers() {
  const pending = new Map();
  let next = 1;
  return {
    setTimeout(fn, ms) { const id = next++; pending.set(id, { fn, ms }); return id; },
    clearTimeout(id) { pending.delete(id); },
    delays() { return [...pending.values()].map((t) => t.ms); },
    async fire() {
      const entries = [...pending.entries()];
      pending.clear();
      for (const [, t] of entries) await t.fn();
    },
  };
}

const msg = (id, extra = {}) => ({ id, sender_identity: 'user-a', message_body: `m${id}`, reactions: [], attachments: [], ...extra });
const flush = () => new Promise((r) => setImmediate(r));

function server(routes) {
  const calls = [];
  const request = async (path) => {
    calls.push(path);
    for (const [pattern, reply] of routes) {
      if (pattern.test(path)) {
        const value = typeof reply === 'function' ? reply(path) : reply;
        if (value instanceof Error) throw value;
        return value;
      }
    }
    throw new Error(`unrouted ${path}`);
  };
  return { request, calls };
}

test('initial load then polls from the returned cursor', async () => {
  const timers = fakeTimers();
  const { request, calls } = server([
    [/initial=1/, { messages: [msg(1), msg(2)], cursor: 7, has_older: true, presence: { other_age_seconds: 3 } }],
    [/after=7/, { messages: [msg(3)], cursor: 8, has_more: false, presence: { other_age_seconds: 4 } }],
  ]);
  const seen = [];
  const statuses = [];
  let presence = null;
  const feed = createFeed({ request, timers, onChange: (s) => seen.push(s), onStatus: (s) => statuses.push(s), onPresence: (p) => { presence = p; } });
  feed.start();
  await flush();
  assert.deepEqual(seen.at(-1).messages.map((m) => m.id), [1, 2]);
  assert.equal(seen.at(-1).hasOlder, true);
  assert.deepEqual(timers.delays(), [POLL_VISIBLE_MS]);
  await timers.fire();
  assert.deepEqual(seen.at(-1).messages.map((m) => m.id), [1, 2, 3]);
  assert.equal(calls[1], '/api/messages.php?after=7');
  assert.equal(presence.other_age_seconds, 4);
  assert.deepEqual(statuses.slice(0, 2), ['connecting', 'live']);
});

test('a later version of a message replaces the earlier one', async () => {
  const timers = fakeTimers();
  const { request } = server([
    [/initial=1/, { messages: [msg(1)], cursor: 1 }],
    [/after=1/, { messages: [msg(1, { reactions: [{ emoji: '👍', identity: 'user-b' }] })], cursor: 2 }],
  ]);
  let last;
  const feed = createFeed({ request, timers, onChange: (s) => { last = s; } });
  feed.start();
  await flush();
  await timers.fire();
  assert.equal(last.messages.length, 1);
  assert.equal(last.messages[0].reactions.length, 1);
});

test('has_more drains immediately', async () => {
  const timers = fakeTimers();
  const { request } = server([
    [/initial=1/, { messages: [], cursor: 0 }],
    [/after=0/, { messages: [msg(1)], cursor: 200, has_more: true }],
  ]);
  const feed = createFeed({ request, timers });
  feed.start();
  await flush();
  await timers.fire();
  assert.deepEqual(timers.delays(), [0]);
});

test('polls never overlap', async () => {
  const timers = fakeTimers();
  let resolveSlow;
  let afterCalls = 0;
  const request = async (path) => {
    if (path.includes('initial=1')) return { messages: [], cursor: 0 };
    afterCalls++;
    return new Promise((r) => { resolveSlow = () => r({ messages: [], cursor: 0 }); });
  };
  const feed = createFeed({ request, timers });
  feed.start();
  await flush();
  const firing = timers.fire();
  await flush();
  feed.pollNow();
  feed.setVisible(true);
  await flush();
  assert.equal(afterCalls, 1);
  resolveSlow();
  await firing;
});

test('failures back off and a success restores the cadence', async () => {
  const timers = fakeTimers();
  let fail = true;
  const request = async (path) => {
    if (path.includes('initial=1')) return { messages: [], cursor: 0 };
    if (fail) throw Object.assign(new Error('down'), { status: 500 });
    return { messages: [], cursor: 0 };
  };
  const statuses = [];
  const feed = createFeed({ request, timers, onStatus: (s) => statuses.push(s) });
  feed.start();
  await flush();
  await timers.fire();
  assert.deepEqual(timers.delays(), [POLL_VISIBLE_MS * 2]);
  await timers.fire();
  assert.deepEqual(timers.delays(), [POLL_VISIBLE_MS * 4]);
  for (let i = 0; i < 6; i++) await timers.fire();
  assert.deepEqual(timers.delays(), [POLL_MAX_BACKOFF_MS]);
  assert.equal(statuses.at(-1), 'error');
  fail = false;
  await timers.fire();
  assert.deepEqual(timers.delays(), [POLL_VISIBLE_MS]);
  assert.equal(statuses.at(-1), 'live');
});

test('hidden cadence is slower', async () => {
  const timers = fakeTimers();
  const { request } = server([[/initial=1/, { messages: [], cursor: 0 }], [/after=/, { messages: [], cursor: 0 }]]);
  const feed = createFeed({ request, timers });
  feed.setVisible(false);
  feed.start();
  await flush();
  assert.deepEqual(timers.delays(), [POLL_HIDDEN_MS]);
});

test('an expired token stops polling and reports once', async () => {
  const timers = fakeTimers();
  let expired = 0;
  const request = async (path) => {
    if (path.includes('initial=1')) return { messages: [], cursor: 0 };
    throw Object.assign(new Error('expired'), { status: 401 });
  };
  const feed = createFeed({ request, timers, onExpired: () => { expired++; } });
  feed.start();
  await flush();
  await timers.fire();
  assert.equal(expired, 1);
  assert.deepEqual(timers.delays(), []);
});

test('initial failure retries rather than giving up', async () => {
  const timers = fakeTimers();
  let attempts = 0;
  const request = async () => {
    attempts++;
    if (attempts === 1) throw Object.assign(new Error('down'), { status: 503 });
    return { messages: [msg(1)], cursor: 1 };
  };
  let last;
  const feed = createFeed({ request, timers, onChange: (s) => { last = s; } });
  feed.start();
  await flush();
  assert.equal(timers.delays().length, 1);
  await timers.fire();
  assert.deepEqual(last.messages.map((m) => m.id), [1]);
});

test('context view holds a contiguous slice and flags newer messages', async () => {
  const timers = fakeTimers();
  const { request } = server([
    [/initial=1/, { messages: [msg(100), msg(101)], cursor: 5 }],
    [/around=10/, { messages: [msg(9), msg(10), msg(11)], has_older: true }],
    [/after=5/, { messages: [msg(10, { message_body: 'edited' }), msg(102)], cursor: 7 }],
  ]);
  let last;
  const feed = createFeed({ request, timers, onChange: (s) => { last = s; } });
  feed.start();
  await flush();
  await feed.openContext(10);
  assert.deepEqual(last.messages.map((m) => m.id), [9, 10, 11]);
  assert.equal(last.context, true);
  await timers.fire();
  assert.deepEqual(last.messages.map((m) => m.id), [9, 10, 11]);
  assert.equal(last.messages[1].message_body, 'edited');
  assert.equal(last.newerWaiting, true);
  await feed.returnToLatest();
  assert.deepEqual(last.messages.map((m) => m.id), [100, 101]);
  assert.equal(last.context, false);
});

test('older pages prepend below the oldest id', async () => {
  const timers = fakeTimers();
  const { request, calls } = server([
    [/initial=1/, { messages: [msg(60), msg(61)], cursor: 1, has_older: true }],
    [/before=60/, { messages: [msg(58), msg(59)], has_older: false }],
  ]);
  let last;
  const feed = createFeed({ request, timers, onChange: (s) => { last = s; } });
  feed.start();
  await flush();
  await feed.loadOlder();
  assert.ok(calls.includes('/api/messages.php?before=60&limit=50'));
  assert.deepEqual(last.messages.map((m) => m.id), [58, 59, 60, 61]);
  assert.equal(last.hasOlder, false);
  assert.equal(await feed.loadOlder(), 0);
});

test('apply never moves the cursor', async () => {
  const timers = fakeTimers();
  const { request, calls } = server([
    [/initial=1/, { messages: [msg(1)], cursor: 3 }],
    [/after=3/, { messages: [], cursor: 3 }],
  ]);
  const feed = createFeed({ request, timers });
  feed.start();
  await flush();
  feed.apply(msg(50));
  await timers.fire();
  assert.equal(calls.at(-1), '/api/messages.php?after=3');
  assert.ok(feed.has(50));
});

test('presence states', () => {
  assert.equal(presenceState('connecting', null).tone, 'connecting');
  assert.equal(presenceState('error', { other_age_seconds: 1 }).tone, 'error');
  assert.equal(presenceState('live', { other_age_seconds: null }).tone, 'alone');
  assert.equal(presenceState('live', null).tone, 'alone');
  assert.equal(presenceState('live', { other_age_seconds: PRESENT_WITHIN_SECONDS }).tone, 'together');
  assert.equal(presenceState('live', { other_age_seconds: PRESENT_WITHIN_SECONDS + 1 }).tone, 'alone');
  assert.equal(presenceState('live', { other_age_seconds: 0 }).label, 'Both here');
});

test('outbox reuses the request id only for an unchanged retry', () => {
  let n = 0;
  const outbox = createOutbox(() => `id${++n}`);
  const draft = { body: 'hi', attachmentIds: [2, 1], replyTo: null };
  const first = outbox.requestIdFor(draft);
  assert.equal(outbox.requestIdFor({ body: 'hi', attachmentIds: [1, 2], replyTo: null }), first);
  assert.notEqual(outbox.requestIdFor({ body: 'hi!', attachmentIds: [1, 2], replyTo: null }), first);
  outbox.confirmed();
  assert.equal(outbox.hasPending(), false);
  assert.notEqual(outbox.requestIdFor(draft), first);
});

test('upload sends every chunk in order and cancels on failure', async () => {
  const calls = [];
  const request = async (path, options) => {
    calls.push([path, options.method, options.body instanceof FormData ? options.body.get('chunk_index') : options.body]);
    if (path.endsWith('upload_init.php') && options.method === 'POST') return { upload_id: 'u'.repeat(32), chunk_size: 4, total_chunks: 3 };
    if (path.endsWith('upload_chunk.php')) return { received: 0 };
    if (path.endsWith('upload_complete.php')) return { id: 9, original_name: 'a.bin', mime_type: 'application/octet-stream', file_size: 10 };
    return {};
  };
  const progress = [];
  const file = new Blob(['0123456789']);
  file.name = 'a.bin';
  const done = await uploadFile(Object.assign(file, { name: 'a.bin' }), { request, onProgress: (p) => progress.push(p) });
  assert.equal(done.id, 9);
  assert.deepEqual(calls.filter((c) => c[0].endsWith('upload_chunk.php')).map((c) => c[2]), ['0', '1', '2']);
  assert.deepEqual(progress, [33, 67, 100]);

  const failing = async (path, options) => {
    if (path.endsWith('upload_init.php') && options.method === 'POST') return { upload_id: 'v'.repeat(32), chunk_size: 4, total_chunks: 3 };
    if (path.endsWith('upload_chunk.php')) throw new Error('network');
    calls.push([path, options.method]);
    return {};
  };
  await assert.rejects(uploadFile(file, { request: failing }));
  assert.deepEqual(calls.at(-1), ['/api/upload_init.php', 'DELETE']);
});

test('addresses keep their scheme and lose trailing punctuation', async () => {
  const { extractUrls } = await import('../../app/lib/links.js');
  assert.deepEqual(extractUrls('see https://example.com/a, www.bbc.co.uk. and (github.com) then http://old.example.org/x and https://example.com/a'),
    ['https://example.com/a', 'https://www.bbc.co.uk', 'https://github.com', 'http://old.example.org/x']);
});
