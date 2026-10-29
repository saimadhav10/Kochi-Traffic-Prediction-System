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

Requirements and the implementation plan are retained. The application will be rebuilt from scratch in this repository on `main`. This starting commit contains no application code, old datasets, trained models, or credentials.

- [Requirements](REQUIREMENTS.md)
- [Implementation plan](PLAN.md)

The next step is configuration and provider verification using a project-owned TomTom key and Cloudflare account. Copy `.env.example` to `.env` when configuring the project; enter credentials locally and never commit them.

The planned stack is TypeScript with MapLibre GL JS, TomTom maps/traffic/routing/geocoding, and Cloudflare Workers with Static Assets and D1 quota counters. A citywide future congestion map and a custom forecasting model are later work.
