import test from 'node:test';
import assert from 'node:assert/strict';
import { createClient, ProviderError, runChecks, validateFlow, validateRoute } from '../scripts/provider-checks.mjs';

const flow = { flowSegmentData: { currentSpeed: 25, freeFlowSpeed: 40, confidence: 0.9,
  coordinates: { coordinate: [{ latitude: 9.98, longitude: 76.30 }, { latitude: 9.99, longitude: 76.31 }] } } };
const route = (mode, departureTime) => ({ routes: [{
  summary: { lengthInMeters: 1000, travelTimeInSeconds: 100, departureTime },
  sections: [{ sectionType: 'TRAVEL_MODE', travelMode: mode }],
}] });

test('missing traffic and invalid geometry are failures, not free-flow observations', () => {
  assert.throws(() => validateFlow({}), ProviderError);
  assert.throws(() => validateFlow({ flowSegmentData: { ...flow.flowSegmentData,
    coordinates: { coordinate: [{}, {}] } } }), ProviderError);
});

test('motorcycle routes cannot silently use unsupported or car-only sections', () => {
  for (const mode of ['other', 'car']) {
    assert.throws(() => validateRoute(route(mode), 'motorcycle', 'now'), /vehicle_sections/);
  }
  assert.equal(validateRoute(route('motorcycle'), 'motorcycle', 'now').vehicleModeConfirmed, true);
});

test('future departure confirmation accepts equal timezone instants and rejects wrong times', () => {
  const payload = route('car', '2026-10-30T00:15:00+05:30');
  assert.equal(validateRoute(payload, 'car', '2026-10-29T18:45:00Z').routeCount, 1);
  assert.throws(() => validateRoute(payload, 'car', '2026-10-29T19:45:00Z'), /departure_time/);
});

test('network errors discard URLs and credential-bearing exception details', async () => {
  const client = createClient('fake-sensitive-key', async () => { throw new Error('url?key=fake-sensitive-key'); });
  await assert.rejects(client('/test'), error => error.message === 'network_error' && !error.cause);
});

test('authentication rejection stops the remaining API calls and does not retain the body', async () => {
  let calls = 0;
  const checks = await runChecks('fake-key', { fetchImpl: async () => {
    calls++;
    return new Response('fake-sensitive-provider-body', { status: 403 });
  } });
  assert.equal(calls, 1);
  assert.equal(checks[0].httpStatus, 403);
  assert.ok(!JSON.stringify(checks).includes('fake-sensitive-provider-body'));
});

test('provider redirects are blocked and the credential cannot be sent to another origin', async () => {
  let calls = 0;
  const client = createClient('fake-key', async (_url, options) => {
    calls++;
    assert.equal(options.redirect, 'error');
    return Response.json({});
  });
  await assert.rejects(client('https://example.invalid/'), /invalid_provider_origin/);
  assert.equal(calls, 0);
  await client('/test');
});

test('complete suite checks 16 capabilities and sends +1-hour departures across local midnight', async () => {
  const requests = [];
  const now = new Date('2026-10-29T18:15:00Z'); // 23:45 IST.
  const pauses = [];
  const checks = await runChecks('fake-key', { now, pause: async milliseconds => pauses.push(milliseconds), fetchImpl: async url => {
    requests.push(url);
    if (url.pathname.includes('flowSegmentData')) return Response.json(flow);
    if (url.pathname.includes('/tile/')) return new Response(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]));
    if (url.pathname.includes('/geocode/')) return Response.json({ results: [{ position: { lat: 10.0261, lon: 76.3125 } }] });
    return Response.json(route(url.searchParams.get('travelMode'), url.searchParams.get('departAt')));
  } });
  assert.equal(checks.length, 16);
  assert.ok(checks.every(check => check.status === 'PASS'));
  assert.equal(pauses.length, 15);
  assert.ok(pauses.every(milliseconds => milliseconds >= 1000));
  const future = requests.filter(url => url.pathname.includes('/routing/') && url.searchParams.get('departAt') !== 'now');
  assert.equal(future.length, 4);
  assert.ok(future.every(url => url.searchParams.get('departAt') === '2026-10-29T19:15:00.000Z'));
});
