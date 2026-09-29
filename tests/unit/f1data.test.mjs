import test from 'node:test';
import assert from 'node:assert/strict';
import { createF1Data } from '../../app/dashboard/f1data.js';

function response(status, value) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => value
  };
}

test('concurrent callers share one cached request', async () => {
  let calls = 0;
  let finish;
  const pending = new Promise(resolve => { finish = resolve; });
  const client = createF1Data({
    fetch: async () => {
      calls += 1;
      await pending;
      return response(200, { value: 7 });
    }
  });
  const first = client.fetchJson('https://api.jolpi.ca/ergast/f1/current.json');
  const second = client.fetchJson('https://api.jolpi.ca/ergast/f1/current.json');
  finish();
  assert.deepEqual(await first, { value: 7 });
  assert.deepEqual(await second, { value: 7 });
  assert.equal(calls, 1);
});

test('429 is busy and 500 is failed', async () => {
  const client = createF1Data({
    fetch: async url => response(url.endsWith('busy') ? 429 : 500, {})
  });
  await assert.rejects(client.fetchJson('https://api.openf1.org/v1/busy'), error => error.kind === 'busy');
  await assert.rejects(client.fetchJson('https://api.openf1.org/v1/failure'), error => error.kind === 'failed');
});

test('an aborted request uses the abort reason and is not cached', async () => {
  let calls = 0;
  let started;
  const ready = new Promise(resolve => { started = resolve; });
  const client = createF1Data({
    fetch: async (url, { signal }) => {
      calls += 1;
      if (calls === 1) {
        started();
        await new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
      }
      return response(200, { calls });
    }
  });
  const controller = new AbortController();
  const reason = new Error('stale');
  const first = client.fetchJson('https://api.jolpi.ca/ergast/f1/2026.json', { signal: controller.signal });
  await ready;
  controller.abort(reason);
  await assert.rejects(first, error => error === reason);
  assert.deepEqual(await client.fetchJson('https://api.jolpi.ca/ergast/f1/2026.json'), { calls: 2 });
  assert.equal(calls, 2);
});

test('requests to one host start at least 250 ms apart', async () => {
  let clock = 1000;
  const starts = [];
  const client = createF1Data({
    now: () => clock,
    sleep: async ms => { clock += ms; },
    fetch: async url => {
      starts.push([url, clock]);
      return response(200, {});
    }
  });
  await Promise.all([
    client.fetchJson('https://api.openf1.org/v1/a'),
    client.fetchJson('https://api.openf1.org/v1/b'),
    client.fetchJson('https://api.openf1.org/v1/c')
  ]);
  assert.deepEqual(starts.map(item => item[1]), [1000, 1250, 1500]);
});
