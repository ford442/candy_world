/**
 * Startup profile — Play / Explore path + graphics quality.
 *
 * User-facing: one Play path (default) and an opt-in Explore (Full World) path.
 * Graphics is persisted here and in the save-menu Quality setting; runtime
 * behaviour is decided by `resolveStartupCapabilities()` in
 * `src/core/startup/capabilities.ts`.
 *
 * URL flags (`?boot=`, `?graphics=`, `?map=`) never overwrite persisted values.
 * Leftover `candy.mapSize` migrates onto `path` once and is no longer written.
 */

import { getLoadMemoryTier, shouldPreferLightWorldLoad, type LoadMemoryTier } from './config/runtime.ts';

export type GraphicsLevel = 'low' | 'medium' | 'high' | 'ultra';
/** User/session path. `core` is the old CORE sandbox (URL / migration / fallback only). */
export type StartupPath = 'play' | 'explore' | 'core';

export interface StartupProfile {
    path: StartupPath;
    graphics: GraphicsLevel;
}

export const GRAPHICS_STORAGE_KEY = 'candy.graphicsLevel';
export const PATH_STORAGE_KEY = 'candy.bootPath';
/** @deprecated Read-only migration from the old 3×3 map picker. */
export const MAP_STORAGE_KEY = 'candy.mapSize';

const GRAPHICS_LEVELS: readonly GraphicsLevel[] = ['low', 'medium', 'high', 'ultra'];
const STARTUP_PATHS: readonly StartupPath[] = ['play', 'explore', 'core'];

export type UrlBootFlag = 'instant' | 'play' | 'explore' | 'core';

function isGraphicsLevel(v: string | null | undefined): v is GraphicsLevel {
    return !!v && (GRAPHICS_LEVELS as readonly string[]).includes(v);
}

function isStartupPath(v: string | null | undefined): v is StartupPath {
    return !!v && (STARTUP_PATHS as readonly string[]).includes(v);
}

function isUrlBootFlag(v: string | null | undefined): v is UrlBootFlag {
    return v === 'instant' || v === 'play' || v === 'explore' || v === 'core';
}

