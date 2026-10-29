export const bounds = { west: 76.15, east: 76.49, south: 9.85, north: 10.22 } as const;
export const places = [
  { name: 'Central Kochi', coordinates: [76.2999, 9.9816] },
  { name: 'Kakkanad', coordinates: [76.3417, 10.0150] },
  { name: 'Kalamassery', coordinates: [76.3158, 10.0526] },
  { name: 'Aluva', coordinates: [76.3516, 10.1076] },
  { name: 'Tripunithura', coordinates: [76.3474, 9.9493] },
] as const;

export function containsPoint(latitude: number, longitude: number): boolean {
  return Number.isFinite(latitude) && Number.isFinite(longitude) && latitude >= bounds.south &&
    latitude <= bounds.north && longitude >= bounds.west && longitude <= bounds.east;
}

export function validTile(z: number, x: number, y: number): boolean {
  if (![z, x, y].every(Number.isInteger) || z < 10 || z > 16 || x < 0 || y < 0 || x >= 2 ** z || y >= 2 ** z) return false;
  const n = 2 ** z;
  const longitude = (tileX: number) => tileX / n * 360 - 180;
  const latitude = (tileY: number) => Math.atan(Math.sinh(Math.PI * (1 - 2 * tileY / n))) * 180 / Math.PI;
  return longitude(x) <= bounds.east && longitude(x + 1) >= bounds.west &&
    latitude(y) >= bounds.south && latitude(y + 1) <= bounds.north;
}

export type TrafficState = 'clear' | 'slower' | 'heavy' | 'closed';
export interface RoadDetails {
  speedKmh: number;
  freeFlowKmh: number;
  ratio: number;
  confidence: number;
  state: TrafficState;
  fetchedAt: string;
  coordinates: [number, number][];
}
