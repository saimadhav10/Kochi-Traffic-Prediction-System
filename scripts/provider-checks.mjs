const origin = 'https://api.tomtom.com';
export const samples = {
  'Central Kochi': [9.9816, 76.2999],
  Kakkanad: [10.0150, 76.3417],
  Kalamassery: [10.0526, 76.3158],
  Aluva: [10.1076, 76.3516],
  Tripunithura: [9.9493, 76.3474],
};

export class ProviderError extends Error {
  constructor(code, httpStatus) {
    super(code);
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

export function createClient(apiKey, fetchImpl = globalThis.fetch) {
  return async (path, parameters = {}, binary = false) => {
    const url = new URL(path, origin);
    if (url.origin !== origin) throw new ProviderError('invalid_provider_origin');
    url.search = new URLSearchParams({ ...parameters, key: apiKey }).toString();
    try {
      const response = await fetchImpl(url, { redirect: 'error', signal: AbortSignal.timeout(15_000) });
      if (!response.ok) throw new ProviderError('http_error', response.status);
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.length > 2_000_000) throw new ProviderError('response_too_large');
      if (binary) return bytes;
      try { return JSON.parse(new TextDecoder().decode(bytes)); }
      catch { throw new ProviderError('invalid_json'); }
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      // Fetch exceptions may contain a URL with the key. Never retain them.
      throw new ProviderError('network_error');
    }
  };
}

const finite = value => typeof value === 'number' && Number.isFinite(value);
const requireValue = (condition, code) => { if (!condition) throw new ProviderError(code); };

export function validateFlow(payload) {
  const flow = payload?.flowSegmentData;
  requireValue(flow && finite(flow.currentSpeed) && flow.currentSpeed >= 0 &&
    finite(flow.freeFlowSpeed) && flow.freeFlowSpeed > 0 &&
    finite(flow.confidence) && flow.confidence >= 0 && flow.confidence <= 1 &&
    Array.isArray(flow.coordinates?.coordinate) && flow.coordinates.coordinate.length >= 2 &&
    flow.coordinates.coordinate.every(point => finite(point.latitude) && finite(point.longitude)),
  'missing_or_invalid_traffic');
  return { speedKmh: flow.currentSpeed, freeFlowKmh: flow.freeFlowSpeed,
    confidence: flow.confidence, closed: flow.roadClosure === true };
}

export function validateRoute(payload, mode, departure) {
  requireValue(Array.isArray(payload?.routes) && payload.routes.length > 0, 'no_route');
  for (const route of payload.routes) {
    const summary = route.summary;
    requireValue(finite(summary?.lengthInMeters) && summary.lengthInMeters > 0 &&
      finite(summary.travelTimeInSeconds) && summary.travelTimeInSeconds > 0, 'invalid_route_summary');
    const sections = route.sections?.filter(section => section.sectionType === 'TRAVEL_MODE');
    requireValue(sections?.length > 0 && sections.every(section => section.travelMode === mode),
      'unsupported_or_unconfirmed_vehicle_sections');
    if (departure !== 'now') {
      const requested = Date.parse(departure);
      const returned = Date.parse(summary.departureTime);
      requireValue(finite(requested) && finite(returned) && Math.abs(requested - returned) <= 2_000,
        'departure_time_not_confirmed');
    }
  }
  return { routeCount: payload.routes.length, vehicleModeConfirmed: true,
    distanceM: payload.routes[0].summary.lengthInMeters,
    durationS: payload.routes[0].summary.travelTimeInSeconds };
}

async function check(name, operation, extra = {}) {
  try { return { check: name, status: 'PASS', ...extra, ...await operation() }; }
  catch (error) {
    return { check: name, status: 'FAIL', ...extra,
      reason: error instanceof ProviderError ? error.code : 'unexpected_response_shape',
      ...(error instanceof ProviderError && error.httpStatus ? { httpStatus: error.httpStatus } : {}) };
  }
}

const flowCheck = (request, name, point) => check(`traffic: ${name}`, async () => validateFlow(
  await request('/traffic/services/4/flowSegmentData/relative0/15/json', {
    point: point.join(','), unit: 'kmph',
  }),
));

function tilePath(traffic) {
  const [lat, lon] = samples['Central Kochi'];
  const zoom = 12, scale = 2 ** zoom;
  const x = Math.floor((lon + 180) / 360 * scale);
  const y = Math.floor((1 - Math.asinh(Math.tan(lat * Math.PI / 180)) / Math.PI) / 2 * scale);
  return traffic ? `/traffic/map/4/tile/flow/relative0/${zoom}/${x}/${y}.png`
    : `/map/1/tile/basic/main/${zoom}/${x}/${y}.png`;
}

export async function runChecks(apiKey, {
  fetchImpl = globalThis.fetch, now = new Date(),
  pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)),
} = {}) {
  const request = createClient(apiKey, fetchImpl);
  const first = await flowCheck(request, 'Central Kochi', samples['Central Kochi']);
  if ([401, 403, 429].includes(first.httpStatus)) return [first];
  const tasks = Object.entries(samples).filter(([name]) => name !== 'Central Kochi')
    .map(([name, point]) => () => flowCheck(request, name, point));

  for (const traffic of [false, true]) tasks.push(() => check(
    traffic ? 'traffic raster tile' : 'basemap raster tile', async () => {
      const bytes = await request(tilePath(traffic), { tileSize: 256 }, true);
      requireValue([137, 80, 78, 71, 13, 10, 26, 10].every((byte, i) => bytes[i] === byte), 'invalid_png_tile');
      return {};
    },
  ));

  tasks.push(() => check('Kochi address geocoding', async () => {
    const payload = await request('/search/2/geocode/Edappally%2C%20Kochi%2C%20India.json', {
      countrySet: 'IN', limit: 1, lat: 10.0261, lon: 76.3125,
    });
    const point = payload?.results?.[0]?.position;
    requireValue(finite(point?.lat) && finite(point?.lon) && point.lat > 9.8 && point.lat < 10.3 &&
      point.lon > 76.1 && point.lon < 76.6, 'no_local_geocoding_result');
    return {};
  }));

  const future = new Date(now.getTime() + 3_600_000).toISOString();
  const journeys = [
    ['Edappally to Vyttila', [10.0261, 76.3125], [9.9658, 76.3183]],
    ['Kakkanad to Aluva', samples.Kakkanad, samples.Aluva],
  ];
  for (const [name, start, end] of journeys) {
    for (const mode of ['car', 'motorcycle']) {
      for (const departure of ['now', future]) tasks.push(() => check(`route: ${name}, ${mode}`,
        async () => validateRoute(await request(
          `/routing/1/calculateRoute/${start.join(',')}:${end.join(',')}/json`, {
            travelMode: mode, traffic: 'true', departAt: departure, maxAlternatives: 1,
            sectionType: 'travelMode',
          },
        ), mode, departure), { departure }));
    }
  }

  const results = [];
  for (const task of tasks) {
    // Sequential calls avoid exhausting low per-second product allowances.
    await pause(1_100);
    results.push(await task());
  }
  return [first, ...results];
}
