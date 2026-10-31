import * as maplibregl from "maplibre-gl";
import type { GeoJSONSource } from "maplibre-gl";
import { containsPoint } from "../shared/region.ts";
import type { AddressMatch, JourneyResult } from "../shared/journey.ts";

export const journeyPanel = `
  <nav class="explorer-tabs" aria-label="Map tools"><button id="plan-tab" aria-pressed="true">Plan a route</button><button id="explore-tab" aria-pressed="false">Explore traffic</button></nav>
  <section id="journey-panel" class="journey-card" aria-labelledby="journey-heading">
    <div class="eyebrow">YOUR NEXT JOURNEY</div><h1 id="journey-heading">A clearer way<br/>through Kochi<span class="accent">.</span></h1>
    <p class="journey-copy">Find your route, with traffic in mind.</p>
    <form id="journey-form">
      ${(["start", "end"] as const)
        .map(
          (
            name,
            i,
          ) => `<div class="endpoint"><label for="${name}-address"><span class="endpoint-letter">${i ? "B" : "A"}</span>${i ? "Destination" : "Start"}</label>
        <div class="address-row"><input id="${name}-address" type="search" maxlength="160" autocomplete="off" placeholder="Address or area in Kochi"/><button type="button" id="${name}-search" aria-label="Search ${i ? "destination" : "start"} address">Search</button></div>
        <div class="endpoint-actions"><button type="button" id="${name}-pin" aria-pressed="false">Choose on map</button>${i ? "" : '<button type="button" id="use-location">Use my location</button>'}</div>
        <div id="${name}-results" class="address-results" aria-label="${i ? "Destination" : "Start"} search results"></div>
      </div>`,
        )
        .join("")}
      <div class="journey-options"><label for="vehicle">Travel by<select id="vehicle"><option value="car">Car</option><option value="motorcycle">Two-wheeler</option></select></label><label for="departure">Departure<select id="departure"><option value="now">Leave now</option><option value="hour">In one hour</option></select></label></div>
      <p id="vehicle-note" class="journey-note" hidden>TomTom motorcycle routing is experimental; restriction coverage may be incomplete.</p>
      <button id="find-routes" class="primary-button" type="submit">Find routes <span aria-hidden="true">→</span></button>
    </form>
    <p id="journey-status" class="journey-status" role="status" aria-live="polite">Search for addresses or choose two points on the map.</p>
    <div id="journey-results" class="journey-results" aria-label="Route options"></div>
  </section>`;

type Endpoint = "start" | "end";
const el = <T extends HTMLElement = HTMLElement>(id: string) =>
  document.getElementById(id) as T;
const input = (name: Endpoint) => el<HTMLInputElement>(`${name}-address`);
const clock = (iso: string) =>
  new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(iso));
const minutes = (seconds: number) =>
  `${Math.max(1, Math.round(seconds / 60))} min`;
const errors: Record<string, string> = {
  NO_ROUTE: "No drivable route was found for these points. Try a nearby road.",
  VEHICLE_UNAVAILABLE:
    "The provider could not confirm this vehicle mode along the route. Try different points.",
  OUTSIDE_KOCHI: "Choose both points within the wider Kochi area.",
  POINTS_TOO_CLOSE: "Choose a destination farther from your start.",
  PROVIDER_BUSY: "The route service is busy. Wait a moment, then try again.",
  LOCAL_USAGE_LIMIT:
    "The local request limit has been reached. Please try again later.",
};

