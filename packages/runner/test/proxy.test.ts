import assert from 'node:assert/strict';
import { test } from 'node:test';
import { startProxy } from '../src/proxy.js';
import { startStubGateway } from './helpers.js';

test('proxy injects key and run headers, drops client auth, streams body', async () => {
  const gw = await startStubGateway('hi');
  const proxy = await startProxy({ gatewayUrl: gw.url, gatewayKey: 'REAL', runId: 'run-9', stage: 'build', product: 'p1', ticket: 't2' });
  try {
    const res = await fetch(`${proxy.url}/v1/messages`, {
      method: 'POST',
      headers: { 'x-api-key': 'proxy', authorization: 'Bearer leak', 'content-type': 'application/json' },
      body: '{"a":1}',
    });
    const text = await res.text();
    assert.equal(res.status, 200);
    assert.match(text, /message_stop/);
    const h = gw.seen[0]!.headers;
    assert.equal(h.authorization, 'Bearer REAL');
    assert.equal(h['x-bauherr-run'], 'run-9');
    assert.equal(h['x-bauherr-stage'], 'build');
    assert.equal(h['x-bauherr-product'], 'p1');
    assert.equal(h['x-bauherr-ticket'], 't2');
    assert.equal(h['x-api-key'], undefined);
    assert.equal(gw.seen[0]!.body, '{"a":1}');
  } finally {
    await proxy.close();
    await gw.close();
  }
  await assert.rejects(fetch(`${proxy.url}/v1/messages`), 'proxy is closed');
});

test('proxy: upstream 429 budget_exceeded fires callback once, later requests answered locally', async () => {
  const gw = await startStubGateway('x', 0, true);
  let fired = 0;
  const proxy = await startProxy({ gatewayUrl: gw.url, gatewayKey: 'REAL', runId: 'r', stage: 'plan', onBudgetExceeded: () => void fired++ });
  try {
    const first = await fetch(`${proxy.url}/v1/messages`, { method: 'POST', body: '{}' });
    assert.equal(first.status, 429);
    assert.match(await first.text(), /budget_exceeded/);
    const second = await fetch(`${proxy.url}/v1/messages`, { method: 'POST', body: '{}' });
    assert.equal(second.status, 429);
    assert.match(await second.text(), /budget_exceeded/);
    assert.equal(fired, 1);
    assert.equal(gw.seen.length, 1, 'second request never reached upstream');
  } finally {
    await proxy.close();
    await gw.close();
  }
});
