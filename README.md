# Kochi Traffic Prediction System

A fresh public, non-commercial traffic project for wider Kochi, including Kakkanad, Kalamassery, Aluva, and Tripunithura.

**[Open Kochi Traffic](https://kochi-traffic.saimadhav.workers.dev/)**

## Agreed scope

- Live road colors, speeds, and congestion on a clean, light map.
- Traffic updates every 10–15 minutes while the application is visible.
- Car and motorized two-wheeler routes with available alternatives.
- Journey estimates for departure now or one hour ahead.
- A simple route panel for phones and desktop.
- Free APIs and hosting, with enforced usage limits.

## Project status

The application is public on Cloudflare Workers. Choose addresses or map points, select a car or two-wheeler, and compare available routes for departure now or in one hour. Routes include distance, duration, and departure/arrival times in IST. Optional device location is requested only when selected. Durable quota enforcement is active. All 35 tests, the build, type checks, live deployment checks, and desktop/mobile browser checks pass.

- [Requirements](REQUIREMENTS.md)
- [Implementation plan](PLAN.md)
- [Setup and verification](SETUP.md)

Public API requests reserve usage atomically in Cloudflare D1 before contacting TomTom. Daily caps, a conservative rolling window, and burst limits apply across deployed instances. If accounting is unavailable, provider requests stop. The browser receives normalized data and images; the TomTom key stays in the Worker's encrypted secrets. See [About & privacy](https://kochi-traffic.saimadhav.workers.dev/about).

The stack is TypeScript with MapLibre GL JS, TomTom maps/traffic/routing/geocoding, and Cloudflare Workers with Static Assets and D1 quota counters. A citywide future congestion map and a custom forecasting model are later work.
