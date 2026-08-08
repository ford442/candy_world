/**
 * Startup profile — Graphics level × Map size.
 *
 * Replaces the old CORE / FULL / FAST_FULL mode picker. Choices persist in
 * localStorage and can be overridden via URL (?graphics= / ?map=).
 *
 * Phase 1 maps MapSize onto the existing populateWorld paths as a compat shim:
 *   small  → CORE
 *   medium → FULL + fastPopulation (reduced procedural extras)
 *   large  → FULL + wait for deferred horizon
 *
 * GraphicsLevel is persisted now; Phase 3 will gate shader warmup / ambient systems.
 */

import { getLoadMemoryTier, type LoadMemoryTier } from './config/runtime.ts';
import type { WorldMode } from '../world/generation-utils.ts';

export type GraphicsLevel = 'low' | 'medium' | 'high';
export type MapSize = 'small' | 'medium' | 'large';

export interface StartupProfile {
    graphics: GraphicsLevel;
    mapSize: MapSize;
}

export const GRAPHICS_STORAGE_KEY = 'candy.graphicsLevel';
export const MAP_STORAGE_KEY = 'candy.mapSize';

const GRAPHICS_LEVELS: readonly GraphicsLevel[] = ['low', 'medium', 'high'];
const MAP_SIZES: readonly MapSize[] = ['small', 'medium', 'large'];

function isGraphicsLevel(v: string | null | undefined): v is GraphicsLevel {
    return !!v && (GRAPHICS_LEVELS as readonly string[]).includes(v);
}

function isMapSize(v: string | null | undefined): v is MapSize {
    return !!v && (MAP_SIZES as readonly string[]).includes(v);
}

function readUrlParams(): URLSearchParams | null {
    try {
        if (typeof window === 'undefined') return null;
        return new URLSearchParams(window.location.search);
    } catch {
        return null;
    }
}

function readStorage(key: string): string | null {
    try {
        if (typeof localStorage === 'undefined') return null;
        return localStorage.getItem(key);
    } catch {
        return null;
    }
}

function writeStorage(key: string, value: string): void {
    try {
        if (typeof localStorage === 'undefined') return;
        localStorage.setItem(key, value);
    } catch {
        /* private mode / quota */
    }
}

/** Device-tier defaults — avoid surprising first-timers with Large. */
export function resolveDefaultProfile(tier?: LoadMemoryTier): StartupProfile {
    const t = tier ?? getLoadMemoryTier();
    switch (t) {
        case 'critical':
        case 'low':
            return { graphics: 'low', mapSize: 'small' };
        case 'medium':
            return { graphics: 'medium', mapSize: 'medium' };
        default:
            return { graphics: 'medium', mapSize: 'medium' };
    }
}

/**
 * Load profile: URL wins, then localStorage, then device-tier default.
 */
export function loadStartupProfile(): StartupProfile {
    const defaults = resolveDefaultProfile();
    const params = readUrlParams();

    const urlGraphics = params?.get('graphics') ?? params?.get('gfx') ?? null;
    const urlMap = params?.get('map') ?? params?.get('mapSize') ?? null;

    const graphics = isGraphicsLevel(urlGraphics)
        ? urlGraphics
        : isGraphicsLevel(readStorage(GRAPHICS_STORAGE_KEY))
          ? (readStorage(GRAPHICS_STORAGE_KEY) as GraphicsLevel)
          : defaults.graphics;

    const mapSize = isMapSize(urlMap)
        ? urlMap
        : isMapSize(readStorage(MAP_STORAGE_KEY))
          ? (readStorage(MAP_STORAGE_KEY) as MapSize)
          : defaults.mapSize;

    return { graphics, mapSize };
}

export function saveStartupProfile(profile: StartupProfile): void {
    writeStorage(GRAPHICS_STORAGE_KEY, profile.graphics);
    writeStorage(MAP_STORAGE_KEY, profile.mapSize);
}

export function setGraphicsLevel(graphics: GraphicsLevel): StartupProfile {
    const next = { ...loadStartupProfile(), graphics };
    saveStartupProfile(next);
    return next;
}

export function setMapSize(mapSize: MapSize): StartupProfile {
    const next = { ...loadStartupProfile(), mapSize };
    saveStartupProfile(next);
    return next;
}

/** Compat: map size → existing WorldMode for populateWorld(). */
export function mapSizeToWorldMode(mapSize: MapSize): WorldMode {
    return mapSize === 'small' ? 'CORE' : 'FULL';
}

/** Compat: medium uses the old FAST_FULL procedural scale override. */
export function mapSizeUsesFastPopulation(mapSize: MapSize): boolean {
    return mapSize === 'medium';
}

/**
 * Large map waits for deferred horizon before treating the world as "fully ready".
 * Replaces the old wait-for-full checkbox.
 */
export function mapSizeWaitsForFullPopulation(mapSize: MapSize): boolean {
    return mapSize === 'large';
}

export function graphicsLabel(graphics: GraphicsLevel): string {
    switch (graphics) {
        case 'low':
            return 'Low';
        case 'medium':
            return 'Medium';
        case 'high':
            return 'High';
    }
}

export function mapSizeLabel(mapSize: MapSize): string {
    switch (mapSize) {
        case 'small':
            return 'Small';
        case 'medium':
            return 'Medium';
        case 'large':
            return 'Large';
    }
}

export function profileDescription(profile: StartupProfile): string {
    const g = graphicsLabel(profile.graphics);
    switch (profile.mapSize) {
        case 'small':
            return `${g} graphics · Small map — classic candy terrain near spawn. Fastest start.`;
        case 'medium':
            return `${g} graphics · Medium map — musical foliage nearby; horizon fills in while you explore.`;
        case 'large':
            return `${g} graphics · Large map — complete world; waits until horizon is fully populated.`;
    }
}

export function profileBadgeLabel(profile: StartupProfile): string {
    return `${graphicsLabel(profile.graphics).toUpperCase()} · ${mapSizeLabel(profile.mapSize).toUpperCase()} MAP`;
}

/** Enter-button label for the current map size. */
export function enterButtonLabel(mapSize: MapSize, regenerating = false): string {
    const verb = regenerating ? 'Regenerate' : 'Enter';
    switch (mapSize) {
        case 'small':
            return `${verb} Dream`;
        case 'medium':
            return `${verb} Medium Dream`;
        case 'large':
            return `${verb} Full Dream`;
    }
}

/** Rough expected load character for ETA copy (Phase 4 skeleton). */
export function profileLoadHint(profile: StartupProfile): string {
    const g =
        profile.graphics === 'low'
            ? 'lighter shaders'
            : profile.graphics === 'high'
              ? 'full visual polish'
              : 'balanced visuals';
    const m =
        profile.mapSize === 'small'
            ? 'quick sandbox'
            : profile.mapSize === 'medium'
              ? 'nearby map + streaming horizon'
              : 'complete map (longest)';
    return `${g}, ${m}`;
}
