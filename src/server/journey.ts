import { containsPoint } from "../shared/region.ts";
import type { AddressMatch, JourneyRoute, Vehicle } from "../shared/journey.ts";

const record = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
const positive = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value > 0;

export function normalizeAddresses(payload: unknown): AddressMatch[] {
  const results = record(payload).results;
  if (!Array.isArray(results)) throw new Error("PROVIDER_INVALID_RESPONSE");
  return results
    .slice(0, 10)
    .flatMap((value) => {
      const result = record(value),
        position = record(result.position),
        address = record(result.address);
      const lat = position.lat,
        lon = position.lon,
        label = address.freeformAddress;
      if (
        typeof lat !== "number" ||
        typeof lon !== "number" ||
        !containsPoint(lat, lon) ||
        typeof label !== "string" ||
        !label.trim() ||
        label.length > 500
      )
        return [];
      return [
        { label: label.trim(), coordinates: [lon, lat] as [number, number] },
      ];
    })
    .slice(0, 5);
}

export function normalizeRoutes(
  payload: unknown,
  vehicle: Vehicle,
  requestedTime: number,
  timeTolerance = 2_000,
): JourneyRoute[] {
  const routes = record(payload).routes;
  if (!Array.isArray(routes) || !routes.length) throw new Error("NO_ROUTE");
  if (routes.length > 3) throw new Error("PROVIDER_INVALID_RESPONSE");
  return routes.map((value) => {
    const route = record(value),
      summary = record(route.summary);
    const sections = Array.isArray(route.sections)
      ? route.sections
          .map(record)
          .filter((section) => section.sectionType === "TRAVEL_MODE")
      : [];
    if (
      !sections.length ||
      sections.some((section) => section.travelMode !== vehicle)
    )
      throw new Error("VEHICLE_UNAVAILABLE");
    const distance = summary.lengthInMeters,
      duration = summary.travelTimeInSeconds;
    const departure = summary.departureTime,
      arrival = summary.arrivalTime;
    if (
      !positive(distance) ||
      !positive(duration) ||
      typeof departure !== "string" ||
      typeof arrival !== "string" ||
      !Number.isFinite(Date.parse(departure)) ||
      !Number.isFinite(Date.parse(arrival)) ||
      Math.abs(Date.parse(departure) - requestedTime) > timeTolerance ||
      Math.abs(
        (Date.parse(arrival) - Date.parse(departure)) / 1000 - duration,
      ) > 5
    ) {
      throw new Error("PROVIDER_INVALID_RESPONSE");
    }
    const legs = route.legs;
    if (!Array.isArray(legs) || !legs.length)
      throw new Error("PROVIDER_INVALID_RESPONSE");
    const coordinates: [number, number][] = [];
    for (const leg of legs) {
      const points = record(leg).points;
      if (!Array.isArray(points) || points.length < 2 || points.length > 50_000)
        throw new Error("PROVIDER_INVALID_RESPONSE");
      for (const value of points) {
        const point = record(value),
          lat = point.latitude,
          lon = point.longitude;
        if (
          typeof lat !== "number" ||
          !Number.isFinite(lat) ||
          Math.abs(lat) > 90 ||
          typeof lon !== "number" ||
          !Number.isFinite(lon) ||
          Math.abs(lon) > 180
        )
          throw new Error("PROVIDER_INVALID_RESPONSE");
        coordinates.push([lon, lat]);
      }
    }
    return {
      distanceM: distance,
      durationS: duration,
      departureTime: departure,
      arrivalTime: arrival,
      coordinates,
    };
  });
}
