import test from 'node:test';
import assert from 'node:assert/strict';
import { handleApi } from '../src/server/api.ts';

const secret = 'fake-key-for-server-only-tests';
const env = { TOMTOM_API_KEY: secret };
const local = path => new Request(`http://localhost:8787${path}`);
const flow = { flowSegmentData: { currentSpeed: 0, freeFlowSpeed: 40, confidence: 0.95, roadClosure: true,
  coordinates: { coordinate: [{ latitude: 9.98, longitude: 76.30 }, { latitude: 9.99, longitude: 76.31 }] },
  debugUrl: `https://api.tomtom.com/?key=${secret}` } };

test('public upstream access fails closed before account-wide quotas are configured', async () => {
  let calls = 0;
  const response = await handleApi(new Request('https://kochi-traffic.example/api/flow?lat=9.98&lon=76.30'), env,
    async () => { calls++; return Response.json(flow); });
  assert.equal(response.status, 503);
  assert.equal(calls, 0);
  assert.ok(!(await response.text()).includes(secret));
});

test('out-of-area, arbitrary URLs, unexpected parameters and invalid tiles never call the provider', async () => {
  for (const path of [
    '/api/flow?lat=12.9&lon=77.6', '/api/flow?lat=9.98&lon=76.30&url=https://example.invalid',
    '/api/tiles/base/2/1/1.png', '/api/tiles/traffic/12/999999/999999.png', '/api/proxy?url=https://example.invalid',
  ]) {
    const response = await handleApi(local(path), env, async () => { throw new Error('Unexpected provider request'); }, true);
    assert.ok([400, 404].includes(response.status));
  }
});

test('road normalization preserves a genuine zero speed and closure without leaking provider fields', async () => {
  const response = await handleApi(local('/api/flow?lat=9.98&lon=76.30'), env, async (url, options) => {
    assert.equal(url.origin, 'https://api.tomtom.com');
    assert.equal(url.searchParams.get('key'), secret);
    assert.equal(options.redirect, 'manual');
    return Response.json(flow);
  }, true);
  assert.equal(response.status, 200);
  const text = await response.text();
  assert.ok(!text.includes(secret));
  const road = JSON.parse(text);
  assert.equal(road.speedKmh, 0);
  assert.equal(road.state, 'closed');
  assert.equal(response.headers.get('cache-control'), 'no-store');
});

test('upstream credential-bearing error bodies are never forwarded to a visitor', async () => {
  const response = await handleApi(local('/api/flow?lat=9.98&lon=76.30'), env,
    async () => new Response(`authentication failed: ${secret}`, { status: 403 }), true);
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: 'PROVIDER_AUTHORIZATION_FAILED' });
});

test('missing observations stay unavailable rather than becoming clear traffic', async () => {
  const response = await handleApi(local('/api/flow?lat=9.98&lon=76.30'), env, async () => Response.json({}), true);
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: 'NO_ROAD_DATA' });
});

test('a localhost Host value cannot enable provider access in the production adapter', async () => {
  let called = false;
  const response = await handleApi(local('/api/flow?lat=9.98&lon=76.30'), env, async () => {
    called = true; return Response.json(flow);
  });
  assert.equal(response.status, 503);
  assert.equal(called, false);
});

test('the Worker-compatible fetch adapter does not follow or expose upstream redirects', async () => {
  let calls = 0;
  const response = await handleApi(local('/api/flow?lat=9.98&lon=76.30'), env, async (_url, options) => {
    calls++;
    assert.equal(options.redirect, 'manual');
    return new Response(secret, { status: 302, headers: { Location: `https://other.example/?key=${secret}` } });
  }, true);
  assert.equal(calls, 1); assert.equal(response.status, 503);
  assert.equal(response.headers.get('location'), null);
  assert.deepEqual(await response.json(), { error: 'PROVIDER_HTTP_302' });
});
