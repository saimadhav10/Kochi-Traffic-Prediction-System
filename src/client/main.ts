import * as maplibregl from 'maplibre-gl';
import type { GeoJSONSource, RasterTileSource } from 'maplibre-gl';
import mapWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import 'maplibre-gl/dist/maplibre-gl.css';
import './style.css';
import { bounds, containsPoint, places, type RoadDetails } from '../shared/region.ts';
import { journeyPanel, setupJourney } from './journey.ts';

const arrow = '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 12h14m-6-6 6 6-6 6" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const refreshIcon = '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M20 10a8 8 0 1 0-2 8M20 4v6h-6" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const pin = '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M19 10c0 5-7 10-7 10S5 15 5 10a7 7 0 1 1 14 0Z" stroke="currentColor" stroke-width="1.6"/><circle cx="12" cy="10" r="2.5" stroke="currentColor" stroke-width="1.6"/></svg>';

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
  <a class="skip-link" href="#plan-tab">Skip to map tools</a>
  <header class="app-header">
    <a class="brand" href="/" aria-label="Kochi Traffic home"><img src="/favicon.svg" alt="" width="38" height="38"/><span>Kochi<span class="brand-light">traffic</span><span class="brand-dot">.</span></span></a>
    <div class="header-context"><span class="context-dot"></span> A clearer view of your city</div>
    <div class="header-right"><span class="region-label">KERALA, INDIA</span><span class="live-pill"><i></i> Live traffic</span></div>
  </header>
  <main class="map-shell">
    <div id="map" role="region" aria-label="Interactive map of wider Kochi. Use the area buttons to select a road with the keyboard."></div>
    <div class="map-grain" aria-hidden="true"></div>
    <aside class="explorer" aria-label="Traffic explorer">
      ${journeyPanel}
      <section class="intro-card" data-explore>
        <div class="eyebrow"><span class="tiny-line"></span> THE CITY, IN MOTION</div>
        <h1>Know the road ahead<span class="accent">.</span></h1>
        <p class="intro-copy">A live look at traffic across Kochi. Find a road. See how it’s moving.</p>
        <div class="location-line">${pin}<span>Wider Kochi urban area</span><span class="area-count">05 areas</span></div>
        <div class="area-heading">EXPLORE AN AREA</div>
        <div id="places" class="places">${places.map((place, index) => `<button class="place${index === 0 ? ' active' : ''}" data-place="${index}" aria-pressed="${index === 0}"><span>${place.name}</span>${arrow}</button>`).join('')}</div>
      </section>
      <section id="road-panel" class="road-card" data-explore tabindex="-1" aria-labelledby="road-heading">
        <div class="road-top"><span class="eyebrow">ROAD SNAPSHOT</span><span id="road-state" class="state-pill loading">Loading</span></div>
        <h2 id="road-heading">Central Kochi</h2>
        <p id="road-context" class="road-context">Matching the nearest observed road…</p>
        <div id="road-content" class="road-content"><div class="skeleton"></div><div class="skeleton short"></div></div>
        <p id="road-message" class="road-message" role="status" aria-live="polite">Loading current road conditions.</p>
      </section>
      <p class="explorer-footnote" data-explore>Select any road on the map to take a closer look.</p>
    </aside>
    <div class="map-topbar"><div class="view-label"><span class="crosshair">⌖</span><span>KOCHI & ITS NEIGHBOURHOODS</span></div>
      <button id="traffic-toggle" class="map-button" aria-pressed="true" disabled><span class="layers-icon" aria-hidden="true">▱</span> Traffic layer <span class="toggle-track"><span></span></span></button>
    </div>
    <div id="map-alert" class="map-alert" role="status" aria-live="polite" hidden></div>
    <div class="map-footer">
      <section class="legend" aria-label="Traffic colors"><span class="legend-title">TRAFFIC FLOW</span><span><i class="legend-dot clear"></i>Free flow</span><span><i class="legend-dot slower"></i>Slower</span><span><i class="legend-dot heavy"></i>Heavy</span><span class="legend-note">No overlay? No current observation.</span></section>
      <button id="refresh" class="refresh-button" aria-label="Refresh visible traffic and selected road" disabled>${refreshIcon}<span id="refresh-label">Refresh traffic</span></button>
    </div>
    <div class="map-caption"><span id="map-status">Loading map…</span><span>Data: TomTom · Times: IST · <a href="/about">About & privacy</a></span></div>
  </main>`;

function element<T extends HTMLElement = HTMLElement>(id: string): T { return document.getElementById(id) as T; }
const statusElement = element('map-status');
const alertElement = element('map-alert');
const stateElement = element('road-state');
const contentElement = element('road-content');
let selected: [number, number] = [...places[0].coordinates];
let selectedName: string = places[0].name;
let requestSequence = 0;
let trafficEnabled = true;
let lastRefresh = 0;
let latestRoad: RoadDetails | undefined;
let selectedMarker: maplibregl.Marker | undefined;
let abortController: AbortController | undefined;
let refreshBusy = false;
let mapReady = false;
const labels = { clear: 'Free flow', slower: 'Slower traffic', heavy: 'Heavy traffic', closed: 'Road closed' };
const clock = (iso: string) => new Intl.DateTimeFormat('en-IN', {
  timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: true,
}).format(new Date(iso));

maplibregl.setWorkerUrl(mapWorkerUrl);
maplibregl.setMaxParallelImageRequests(4);
const tileUrl = (product: 'base' | 'traffic') => `${location.origin}/api/tiles/${product}/{z}/{x}/{y}.png?v=${Math.floor(Date.now() / 900_000)}`;
const map = new maplibregl.Map({
  container: 'map', center: [76.312, 10.015], zoom: 12, minZoom: 10.5, maxZoom: 16,
  maxBounds: [[bounds.west, bounds.south], [bounds.east, bounds.north]],
  style: { version: 8, sources: {
    basemap: { type: 'raster', tiles: [tileUrl('base')], tileSize: 256, minzoom: 10, maxzoom: 16,
      bounds: [bounds.west, bounds.south, bounds.east, bounds.north],
      attribution: '<a href="https://www.tomtom.com/legal/copyrights/" target="_blank" rel="noopener noreferrer">© TomTom</a>' },
    traffic: { type: 'raster', tiles: [tileUrl('traffic')], tileSize: 256, minzoom: 10, maxzoom: 16,
      bounds: [bounds.west, bounds.south, bounds.east, bounds.north] },
  }, layers: [
    { id: 'background', type: 'background', paint: { 'background-color': '#ecf0e9' } },
    { id: 'basemap', type: 'raster', source: 'basemap', paint: { 'raster-saturation': -0.35, 'raster-opacity': 0.9 } },
    { id: 'traffic', type: 'raster', source: 'traffic', paint: { 'raster-opacity': 0.92 } },
  ] },
  attributionControl: { compact: false },
  canvasContextAttributes: { antialias: true },
});
map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');
map.addControl(new maplibregl.ScaleControl({ maxWidth: 80, unit: 'metric' }), 'bottom-right');
const journey = setupJourney(map, syncRoadVisibility);

function syncRoadVisibility() {
  const exploring = element('explore-tab').getAttribute('aria-pressed') === 'true';
  for (const id of ['selected-road-halo', 'selected-road-line']) {
    if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', exploring ? 'visible' : 'none');
  }
  selectedMarker?.remove();
  if (exploring) selectedMarker = new maplibregl.Marker({ color: '#28533b' }).setLngLat(selected).addTo(map);
}

function setAlert(message = '') { alertElement.textContent = message; alertElement.hidden = !message; }

function drawRoad(road?: RoadDetails) {
  if (!mapReady) return;
  const geometry = { type: 'FeatureCollection' as const, features: road ? [{ type: 'Feature' as const,
    properties: {}, geometry: { type: 'LineString' as const, coordinates: road.coordinates } }] : [] };
  const source = map.getSource<GeoJSONSource>('selected-road');
  if (source) source.setData(geometry);
  else {
    map.addSource('selected-road', { type: 'geojson', data: geometry });
    map.addLayer({ id: 'selected-road-halo', type: 'line', source: 'selected-road',
      paint: { 'line-color': '#ffffff', 'line-width': 9, 'line-opacity': 0.85 },
      layout: { 'line-cap': 'round', 'line-join': 'round' } });
    map.addLayer({ id: 'selected-road-line', type: 'line', source: 'selected-road',
      paint: { 'line-color': '#253e34', 'line-width': 4 }, layout: { 'line-cap': 'round', 'line-join': 'round' } });
  }
  syncRoadVisibility();
}

function displayRoad(road: RoadDetails) {
  stateElement.className = `state-pill ${road.state}`;
  stateElement.textContent = labels[road.state];
  const percent = Math.max(0, Math.min(100, road.ratio * 100));
  contentElement.innerHTML = `<div class="speed-row"><div class="current-speed"><strong>${Math.round(road.speedKmh)}</strong><span>km/h<span class="metric-label">Current speed</span></span></div><div class="flow-speed"><strong>${Math.round(road.freeFlowKmh)}<span> km/h</span></strong><span class="metric-label">Free-flow speed</span></div></div><div class="speed-track" aria-hidden="true"><span class="${road.state}" style="width:${percent}%"></span></div><div class="road-meta"><span>${road.confidence < 0.5 ? 'Limited' : 'Provider'} confidence</span><span>${Math.round(road.confidence * 100)}%</span></div>`;
  element('road-message').textContent = `Fetched at ${clock(road.fetchedAt)} IST · Nearest observed segment`;
}

async function selectRoad(point: [number, number], name: string, move = false) {
  if (!containsPoint(point[1], point[0])) { setAlert('Select a road within the wider Kochi area.'); return; }
  selected = point; selectedName = name; latestRoad = undefined;
  drawRoad();
  if (move) map.easeTo({ center: point, zoom: Math.max(map.getZoom(), 13), duration: matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 650 });
  syncRoadVisibility();
  element('road-heading').textContent = name;
  element('road-context').textContent = `${point[1].toFixed(4)}° N, ${point[0].toFixed(4)}° E`;
  stateElement.className = 'state-pill loading'; stateElement.textContent = 'Loading';
  element('road-message').textContent = 'Loading current road conditions.';
  contentElement.innerHTML = '<div class="skeleton"></div><div class="skeleton short"></div>';
  const sequence = ++requestSequence;
  abortController?.abort(); abortController = new AbortController();
  try {
    const response = await fetch(`/api/flow?lat=${point[1]}&lon=${point[0]}`, { signal: abortController.signal });
    const body = await response.json();
    if (sequence !== requestSequence) return;
    if (!response.ok) {
      const messages: Record<string, string> = {
        RATE_LIMIT_REACHED: 'Traffic requests are arriving too quickly. Wait a moment, then refresh.',
        VISITOR_LIMIT_REACHED: 'Please wait a minute before refreshing again.',
        USAGE_LIMIT_REACHED: 'The shared traffic allowance or request rate has been reached. Try again later. Daily limits reset at 5:30 am IST.',
        QUOTA_UNAVAILABLE: 'Usage accounting is temporarily unavailable. Please try again later.',
        NO_ROAD_DATA: 'No current observation is available near this point. Try a nearby road.',
        PROVIDER_BUSY: 'Traffic service is busy. Wait a moment, then refresh.',
        LOCAL_USAGE_LIMIT: 'Traffic request limit reached. Please try again later.',
        OUTSIDE_KOCHI: 'Choose a road within the wider Kochi area.',
        PUBLIC_ACCESS_NOT_READY: 'Live traffic is temporarily unavailable.',
      };
      throw new Error(messages[body.error] ?? 'Road data is unavailable right now. Try again shortly.');
    }
    latestRoad = body as RoadDetails;
    displayRoad(latestRoad); drawRoad(latestRoad);
  } catch (error) {
    if (sequence !== requestSequence || abortController.signal.aborted) return;
    stateElement.className = 'state-pill unknown'; stateElement.textContent = 'Unavailable';
    contentElement.innerHTML = '<div class="empty-road">Road data unavailable.<br/><span>Try a nearby road or refresh.</span></div>';
    element('road-message').textContent = error instanceof Error ? error.message : 'Road data is unavailable.';
  }
}

for (const button of document.querySelectorAll<HTMLButtonElement>('[data-place]')) {
  button.addEventListener('click', () => {
    const place = places[Number(button.dataset.place)]!;
    for (const other of document.querySelectorAll<HTMLButtonElement>('[data-place]')) {
      other.classList.toggle('active', other === button); other.setAttribute('aria-pressed', String(other === button));
    }
    void selectRoad([...place.coordinates], place.name, true);
  });
}
map.on('click', event => {
  if (journey.consumeMapClick([event.lngLat.lng, event.lngLat.lat])) return;
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-place]')) {
    button.classList.remove('active'); button.setAttribute('aria-pressed', 'false');
  }
  void selectRoad([event.lngLat.lng, event.lngLat.lat], 'Selected road segment');
});
map.on('style.load', () => {
  mapReady = true;
  element<HTMLButtonElement>('refresh').disabled = false;
  element<HTMLButtonElement>('traffic-toggle').disabled = false;
  lastRefresh = Date.now(); statusElement.textContent = 'Traffic refreshes every 15 min';
  if (latestRoad) drawRoad(latestRoad);
  else void selectRoad(selected, selectedName);
});
map.on('error', event => {
  const limited = 'status' in event.error && event.error.status === 429;
  setAlert(limited ? 'The shared traffic allowance or request rate has been reached. Please try again later.' : 'Some map data could not load. Refresh to try again.');
  statusElement.textContent = limited ? 'Traffic service limit reached' : 'Map data partially unavailable';
});

element('traffic-toggle').addEventListener('click', () => {
  trafficEnabled = !trafficEnabled;
  map.setLayoutProperty('traffic', 'visibility', trafficEnabled ? 'visible' : 'none');
  element('traffic-toggle').setAttribute('aria-pressed', String(trafficEnabled));
});

async function refreshTraffic(reloadBase = false) {
  if (refreshBusy || document.hidden || !mapReady) return;
  refreshBusy = true;
  const button = element<HTMLButtonElement>('refresh');
  button.disabled = true; element('refresh-label').textContent = 'Refreshing…';
  setAlert();
  const source = map.getSource<RasterTileSource>('traffic');
  if (reloadBase) map.getSource<RasterTileSource>('basemap')?.setTiles([`${location.origin}/api/tiles/base/{z}/{x}/{y}.png?v=${Date.now()}`]);
  source?.setTiles([`${location.origin}/api/tiles/traffic/{z}/{x}/{y}.png?v=${Date.now()}`]);
  lastRefresh = Date.now();
  await selectRoad(selected, selectedName);
  statusElement.textContent = `Refresh requested ${clock(new Date(lastRefresh).toISOString())} IST`;
  button.disabled = false; element('refresh-label').textContent = 'Refresh traffic'; refreshBusy = false;
}
element('refresh').addEventListener('click', () => { void refreshTraffic(true); });
setInterval(() => { if (Date.now() - lastRefresh >= 900_000) void refreshTraffic(); }, 30_000);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && Date.now() - lastRefresh >= 900_000) void refreshTraffic();
});
