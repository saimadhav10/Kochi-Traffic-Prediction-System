# Configuration and provider access

Checked October 29, 2026. Local configuration, Cloudflare CLI authentication, and technical TomTom capability checks are working. Account-specific free allowances and billing/overage settings still require confirmation in the account dashboards.

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
| Configuration and provider validation tests | 11 passed |
| Traffic samples: central Kochi, Kakkanad, Kalamassery, Aluva, Tripunithura | 5 passed |
| Basemap and traffic raster tiles | 2 passed |
| Kochi address geocoding | Passed |
| Edappally–Vyttila and Kakkanad–Aluva, both vehicle modes, both departure options | 8 passed |
| Requested vehicle-mode sections and future departure timestamps | Confirmed in sample route responses |
| Cloudflare CLI identity | Authenticated |
| Current TomTom key in non-ignored files and fresh Git history | No matches found |
| Local secret file ignore rules | Verified |

The first concurrent live check encountered two HTTP 429 routing responses. The tool now runs sequentially with a minimum gap between requests; the subsequent full 16-request run passed. This does not guarantee future availability or remove account quota limits.

The current credential is kept in a local file rather than source or browser code. This scan does not assess account usage outside this project or guarantee that a credential can never be exposed.

## Remaining checks before public deployment

- Confirm actual TomTom product allowances, request charging, reset cycle, and billing/overage behavior, and confirm Cloudflare Workers Free access.
- Check provider caching permissions before enabling caching or retaining historical observations.
- Add the light map, selected-road details, routes, durable quota enforcement, and deployment checks from [PLAN.md](PLAN.md).

## Tool references

- [Cloudflare local environment variables and secrets](https://developers.cloudflare.com/workers/local-development/environment-variables/)
- [TomTom routing](https://docs.tomtom.com/routing-api/documentation/tomtom-maps/v1/calculate-route)
- [Node environment-file parser](https://nodejs.org/api/util.html#utilparseenvcontent)