export function readUrlParams(): URLSearchParams | null {
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

/** Map leftover `candy.mapSize` / `?map=` onto a startup path. */
export function mapSizeToStartupPath(mapSize: string | null | undefined): StartupPath | null {
    switch (mapSize) {
        case 'small':
            return 'core';
        case 'medium':
            return 'play';
        case 'large':
            return 'explore';
        default:
            return null;
    }
}

/**
 * Persisted-map migration: Small used to mean CORE, but Play is now the
 * product default (spawn chunk of the real map). Large → Explore.
 * `?map=small` still forces the CORE sandbox via {@link resolveBootPathFromUrl}.
 */
function migrateStoredMapSize(mapSize: string | null | undefined): StartupPath | null {
    switch (mapSize) {
        case 'small':
        case 'medium':
            return 'play';
        case 'large':
            return 'explore';
        default:
            return null;
    }
}

/** Device-tier default graphics. Lite / low-RAM GPUs default to CORE unless URL/storage set a path. */
export function resolveDefaultProfile(tier?: LoadMemoryTier): StartupProfile {
    const t = tier ?? getLoadMemoryTier();
    if (shouldPreferLightWorldLoad() || t === 'critical' || t === 'low') {
        return { graphics: 'low', path: 'core' };
    }
    return { graphics: 'medium', path: 'play' };
}

/** `?boot=instant|play|explore|core` wins; else `?map=` compat. Does not read storage. */
export function resolveBootPathFromUrl(params?: URLSearchParams | null): StartupPath | null {
    const search = params ?? readUrlParams();
    const boot = search?.get('boot');
    if (isUrlBootFlag(boot)) {
        return boot === 'instant' ? 'play' : boot;
    }
    return mapSizeToStartupPath(search?.get('map') ?? search?.get('mapSize'));
}

export function isBootInstant(params?: URLSearchParams | null): boolean {
    const search = params ?? readUrlParams();
    return search?.get('boot') === 'instant';
}

export function isWaitForFullRequested(params?: URLSearchParams | null): boolean {
    const search = params ?? readUrlParams();
    return !!search?.has('waitForFull');
}



/**
 * Load profile: URL wins for this session, then localStorage, then device default.
 * URL values are not written back to storage.
 */
export function loadStartupProfile(): StartupProfile {
    const defaults = resolveDefaultProfile();
    const params = readUrlParams();

    const urlGraphics = params?.get('graphics') ?? params?.get('gfx') ?? null;
    const graphics = isGraphicsLevel(urlGraphics)
        ? urlGraphics
        : isGraphicsLevel(readStorage(GRAPHICS_STORAGE_KEY))
          ? (readStorage(GRAPHICS_STORAGE_KEY) as GraphicsLevel)
          : defaults.graphics;

    const urlPath = resolveBootPathFromUrl(params);
    let path: StartupPath;
    if (urlPath) {
        path = urlPath;
    } else if (isStartupPath(readStorage(PATH_STORAGE_KEY))) {
        path = readStorage(PATH_STORAGE_KEY) as StartupPath;
    } else {
        path = migrateStoredMapSize(readStorage(MAP_STORAGE_KEY)) ?? defaults.path;
    }

    if (isWaitForFullRequested(params)) {
        path = 'explore';
    }

    return { graphics, path };
}

export function saveStartupProfile(profile: StartupProfile): void {
    writeStorage(GRAPHICS_STORAGE_KEY, profile.graphics);
    writeStorage(PATH_STORAGE_KEY, profile.path);
}

export function setGraphicsLevel(graphics: GraphicsLevel): StartupProfile {
    const current = loadStartupProfile();
    const next = { ...current, graphics };
    writeStorage(GRAPHICS_STORAGE_KEY, graphics);
    return next;
}

export function setStartupPath(path: StartupPath): StartupProfile {
    const current = loadStartupProfile();
    const next = { ...current, path };
    writeStorage(PATH_STORAGE_KEY, path);
    return next;
}

/** Clamp Settings-only `ultra` to `high` for the start-path resolver. */
export function clampGraphicsForStart(graphics: GraphicsLevel): 'low' | 'medium' | 'high' {
    return graphics === 'ultra' ? 'high' : graphics;
}

export function graphicsLabel(graphics: GraphicsLevel): string {
    switch (graphics) {
        case 'low':
            return 'Low';
        case 'medium':
            return 'Medium';
        case 'high':
            return 'High';
        case 'ultra':
            return 'Ultra';
    }
}

export function pathLabel(path: StartupPath): string {
    switch (path) {
        case 'play':
            return 'Play';
        case 'explore':
            return 'Explore';
        case 'core':
            return 'Core';
    }
}

export function profileDescription(profile: StartupProfile): string {
    switch (profile.path) {
        case 'explore':
            return 'Full World — nearby map loads first; the horizon fills in as you walk.';
        case 'core':
            return 'Core sandbox — classic candy terrain near spawn. Dev / CI only.';
        default:
            return 'Spawn area loads first; the horizon fills in as you walk.';
    }
}

export function profileBadgeLabel(profile: StartupProfile): string {
    return `${pathLabel(profile.path).toUpperCase()} · ${graphicsLabel(clampGraphicsForStart(profile.graphics)).toUpperCase()}`;
}

export function enterButtonLabel(_path?: StartupPath, regenerating = false): string {
    return regenerating ? 'Regenerate Dream' : 'Enter Dream';
}

export function profileLoadHint(profile: StartupProfile): string {
    const g =
        profile.graphics === 'low'
            ? 'lighter shaders'
            : profile.graphics === 'ultra' || profile.graphics === 'high'
              ? 'full visual polish'
              : 'balanced visuals';
    const m =
        profile.path === 'core'
            ? 'quick sandbox'
            : profile.path === 'explore'
              ? 'nearby map + streaming horizon'
              : 'spawn chunk + streaming horizon';
    return `${g}, ${m}`;
}
