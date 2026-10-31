import { loadSettings } from "./environment.mjs";
const origin = "https://kochi-traffic.gamereviews-saimadhav10.workers.dev";
const settings = loadSettings();
const secrets = [settings.TOMTOM_API_KEY, settings.QUOTA_SALT].filter(Boolean);
const pause = () => new Promise((resolve) => setTimeout(resolve, 1150));
let failed = 0;
async function check(
  name,
  path,
  expected = 200,
  verify = () => true,
  headers = {},
) {
  try {
    const response = await fetch(origin + path, {
      headers,
      redirect: "error",
      signal: AbortSignal.timeout(20_000),
    });
    const bytes = Buffer.from(await response.arrayBuffer());
    const clean = !secrets.some(
      (value) =>
        bytes.includes(Buffer.from(value)) ||
        bytes.includes(Buffer.from(encodeURIComponent(value))),
    );
    const ok = response.status === expected && clean && verify(bytes, response);
    if (!ok) failed++;
    console.log(`${ok ? "PASS" : "FAIL"} ${name}: HTTP ${response.status}`);
    return ok ? bytes : undefined;
  } catch {
    failed++;
    console.log(`FAIL ${name}: network or invalid response`);
  }
}
const html = await check("public application", "/", 200, (bytes) =>
  bytes.toString().includes("Kochi Traffic"),
);
await check("about and privacy", "/about");
await check(
  "configured service",
  "/api/status",
  200,
  (bytes) => JSON.parse(bytes).available === true,
);
for (const path of [
  "/.env",
  "/.env.local",
  "/src/server/api.ts",
  "/wrangler.jsonc",
])
  await check("private file boundary", path, 404);
await check("outside area", "/api/flow?lat=20&lon=76.3", 400);
await check(
  "cross-site request",
  "/api/flow?lat=9.98&lon=76.3",
  403,
  () => true,
  { Origin: "https://other.example" },
);
if (html) {
  for (const match of html
    .toString()
    .matchAll(/(?:src|href)="(\/assets\/[^"<>]+)"/g))
    await check("public asset credential scan", match[1]);
}
for (const [name, lat, lon] of [
  ["Central Kochi", 9.9816, 76.2999],
  ["Kakkanad", 10.015, 76.3417],
  ["Kalamassery", 10.0526, 76.3158],
  ["Aluva", 10.1076, 76.3516],
  ["Tripunithura", 9.9493, 76.3474],
]) {
  await pause();
  await check(
    `live road ${name}`,
    `/api/flow?lat=${lat}&lon=${lon}`,
    200,
    (bytes) => {
      const road = JSON.parse(bytes);
      return (
        Number.isFinite(road.speedKmh) &&
        road.freeFlowKmh > 0 &&
        road.coordinates.length >= 2
      );
    },
  );
}
await check(
  "local address lookup",
  "/api/geocode?q=Edappally",
  200,
  (bytes) => JSON.parse(bytes).results.length > 0,
);
for (const vehicle of ["car", "motorcycle"])
  for (const departure of ["now", "hour"]) {
    await pause();
    await check(
      `${vehicle} routes ${departure}`,
      `/api/routes?start=10.0261,76.3125&end=9.9658,76.3183&vehicle=${vehicle}&departure=${departure}`,
      200,
      (bytes) => {
        const result = JSON.parse(bytes);
        return (
          result.vehicle === vehicle &&
          result.departure === departure &&
          result.routes.length > 0 &&
          result.routes.every(
            (route) => route.distanceM > 0 && route.durationS > 0,
          )
        );
      },
    );
  }
const z = 12,
  scale = 2 ** z,
  x = Math.floor(((76.2999 + 180) / 360) * scale),
  y = Math.floor(
    ((1 - Math.asinh(Math.tan((9.9816 * Math.PI) / 180)) / Math.PI) / 2) *
      scale,
  );
for (const product of ["base", "traffic"])
  await check(
    `${product} map image`,
    `/api/tiles/${product}/${z}/${x}/${y}.png`,
    200,
    (bytes) =>
      [137, 80, 78, 71, 13, 10, 26, 10].every(
        (value, index) => bytes[index] === value,
      ),
  );
console.log(
  failed
    ? `${failed} deployment checks failed.`
    : "All deployment checks passed.",
);
process.exitCode = failed ? 1 : 0;
