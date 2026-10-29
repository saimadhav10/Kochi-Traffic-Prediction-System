import { containsPoint, validTile, type RoadDetails } from '../shared/region.ts';

export interface Env {
  TOMTOM_API_KEY?: string;
  ASSETS: { fetch(request: Request): Promise<Response> };
}
type Product = 'base' | 'traffic' | 'flow';
type Fetcher = typeof fetch;

const guards = new Map<Product, { tail: Promise<void>; lastStart: number; calls: number; queued: number }>();
const limits: Record<Product, number> = { base: 1200, traffic: 1200, flow: 80 };
const delays: Record<Product, number> = { base: 180, traffic: 250, flow: 1100 };

export class ApiError extends Error {
  code: string;
  status: number;
  constructor(code: string, status: number) { super(code); this.code = code; this.status = status; }
}

const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' };
function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers });
}

async function guardedRequest(product: Product, operation: () => Promise<Response>): Promise<Response> {
  let guard = guards.get(product);
  if (!guard) { guard = { tail: Promise.resolve(), lastStart: 0, calls: 0, queued: 0 }; guards.set(product, guard); }
  if (guard.calls >= limits[product] || guard.queued >= 40) throw new ApiError('LOCAL_USAGE_LIMIT', 429);
  guard.calls++;
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
  return guardedRequest(product, async () => {
    try { return await fetcher(url, { redirect: 'error', signal: AbortSignal.timeout(12_000) }); }
    catch { throw new ApiError('PROVIDER_NETWORK_ERROR', 503); }
  });
}

function checkProviderStatus(response: Response): void {
  if (response.status === 429) throw new ApiError('PROVIDER_BUSY', 429);
  if ([401, 403].includes(response.status)) throw new ApiError('PROVIDER_AUTHORIZATION_FAILED', 503);
  if (response.status === 404) throw new ApiError('NO_ROAD_DATA', 404);
  if (!response.ok) throw new ApiError(`PROVIDER_HTTP_${response.status}`, 503);
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
    if (url.pathname === '/api/status') return json({ available: localAccess && Boolean(env.TOMTOM_API_KEY?.trim()), refreshMinutes: 15 });
    // Until durable account-wide quotas are implemented, upstream access is local only.
    // A deployment cannot accidentally expose an unrestricted public provider proxy.
    if (!localAccess) throw new ApiError('PUBLIC_ACCESS_NOT_READY', 503);
    if (!env.TOMTOM_API_KEY?.trim()) throw new ApiError('TRAFFIC_UNAVAILABLE', 503);

    if (url.pathname === '/api/flow') {
      if ([...url.searchParams.keys()].some(name => !['lat', 'lon'].includes(name))) throw new ApiError('INVALID_REQUEST', 400);
      const lat = Number(url.searchParams.get('lat')), lon = Number(url.searchParams.get('lon'));
      if (!url.searchParams.has('lat') || !url.searchParams.has('lon') || !containsPoint(lat, lon)) throw new ApiError('OUTSIDE_KOCHI', 400);
      const response = await provider('/traffic/services/4/flowSegmentData/relative0/16/json', {
        point: `${lat},${lon}`, unit: 'kmph',
      }, 'flow', env, fetcher);
      checkProviderStatus(response);
      let payload: unknown;
      try { payload = await response.json(); } catch { throw new ApiError('PROVIDER_INVALID_RESPONSE', 503); }
      return json(normalizeRoad(payload, new Date().toISOString()));
    }

    const match = /^\/api\/tiles\/(base|traffic)\/(\d{1,2})\/(\d+)\/(\d+)\.png$/.exec(url.pathname);
    if (match) {
      if ([...url.searchParams.keys()].some(name => name !== 'v')) throw new ApiError('INVALID_REQUEST', 400);
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
    return json({ error: error instanceof ApiError ? error.code : 'TRAFFIC_UNAVAILABLE' },
      error instanceof ApiError ? error.status : 503);
  }
}
