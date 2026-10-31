import { bounds, containsPoint, validTile, type RoadDetails } from '../shared/region.ts';
import { normalizeAddresses, normalizeRoutes } from './journey.ts';
import { anonymousIdentity, QuotaError, reserveQuota, type Product, type QuotaDatabase } from './quota.ts';

export interface Env {
  TOMTOM_API_KEY?: string;
  QUOTA_DB?: QuotaDatabase;
  QUOTA_SALT?: string;
  PUBLIC_ACCESS_ENABLED?: string;
  requestIdentity?: string;
  ASSETS: { fetch(request: Request): Promise<Response> };
}
type Fetcher = typeof fetch;

const guards = new Map<Product, { tail: Promise<void>; lastStart: number; calls: number; queued: number }>();
const limits: Record<Product, number> = { base: 1200, traffic: 1200, flow: 80, geocode: 40, route: 40 };
const delays: Record<Product, number> = { base: 180, traffic: 250, flow: 1100, geocode: 1100, route: 1100 };

export class ApiError extends Error {
  code: string;
  status: number;
  constructor(code: string, status: number) { super(code); this.code = code; this.status = status; }
}

const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Cross-Origin-Resource-Policy': 'same-origin' };
function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { ...headers, ...(status === 429 ? { 'Retry-After': '60' } : {}) } });
}

async function guardedRequest(product: Product, operation: () => Promise<Response>, local = true): Promise<Response> {
  let guard = guards.get(product);
  if (!guard) { guard = { tail: Promise.resolve(), lastStart: 0, calls: 0, queued: 0 }; guards.set(product, guard); }
  if ((local && guard.calls >= limits[product]) || guard.queued >= 40) throw new ApiError(local ? 'LOCAL_USAGE_LIMIT' : 'USAGE_LIMIT_REACHED', 429);
  if (local) guard.calls++;
  guard.queued++;
  const previous = guard.tail;
  let release!: () => void;
  guard.tail = new Promise<void>(resolve => { release = resolve; });
  try {
    await previous;
    const wait = delays[product] - (Date.now() - guard.lastStart);
    if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait));
    guard.lastStart = Date.now();
    return await operation();
  } finally { guard.queued--; release(); }
}

async function provider(path: string, params: Record<string, string>, product: Product, env: Env, fetcher: Fetcher) {
  const url = new URL(path, 'https://api.tomtom.com');
  url.search = new URLSearchParams({ ...params, key: env.TOMTOM_API_KEY!.trim() }).toString();
  const operation = async () => {
    if (env.requestIdentity && env.QUOTA_DB) {
      for (let attempt = 0; ; attempt++) {
        try { await reserveQuota(env.QUOTA_DB, product, env.requestIdentity); break; }
        catch (error) {
          // Retry only a known rolled-back short burst, never a provider call or uncertain write.
          if (!(error instanceof QuotaError) || error.code !== 'RATE_LIMIT_REACHED' || !['base', 'traffic'].includes(product) || attempt >= 2) throw error;
          await new Promise(resolve => setTimeout(resolve, 1050 + Math.random() * 150));
        }
      }
    }
    // Workers supports manual/follow, but not the standard error redirect mode.
    // Keep redirects disabled and reject 3xx in checkProviderStatus without following Location.
    try { return await fetcher(url, { redirect: 'manual', signal: AbortSignal.timeout(12_000) }); }
    catch { throw new ApiError('PROVIDER_NETWORK_ERROR', 503); }
  };
  // Never keep cross-request promise queues in a Worker isolate: an aborted
  // request can terminate its I/O and strand other requests waiting on it.
  return env.requestIdentity ? operation() : guardedRequest(product, operation);
}

function checkProviderStatus(response: Response): void {
  if (response.status === 429) throw new ApiError('PROVIDER_BUSY', 429);
  if ([401, 403].includes(response.status)) throw new ApiError('PROVIDER_AUTHORIZATION_FAILED', 503);
  if (response.status === 404) throw new ApiError('NO_ROAD_DATA', 404);
  if (!response.ok) throw new ApiError(`PROVIDER_HTTP_${response.status}`, 503);
}

