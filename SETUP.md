# Configuration and provider access

Checked October 29, 2026. Local configuration, Cloudflare CLI authentication, and technical TomTom capability checks are working. Account-specific free allowances and billing/overage settings still require confirmation in the account dashboards.

## Live map preview

```powershell
rtk proxy npm.cmd run typecheck
rtk proxy npm.cmd test
rtk proxy npm.cmd run build
rtk proxy npm.cmd run dev
```

Open `http://127.0.0.1:8787`. The light map includes current traffic colors, five area shortcuts, selectable roads, current/free-flow speeds, provider confidence, fetch time in IST, a traffic-layer switch, and refresh controls. Traffic refreshes on a 15-minute cadence while visible; selected roads are fetched on demand. Missing observations are shown as unavailable.

The Node preview binds only to `127.0.0.1` and calls the same Web-standard API handler used by the Cloudflare Worker adapter. Only the server reads `.env`; the browser calls restricted `/api/tiles/...` and `/api/flow` endpoints on the same origin. Requests outside the operating bounds, unexpected parameters, arbitrary proxy targets, invalid tiles, and non-GET API methods are rejected. Provider response fields and error bodies are not passed through wholesale. Browser responses contain no credentials.

Provider access is explicitly disabled in the production adapter until durable account-wide quotas exist; changing a Host header cannot enable it. The Node preview grants local access explicitly and has conservative per-process request and queue ceilings. These local ceilings are not production quota enforcement.

The local Cloudflare `workerd` runtime rejected outbound provider fetches on this machine while Node's verified HTTPS requests succeeded. No certificate checks were disabled. Use `npm run dev:worker` to investigate the Cloudflare runtime separately after building; it does not enable upstream access. The Node preview supports UI verification, but Cloudflare production networking must still be tested before release.

MapLibre's rendering worker is bundled as a same-origin asset, and the page's content security policy restricts connections and scripts to this application. The production build emits a MapLibre bundle-size advisory (about 297 kB gzip for the main JavaScript bundle); the build succeeds.

## Local setup

Use Node.js 22.12 or newer. Install the pinned tooling, then create the ignored local environment file without overwriting an existing one:

```powershell
rtk proxy npm.cmd ci
rtk proxy npm.cmd run setup
```

Set `TOMTOM_API_KEY` in `.env` to a key from your own TomTom account. Never put the key in chat or command arguments. `.env.local` overrides `.env`, and process environment values override both. Dollar signs are treated literally. The tools detect a conflicting `.dev.vars` file so they do not accidentally test a different key from the one Wrangler loads.

The local environment files, dependency folder, Wrangler state, and `*.local.json` reports are ignored by Git. Only the blank `.env.example` template belongs in the repository.

## Cloudflare access

```powershell
rtk proxy npm.cmd run cloudflare:login
rtk proxy npm.cmd run cloudflare:status
```

Complete the login and consent in your own browser. The CLI stores its authentication in the user's Wrangler configuration outside this repository. The project commands disable Wrangler usage metrics. Do not copy that authentication file or its contents into the project or chat.

Cloudflare authentication was confirmed with Workers and D1 access. No public application, paid resource, or deployment was created during this setup step. Dashboard verification of the account's free plan remains outstanding.

## Verification

```powershell
rtk proxy npm.cmd test
rtk proxy npm.cmd run verify:provider
```

Automated tests use mocked provider responses and do not consume API requests. The live check uses up to 16 read-only TomTom requests, spaced at least 1.1 seconds apart, and consumes account allowance. It checks five traffic samples, basemap/traffic raster tiles, a local address lookup, and two cross-area journeys for both car and motorcycle, departing now and one hour ahead.

The client restricts calls to `https://api.tomtom.com`, rejects redirects, and applies request timeouts. It does not print request URLs, credential values, provider response bodies, or raw network exceptions. Initial authentication/product-access or rate-limit rejection stops subsequent checks. A failure is reported rather than silently converted into usable traffic.

The normalized report is written to ignored `provider-check.local.json`. It records technical capability results; it does not assert account ownership, free entitlement, or journey-time accuracy. It is a readiness report, not a traffic archive.

## Observed results

| Check | Result |
| --- | --- |
| Configuration, provider, and server-boundary tests | 17 passed |
| Traffic samples: central Kochi, Kakkanad, Kalamassery, Aluva, Tripunithura | 5 passed |
| Basemap and traffic raster tiles | 2 passed |
| Kochi address geocoding | Passed |
| Edappally–Vyttila and Kakkanad–Aluva, both vehicle modes, both departure options | 8 passed |
| Requested vehicle-mode sections and future departure timestamps | Confirmed in sample route responses |
| Cloudflare CLI identity | Authenticated |
| Current TomTom key in non-ignored files and fresh Git history | No matches found |
| Local secret file ignore rules | Verified |
| Browser build scan for the current key | No matches found |
| Desktop/mobile area navigation, traffic toggle and live road display | Inspected in browser |

The first concurrent live check encountered two HTTP 429 routing responses. The tool now runs sequentially with a minimum gap between requests; the subsequent full 16-request run passed. This does not guarantee future availability or remove account quota limits.

The current credential is kept in a local file rather than source or browser code. This scan does not assess account usage outside this project or guarantee that a credential can never be exposed.

## Remaining checks before public deployment

- Confirm actual TomTom product allowances, request charging, reset cycle, and billing/overage behavior, and confirm Cloudflare Workers Free access.
- Check provider caching permissions before enabling caching or retaining historical observations.
- Add routes, durable quota enforcement, and deployment checks from [PLAN.md](PLAN.md). The map and selected-road details are implemented locally.

## Tool references

- [Cloudflare local environment variables and secrets](https://developers.cloudflare.com/workers/local-development/environment-variables/)
- [TomTom routing](https://docs.tomtom.com/routing-api/documentation/tomtom-maps/v1/calculate-route)
- [Node environment-file parser](https://nodejs.org/api/util.html#utilparseenvcontent)
