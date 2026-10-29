# Kochi Traffic Prediction System — requirements

Agreed October 29, 2026. These requirements carry forward into the fresh repository.

## Purpose and audience

A public, free, non-commercial web application that helps people view current traffic in Kochi and compare routes. The experience is a map of road conditions, speeds, and congestion.

## Geographic coverage

Cover the wider Kochi urban area from the first release, including Kakkanad, Kalamassery, Aluva, and Tripunithura. Display provider observations where available. Missing data is unknown and must not be presented as clear traffic.

## Required capabilities

1. Show live congestion colors across provider-covered roads on a map.
2. Show provider-reported speeds and congestion details for a selected road.
3. Refresh traffic every 10–15 minutes while the application is visible.
4. Allow origin and destination selection and suggest routes with available alternatives.
5. Support cars and motorized two-wheelers. Explain unsupported vehicle-mode sections rather than silently substituting car routes.
6. Estimate travel for departure now or one hour ahead, showing distance, estimated journey duration, and departure/arrival times.
7. Keep the current traffic layer's time distinct from future-departure route estimates.
8. Use a clean, light map and a simple route panel, responsive on phones and desktop.

One-hour departure route estimates satisfy the initial forecasting requirement. A citywide future congestion map and a custom forecasting model are later work.

## Constraints and quality

- Free APIs and free hosting, with no automatic paid overages. The service can be limited when free allowances are exhausted.
- Keep API credentials server-side, in ignored local environment files and deployment secrets.
- Use km/h and Asia/Kolkata times. Distinguish app fetch time from provider observation time.
- Provide readable attribution, an accessible congestion legend, keyboard-operable controls, and clear missing-data, loading, error, stale-data, and quota-limit states.
- Preserve data age when displaying retained data; use caching only where permitted by provider terms.
- Avoid unsupported claims about coverage or forecast accuracy.

## Initial release target

October 30, 2026 is the requested target, conditional on account setup, provider access, implementation, and launch checks. It is not a guaranteed completion date.

## Later work

A citywide one-hour congestion layer, a validated custom prediction model, historical analytics, weather-based modeling, saved trips, and additional languages.
