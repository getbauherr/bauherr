import assert from 'node:assert/strict';
import { test } from 'node:test';
import { startProxy } from '../src/proxy.js';
import { startStubGateway } from './helpers.js';

test('proxy injects key and run headers, drops client auth, streams body', async () => {
  const gw = await startStubGateway('hi');
  const proxy = await startProxy({ gatewayUrl: gw.url, gatewayKey: 'REAL', runId: 'run-9', stage: 'build' });
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
    assert.equal(h['x-api-key'], 'REAL');
    assert.equal(h['x-bauherr-run'], 'run-9');
    assert.equal(h['x-bauherr-stage'], 'build');
    assert.equal(h.authorization, undefined);
    assert.equal(gw.seen[0]!.body, '{"a":1}');
  } finally {
    await proxy.close();
    await gw.close();
  }
  await assert.rejects(fetch(`${proxy.url}/v1/messages`), 'proxy is closed');
});