export function setupJourney(map: maplibregl.Map, onPanelChange: () => void) {
  const endpoints: Partial<Record<Endpoint, AddressMatch>> = {};
  const markers: Partial<Record<Endpoint, maplibregl.Marker>> = {};
  const searchRequests: Partial<Record<Endpoint, AbortController>> = {};
  let picking: Endpoint | undefined;
  let routeRequest: AbortController | undefined;
  let locationSequence = 0;
  let result: JourneyResult | undefined;
  let selectedIndex = 0;
  let styleReady = false;
  const status = (message: string) => {
    el("journey-status").textContent = message;
  };
  const reduceMotion = () =>
    matchMedia("(prefers-reduced-motion: reduce)").matches;

  function drawRoutes() {
    if (!styleReady) return;
    const data = {
      type: "FeatureCollection" as const,
      features: (result?.routes ?? [])
        .map((route, index) => ({
          type: "Feature" as const,
          properties: { selected: index === selectedIndex },
          geometry: {
            type: "LineString" as const,
            coordinates: route.coordinates,
          },
        }))
        .sort(
          (a, b) =>
            Number(a.properties.selected) - Number(b.properties.selected),
        ),
    };
    const source = map.getSource<GeoJSONSource>("journeys");
    if (source) source.setData(data);
    else {
      map.addSource("journeys", { type: "geojson", data });
      map.addLayer({
        id: "journey-halo",
        type: "line",
        source: "journeys",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": "#fff", "line-width": 10, "line-opacity": 0.9 },
      });
      map.addLayer({
        id: "journey-lines",
        type: "line",
        source: "journeys",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": ["case", ["get", "selected"], "#28553e", "#95a894"],
          "line-width": ["case", ["get", "selected"], 6, 4],
        },
      });
    }
  }
  map.on("style.load", () => {
    styleReady = true;
    drawRoutes();
  });

  function invalidate() {
    routeRequest?.abort();
    routeRequest = undefined;
    result = undefined;
    el("journey-results").replaceChildren();
    drawRoutes();
    el<HTMLButtonElement>("find-routes").disabled = false;
    el("find-routes").textContent = "Find routes →";
    status("Trip changed. Find routes for an updated estimate.");
  }
  function cancelPicking() {
    picking = undefined;
    for (const name of ["start", "end"])
      el(`${name}-pin`).setAttribute("aria-pressed", "false");
    map.getCanvas().style.cursor = "";
  }
  function setEndpoint(name: Endpoint, match: AddressMatch, move = true) {
    if (name === "start") locationSequence++;
    searchRequests[name]?.abort();
    endpoints[name] = match;
    input(name).value = match.label;
    el(`${name}-results`).replaceChildren();
    markers[name]?.remove();
    const marker = document.createElement("div");
    marker.className = `endpoint-marker ${name}`;
    marker.textContent = name === "start" ? "A" : "B";
    marker.setAttribute(
      "aria-label",
      `${name === "start" ? "Start" : "Destination"}: ${match.label}`,
    );
    markers[name] = new maplibregl.Marker({ element: marker })
      .setLngLat(match.coordinates)
      .addTo(map);
    invalidate();
    cancelPicking();
    status(
      `${name === "start" ? "Start" : "Destination"} selected. ${endpoints.start && endpoints.end ? "Ready to find routes." : "Choose the other point."}`,
    );
    if (move)
      map.easeTo({
        center: match.coordinates,
        zoom: Math.max(map.getZoom(), 13),
        duration: reduceMotion() ? 0 : 500,
      });
  }
  async function search(name: Endpoint) {
    const query = input(name).value.trim();
    if (query.length < 3) {
      status("Enter at least three characters to search for an address.");
      input(name).focus();
      return;
    }
    if (name === "start") locationSequence++;
    cancelPicking();
    searchRequests[name]?.abort();
    const controller = new AbortController();
    searchRequests[name] = controller;
    const container = el(`${name}-results`);
    container.replaceChildren();
    status(
      `Searching ${name === "start" ? "start" : "destination"} addresses…`,
    );
    try {
      const response = await fetch(
        `/api/geocode?${new URLSearchParams({ q: query })}`,
        { signal: controller.signal },
      );
      const body = await response.json();
      if (controller.signal.aborted) return;
      if (!response.ok)
        throw new Error(
          errors[body.error] ??
            "Address search is unavailable. Try again or choose a map point.",
        );
      const matches = body.results as AddressMatch[];
      for (const match of matches) {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = match.label;
        button.addEventListener("click", () => setEndpoint(name, match));
        container.append(button);
      }
      status(
        matches.length
          ? "Choose a matching address below the search field."
          : "No local address found. Try an area or street name, or choose on the map.",
      );
    } catch (error) {
      if (!controller.signal.aborted)
        status(
          error instanceof Error
            ? error.message
            : "Address search is unavailable.",
        );
    }
  }
  for (const name of ["start", "end"] as const) {
    el(`${name}-search`).addEventListener("click", () => {
      void search(name);
    });
    input(name).addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        void search(name);
      }
    });
    input(name).addEventListener("input", () => {
      if (name === "start") locationSequence++;
      searchRequests[name]?.abort();
      delete endpoints[name];
      markers[name]?.remove();
      el(`${name}-results`).replaceChildren();
      invalidate();
    });
    el(`${name}-pin`).addEventListener("click", () => {
      if (name === "start") locationSequence++;
      const wasPicking = picking === name;
      cancelPicking();
      if (wasPicking) {
        status("Map selection cancelled.");
        return;
      }
      picking = name;
      el(`${name}-pin`).setAttribute("aria-pressed", "true");
      map.getCanvas().style.cursor = "crosshair";
      status(
        `Click the map to set your ${name === "start" ? "start" : "destination"}. Press Escape to cancel.`,
      );
      if (matchMedia("(max-width: 700px)").matches)
        el("map").scrollIntoView({
          behavior: reduceMotion() ? "instant" : "smooth",
          block: "start",
        });
    });
  }
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && picking) {
      cancelPicking();
      status("Map selection cancelled.");
    }
  });
  el("use-location").addEventListener("click", () => {
    if (!navigator.geolocation) {
      status(
        "Location is unavailable in this browser. Search or choose a map point.",
      );
      return;
    }
    const sequence = ++locationSequence;
    status("Waiting for location permission…");
    navigator.geolocation.getCurrentPosition(
      (position) => {
        if (sequence !== locationSequence) return;
        const { latitude, longitude } = position.coords;
        if (!containsPoint(latitude, longitude)) {
          status(
            "Your location is outside wider Kochi. Choose a local start point.",
          );
          return;
        }
        setEndpoint("start", {
          label: "My location",
          coordinates: [longitude, latitude],
        });
      },
      () => {
        if (sequence === locationSequence)
          status(
            "Location could not be obtained. Search or choose a map point.",
          );
      },
      { timeout: 10_000, maximumAge: 60_000 },
    );
  });
  for (const id of ["vehicle", "departure"])
    el(id).addEventListener("change", () => {
      el("vehicle-note").hidden =
        el<HTMLSelectElement>("vehicle").value !== "motorcycle";
      invalidate();
    });

  function showRoute(index: number, fit = true) {
    selectedIndex = index;
    drawRoutes();
    for (const button of el(
      "journey-results",
    ).querySelectorAll<HTMLButtonElement>("button"))
      button.setAttribute(
        "aria-pressed",
        String(Number(button.dataset.route) === index),
      );
    if (!fit || !result) return;
    const route = result.routes[index];
    const box = route.coordinates.reduce(
      (bounds, point) => bounds.extend(point),
      new maplibregl.LngLatBounds(route.coordinates[0], route.coordinates[0]),
    );
    map.fitBounds(box, {
      padding: matchMedia("(max-width: 700px)").matches
        ? { top: 50, right: 45, bottom: 90, left: 45 }
        : {
            top: 85,
            right: 75,
            bottom: 140,
            left: el("journey-panel").getBoundingClientRect().width + 70,
          },
      maxZoom: 15,
      duration: reduceMotion() ? 0 : 600,
    });
  }
  el("journey-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    cancelPicking();
    const start = endpoints.start,
      end = endpoints.end;
    if (!start || !end) {
      status(
        "Select both a start and destination from search results or the map.",
      );
      return;
    }
    invalidate();
    const controller = new AbortController();
    routeRequest = controller;
    el<HTMLButtonElement>("find-routes").disabled = true;
    el("find-routes").textContent = "Finding routes…";
    const vehicle = el<HTMLSelectElement>("vehicle").value,
      departure = el<HTMLSelectElement>("departure").value;
    status("Checking routes and traffic estimates…");
    const params = new URLSearchParams({
      start: `${start.coordinates[1]},${start.coordinates[0]}`,
      end: `${end.coordinates[1]},${end.coordinates[0]}`,
      vehicle,
      departure,
    });
    try {
      const response = await fetch(`/api/routes?${params}`, {
        signal: controller.signal,
      });
      const body = await response.json();
      if (controller.signal.aborted) return;
      if (!response.ok)
        throw new Error(
          errors[body.error] ??
            "Route estimates are unavailable right now. Please try again.",
        );
      result = body as JourneyResult;
      const container = el("journey-results");
      result.routes.forEach((route, index) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "route-option";
        button.dataset.route = String(index);
        button.innerHTML = `<span class="route-option-top"><strong>${index === 0 ? "Recommended" : `Alternative ${index}`}</strong><span>${minutes(route.durationS)}</span></span><span class="route-option-meta">${(route.distanceM / 1000).toFixed(1)} km · Leave ${clock(route.departureTime)} · Arrive ${clock(route.arrivalTime)} IST</span>`;
        button.addEventListener("click", () => showRoute(index));
        container.append(button);
      });
      showRoute(0);
      status(
        `${departure === "hour" ? "One-hour-ahead estimate" : "Current departure estimate"} · Fetched ${clock(result.fetchedAt)} IST. ${result.routes.length === 1 ? "No alternative returned." : "Select a route to highlight it."} Estimates can change.`,
      );
      container.scrollIntoView({
        block: "nearest",
        behavior: reduceMotion() ? "instant" : "smooth",
      });
    } catch (error) {
      if (!controller.signal.aborted)
        status(
          error instanceof Error
            ? error.message
            : "Route estimates are unavailable.",
        );
    } finally {
      if (routeRequest === controller) {
        el<HTMLButtonElement>("find-routes").disabled = false;
        el("find-routes").textContent = "Find routes →";
      }
    }
  });

  function switchPanel(plan: boolean) {
    el("journey-panel").hidden = !plan;
    el("plan-tab").setAttribute("aria-pressed", String(plan));
    el("explore-tab").setAttribute("aria-pressed", String(!plan));
    for (const panel of document.querySelectorAll<HTMLElement>(
      "[data-explore]",
    ))
      panel.hidden = plan;
    if (!plan) cancelPicking();
    onPanelChange();
  }
  el("plan-tab").addEventListener("click", () => switchPanel(true));
  el("explore-tab").addEventListener("click", () => switchPanel(false));
  switchPanel(true);
  return {
    consumeMapClick(point: [number, number]) {
      if (!picking) {
        switchPanel(false);
        return false;
      }
      if (!containsPoint(point[1], point[0])) {
        status("Choose a point within wider Kochi.");
        return true;
      }
      const name = picking;
      setEndpoint(
        name,
        {
          label: `${point[1].toFixed(5)}, ${point[0].toFixed(5)}`,
          coordinates: point,
        },
        false,
      );
      return true;
    },
  };
}
