export type Vehicle = "car" | "motorcycle";
export type Departure = "now" | "hour";
export interface AddressMatch {
  label: string;
  coordinates: [number, number];
}
export interface JourneyRoute {
  distanceM: number;
  durationS: number;
  departureTime: string;
  arrivalTime: string;
  coordinates: [number, number][];
}
export interface JourneyResult {
  routes: JourneyRoute[];
  vehicle: Vehicle;
  departure: Departure;
  fetchedAt: string;
}
