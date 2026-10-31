import test from "node:test";
import assert from "node:assert/strict";
import { handleApi } from "../src/server/api.ts";
import { normalizeAddresses, normalizeRoutes } from "../src/server/journey.ts";

const secret = "test-only-journey-secret";
const env = { TOMTOM_API_KEY: secret };
const local = (path) => new Request(`http://localhost:8787${path}`);
const query =
  "/api/routes?start=10.0261,76.3125&end=9.9658,76.3183&vehicle=car&departure=now";
const route = (mode = "car", time = Date.now()) => ({
  summary: {
    lengthInMeters: 8300,
    travelTimeInSeconds: 1200,
    departureTime: new Date(time).toISOString(),
    arrivalTime: new Date(time + 1_200_000).toISOString(),
  },
  sections: [{ sectionType: "TRAVEL_MODE", travelMode: mode }],
  legs: [
    {
      points: [
        { latitude: 10.0261, longitude: 76.3125 },
        { latitude: 9.9658, longitude: 76.3183 },
      ],
    },
  ],
  debug: secret,
});

test("invalid journey inputs never make upstream requests", async () => {
  const inputs = [
    query.replace("vehicle=car", "vehicle=bicycle"),
    query.replace("departure=now", "departure=tomorrow"),
    query.replace("10.0261", "20"),
    query.replace("10.0261,76.3125", "9.9658,76.3183"),
    query + "&key=override",
    query + "&vehicle=motorcycle",
    query.replace("start=10.0261", "start=NaN"),
    "/api/geocode?q=ab",
    "/api/geocode?q=%00secret",
    "/api/geocode?q=Kochi&url=https://example.com",
    "/api/geocode?q=Kochi&q=Aluva",
  ];
  for (const path of inputs) {
    let calls = 0;
    const response = await handleApi(
      local(path),
      env,
      async () => {
        calls++;
        throw new Error();
      },
      true,
    );
    assert.equal(response.status, 400, path);
    assert.equal(calls, 0);
  }
});

test("address results are restricted to local coordinates and allowlisted fields", async () => {
  const response = await handleApi(
    local("/api/geocode?q=Edappally"),
    env,
    async (url) => {
      assert.equal(url.origin, "https://api.tomtom.com");
      assert.equal(url.pathname, "/search/2/geocode/Edappally.json");
      assert.equal(url.searchParams.get("countrySet"), "IN");
      assert.equal(url.searchParams.get("topLeft"), "10.22,76.15");
      return Response.json({
        results: [
          {
            address: { freeformAddress: "Edappally, Kochi" },
            position: { lat: 10.0261, lon: 76.3125 },
            key: secret,
          },
          {
            address: { freeformAddress: "Elsewhere" },
            position: { lat: 20, lon: 76 },
          },
        ],
      });
    },
    true,
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    results: [{ label: "Edappally, Kochi", coordinates: [76.3125, 10.0261] }],
  });
  assert.deepEqual(normalizeAddresses({ results: [] }), []);
});

test("route proxy confirms motorcycle mode and a departure one hour ahead across midnight", async () => {
  const response = await handleApi(
    local(
      query
        .replace("vehicle=car", "vehicle=motorcycle")
        .replace("departure=now", "departure=hour"),
    ),
    env,
    async (url) => {
      assert.equal(url.searchParams.get("travelMode"), "motorcycle");
      assert.equal(url.searchParams.get("sectionType"), "travelMode");
      assert.equal(url.searchParams.get("traffic"), "true");
      assert.equal(url.searchParams.get("maxAlternatives"), "2");
      const time = Date.parse(url.searchParams.get("departAt"));
      assert.ok(Math.abs(time - Date.now() - 3_600_000) < 5000);
      return Response.json({
        routes: [route("motorcycle", time), route("motorcycle", time)],
      });
    },
    true,
  );
  assert.equal(response.status, 200);
  const text = await response.text();
  assert.ok(!text.includes(secret));
  const body = JSON.parse(text);
  assert.equal(body.routes.length, 2);
  assert.equal(body.vehicle, "motorcycle");
  const departure = Date.parse("2026-10-31T23:45:00+05:30");
  const normalized = normalizeRoutes(
    { routes: [route("car", departure + 3_600_000)] },
    "car",
    departure + 3_600_000,
  );
  assert.equal(normalized[0].departureTime, "2026-10-31T19:15:00.000Z");
});

test("malformed geometry, missing vehicle confirmation and wrong future time cannot become route estimates", () => {
  const now = Date.now();
  for (const modify of [
    (r) => {
      r.sections = [];
    },
    (r) => {
      r.sections[0].travelMode = "other";
    },
    (r) => {
      r.legs[0].points[0].latitude = null;
    },
    (r) => {
      r.summary.travelTimeInSeconds = -10;
    },
    (r) => {
      r.summary.departureTime = "invalid";
    },
    (r) => {
      r.summary.arrivalTime = new Date(now).toISOString();
    },
  ]) {
    const value = route("car", now);
    modify(value);
    assert.throws(() => normalizeRoutes({ routes: [value] }, "car", now));
  }
  assert.throws(() =>
    normalizeRoutes({ routes: [route("car", now)] }, "car", now + 3_600_000),
  );
});

test("empty routes and credential-bearing errors are sanitized", async () => {
  for (const [upstream, status, code] of [
    [Response.json({ routes: [] }), 404, "NO_ROUTE"],
    [new Response(secret, { status: 429 }), 429, "PROVIDER_BUSY"],
    [
      new Response(secret, { status: 403 }),
      503,
      "PROVIDER_AUTHORIZATION_FAILED",
    ],
  ]) {
    const response = await handleApi(
      local(query),
      env,
      async () => upstream,
      true,
    );
    assert.equal(response.status, status);
    assert.deepEqual(await response.json(), { error: code });
  }
});

test("public route and address access stays disabled until durable quotas exist", async () => {
  for (const path of [query, "/api/geocode?q=Aluva"]) {
    const response = await handleApi(
      new Request(`https://example.com${path}`),
      env,
      async () => {
        throw new Error(secret);
      },
    );
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), {
      error: "PUBLIC_ACCESS_NOT_READY",
    });
  }
});
