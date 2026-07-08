import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

/**
 * Test Viewpoint — loaded from viewpoints.json (source of truth) with inline fallback.
 */
export interface Viewpoint {
  name: string;
  description: string;
  /** Human-readable anchor tying pose to generation-utils biome constants. */
  biomeAnchor?: string;
  cameraPosition: { x: number; y: number; z: number };
  cameraTarget: { x: number; y: number; z: number };
  /** Perspective FOV in degrees (default 60). */
  fov?: number;
  timeOfDay?: 'day' | 'night' | 'sunset' | 'dawn';
  weather?: 'clear' | 'rain' | 'storm';
  waitForStable: number;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Minimal inline fallback if viewpoints.json is missing (CI safety). */
const FALLBACK_VIEWPOINTS: Viewpoint[] = [
  {
    name: 'spawn',
    description: 'Player start position',
    cameraPosition: { x: 0, y: 15, z: 30 },
    cameraTarget: { x: 0, y: 0, z: 0 },
    timeOfDay: 'day',
    waitForStable: 2000,
  },
];

let _cached: Viewpoint[] | null = null;

/**
 * Load viewpoints from tools/visual-regression/viewpoints.json.
 * Results are cached for the process lifetime.
 */
export function loadViewpoints(configPath?: string): Viewpoint[] {
  if (_cached && !configPath) return _cached;

  const jsonPath = configPath ?? path.join(__dirname, '..', 'viewpoints.json');
  if (!fs.existsSync(jsonPath)) {
    console.warn(`[visual-regression] viewpoints.json not found at ${jsonPath}; using fallback`);
    return FALLBACK_VIEWPOINTS;
  }

  const raw = JSON.parse(fs.readFileSync(jsonPath, 'utf-8')) as { viewpoints?: Viewpoint[] };
  const list = raw.viewpoints;
  if (!Array.isArray(list) || list.length === 0) {
    console.warn('[visual-regression] viewpoints.json has no viewpoints; using fallback');
    return FALLBACK_VIEWPOINTS;
  }

  if (!configPath) _cached = list;
  return list;
}

export function getViewpointByName(name: string, configPath?: string): Viewpoint | undefined {
  return loadViewpoints(configPath).find(v => v.name === name);
}

/** Reset cache (tests only). */
export function resetViewpointsCache(): void {
  _cached = null;
}