async function readJson(response: Response): Promise<unknown> {
  // Bound provider bodies and never forward credential-bearing error text.
  if (!response.body) throw new ApiError('PROVIDER_INVALID_RESPONSE', 503);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 4_000_000) { await reader.cancel(); throw new Error(); }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch { throw new ApiError('PROVIDER_INVALID_RESPONSE', 503); }
}

function validateParams(url: URL, allowed: string[]) {
  if ([...url.searchParams.keys()].some(name => !allowed.includes(name) || url.searchParams.getAll(name).length !== 1)) {
    throw new ApiError('INVALID_REQUEST', 400);
  }
}

function pointParam(url: URL, name: string): [number, number] {
  const raw = url.searchParams.get(name);
  if (!raw || !/^-?\d+(?:\.\d+)?,-?\d+(?:\.\d+)?$/.test(raw)) throw new ApiError('INVALID_REQUEST', 400);
  const [lat, lon] = raw.split(',').map(Number);
  if (!containsPoint(lat, lon)) throw new ApiError('OUTSIDE_KOCHI', 400);
  return [lat, lon];
}

export function normalizeRoad(payload: unknown, fetchedAt: string): RoadDetails {
  const flow = (payload as { flowSegmentData?: Record<string, unknown> })?.flowSegmentData;
  const speed = flow?.currentSpeed, free = flow?.freeFlowSpeed, confidence = flow?.confidence;
  if (typeof speed !== 'number' || !Number.isFinite(speed) || speed < 0 ||
      typeof free !== 'number' || !Number.isFinite(free) || free <= 0 ||
      typeof confidence !== 'number' || !Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    throw new ApiError('NO_ROAD_DATA', 404);
  }
  const points = (flow?.coordinates as { coordinate?: { latitude: number; longitude: number }[] })?.coordinate;
  if (!Array.isArray(points) || points.length < 2 || points.some(point =>
    !Number.isFinite(point.latitude) || !Number.isFinite(point.longitude) ||
    Math.abs(point.latitude) > 90 || Math.abs(point.longitude) > 180)) throw new ApiError('NO_ROAD_DATA', 404);
  const ratio = speed / free;
  return { speedKmh: speed, freeFlowKmh: free, ratio, confidence, fetchedAt,
    state: flow?.roadClosure === true ? 'closed' : ratio >= 0.75 ? 'clear' : ratio >= 0.35 ? 'slower' : 'heavy',
    coordinates: points.map(point => [point.longitude, point.latitude]) };
}

