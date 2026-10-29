# Kochi Traffic Prediction System

A fresh public, non-commercial traffic project for wider Kochi, including Kakkanad, Kalamassery, Aluva, and Tripunithura.

## Agreed scope

- Live road colors, speeds, and congestion on a clean, light map.
- Traffic updates every 10–15 minutes while the application is visible.
- Car and motorized two-wheeler routes with available alternatives.
- Journey estimates for departure now or one hour ahead.
- A simple route panel for phones and desktop.
- Free APIs and hosting, with enforced usage limits.

## Project status

Requirements and the implementation plan are retained. The application is being built from scratch in this repository on `main`. The live map, traffic layer, area shortcuts, and selected-road speeds now work in a local preview. Route planning, durable account-wide quotas, and public deployment are the next milestones.

- [Requirements](REQUIREMENTS.md)
- [Implementation plan](PLAN.md)
- [Setup and verification](SETUP.md)

Use Node.js 22.12 or newer:

```powershell
rtk proxy npm.cmd ci
rtk proxy npm.cmd run setup
rtk proxy npm.cmd test
rtk proxy npm.cmd run build
rtk proxy npm.cmd run dev
```

Enter your own TomTom key in the ignored `.env` file, then run `rtk proxy npm.cmd run verify:provider` for live checks. These consume API allowance. Authenticate Cloudflare with `rtk proxy npm.cmd run cloudflare:login`. Keep real credentials local and server-side; never commit them.

Open `http://127.0.0.1:8787` after starting the local preview. The browser receives map images and normalized road data from the server; it never receives the TomTom key. The preview is bound to loopback only. Build again and reload the browser after frontend changes; restart the preview after server or environment changes.

The Cloudflare Worker adapter is included, with public provider access disabled until durable quotas are implemented. The local preview uses the same API handler under Node because this machine's local `workerd` runtime could not make outbound provider requests. Cloudflare production networking still needs verification before release.

The planned stack is TypeScript with MapLibre GL JS, TomTom maps/traffic/routing/geocoding, and Cloudflare Workers with Static Assets and D1 quota counters. A citywide future congestion map and a custom forecasting model are later work.
