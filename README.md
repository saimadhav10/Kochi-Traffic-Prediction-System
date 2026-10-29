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

Requirements and the implementation plan are retained. The application is being built from scratch in this repository on `main`. Local setup scripts, automated tests, and a TomTom provider check are implemented. The public map and routing interface are the next milestone.

- [Requirements](REQUIREMENTS.md)
- [Implementation plan](PLAN.md)
- [Setup and verification](SETUP.md)

Use Node.js 22.12 or newer:

```powershell
rtk proxy npm.cmd ci
rtk proxy npm.cmd run setup
rtk proxy npm.cmd test
```

Enter your own TomTom key in the ignored `.env` file, then run `rtk proxy npm.cmd run verify:provider` for live checks. These consume API allowance. Authenticate Cloudflare with `rtk proxy npm.cmd run cloudflare:login`. Keep real credentials local and server-side; never commit them.

The planned stack is TypeScript with MapLibre GL JS, TomTom maps/traffic/routing/geocoding, and Cloudflare Workers with Static Assets and D1 quota counters. A citywide future congestion map and a custom forecasting model are later work.