export async function handleApi(request: Request, env: Env, fetcher: Fetcher = fetch, localPreview = false): Promise<Response> {
  try {
    const url = new URL(request.url);
    if (request.method !== 'GET') return json({ error: 'METHOD_NOT_ALLOWED' }, 405);
    const localAccess = localPreview && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    const publicAccess = !localPreview && url.protocol === 'https:' && env.PUBLIC_ACCESS_ENABLED === 'true' && Boolean(env.QUOTA_DB && env.QUOTA_SALT && env.QUOTA_SALT.length >= 32);
    if (url.pathname === '/api/status') return json({ available: (localAccess || publicAccess) && Boolean(env.TOMTOM_API_KEY?.trim()), refreshMinutes: 15 });
    if (!localAccess && !publicAccess) throw new ApiError('PUBLIC_ACCESS_NOT_READY', 503);
    if (!env.TOMTOM_API_KEY?.trim()) throw new ApiError('TRAFFIC_UNAVAILABLE', 503);
    if (publicAccess) {
      if ((request.headers.get('origin') && request.headers.get('origin') !== url.origin) || request.headers.get('sec-fetch-site') === 'cross-site') throw new ApiError('INVALID_ORIGIN', 403);
      env = { ...env, requestIdentity: await anonymousIdentity(request.headers.get('cf-connecting-ip'), env.QUOTA_SALT!, new Date()) };
    } else env = { ...env, requestIdentity: undefined };

    if (url.pathname === '/api/geocode') {
      validateParams(url, ['q']);
      const query = url.searchParams.get('q')?.trim();
      if (!query || query.length < 3 || query.length > 160 || /[\u0000-\u001f\u007f]/.test(query)) throw new ApiError('INVALID_REQUEST', 400);
      const response = await provider(`/search/2/geocode/${encodeURIComponent(query)}.json`, {
        countrySet: 'IN', limit: '10', topLeft: `${bounds.north},${bounds.west}`, btmRight: `${bounds.south},${bounds.east}`,
      }, 'geocode', env, fetcher);
      checkProviderStatus(response);
      const payload = await readJson(response);
      try { return json({ results: normalizeAddresses(payload) }); }
      catch { throw new ApiError('PROVIDER_INVALID_RESPONSE', 503); }
    }

    if (url.pathname === '/api/routes') {
      validateParams(url, ['start', 'end', 'vehicle', 'departure']);
      const start = pointParam(url, 'start'), end = pointParam(url, 'end');
      if (Math.hypot(start[0] - end[0], start[1] - end[1]) < 0.0001) throw new ApiError('POINTS_TOO_CLOSE', 400);
      const vehicle = url.searchParams.get('vehicle'), departure = url.searchParams.get('departure');
      if ((vehicle !== 'car' && vehicle !== 'motorcycle') || (departure !== 'now' && departure !== 'hour')) throw new ApiError('INVALID_REQUEST', 400);
      const requestedTime = Date.now() + (departure === 'hour' ? 3_600_000 : 0);
      const response = await provider(`/routing/1/calculateRoute/${start.join(',')}:${end.join(',')}/json`, {
        travelMode: vehicle, traffic: 'true', departAt: departure === 'now' ? 'now' : new Date(requestedTime).toISOString(),
        maxAlternatives: '2', routeType: 'fastest', sectionType: 'travelMode', routeRepresentation: 'polyline',
      }, 'route', env, fetcher);
      if ([400, 404].includes(response.status)) throw new ApiError('NO_ROUTE', 404);
      checkProviderStatus(response);
      const payload = await readJson(response);
      try { return json({ routes: normalizeRoutes(payload, vehicle, requestedTime, departure === 'now' ? 120_000 : 2_000), vehicle, departure, fetchedAt: new Date().toISOString() }); }
      catch (error) {
        const code = error instanceof Error && ['NO_ROUTE', 'VEHICLE_UNAVAILABLE'].includes(error.message) ? error.message : 'PROVIDER_INVALID_RESPONSE';
        throw new ApiError(code, code === 'PROVIDER_INVALID_RESPONSE' ? 503 : 404);
      }
    }

    if (url.pathname === '/api/flow') {
      validateParams(url, ['lat', 'lon']);
      const lat = Number(url.searchParams.get('lat')), lon = Number(url.searchParams.get('lon'));
      if (!url.searchParams.has('lat') || !url.searchParams.has('lon') || !containsPoint(lat, lon)) throw new ApiError('OUTSIDE_KOCHI', 400);
      const response = await provider('/traffic/services/4/flowSegmentData/relative0/16/json', {
        point: `${lat},${lon}`, unit: 'kmph',
      }, 'flow', env, fetcher);
      checkProviderStatus(response);
      const payload = await readJson(response);
      return json(normalizeRoad(payload, new Date().toISOString()));
    }

    const match = /^\/api\/tiles\/(base|traffic)\/(\d{1,2})\/(\d+)\/(\d+)\.png$/.exec(url.pathname);
    if (match) {
      validateParams(url, ['v']);
      const product = match[1] as 'base' | 'traffic';
      const z = Number(match[2]), x = Number(match[3]), y = Number(match[4]);
      if (!validTile(z, x, y)) throw new ApiError('OUTSIDE_KOCHI', 400);
      const path = product === 'base' ? `/map/1/tile/basic/main/${z}/${x}/${y}.png`
        : `/traffic/map/4/tile/flow/relative0/${z}/${x}/${y}.png`;
      const response = await provider(path, { tileSize: '256' }, product, env, fetcher);
      checkProviderStatus(response);
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.length > 2_000_000 || ![137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => bytes[index] === byte)) {
        throw new ApiError('PROVIDER_UNAVAILABLE', 503);
      }
      return new Response(bytes, { headers: { ...headers, 'Content-Type': 'image/png', 'X-Data-Fetched-At': new Date().toISOString() } });
    }
    return json({ error: 'NOT_FOUND' }, 404);
  } catch (error) {
    return json({ error: error instanceof ApiError || error instanceof QuotaError ? error.code : 'TRAFFIC_UNAVAILABLE' },
      error instanceof ApiError || error instanceof QuotaError ? error.status : 503);
  }
}
