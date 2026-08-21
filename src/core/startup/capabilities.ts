/**
 * Single source of truth for start-path runtime behaviour.
 *
 * `StartupProfile` is what the user persisted. This module is the only place
 * that turns that profile + device/URL signals into warmup / postfx / deferred
 * / shadow decisions. Subsystems read `getStartupCapabilities()`, never raw
 * `profile.graphics`.
 */

import { getGpuContextSync } from '../../rendering/gpu-context.ts';
import { resolveRendererBackend } from '../../rendering/renderer-mode.ts';
import { CONFIG } from '../config/defaults.ts';
import { isCIorHeadless, getLoadMemoryTier, type LoadMemoryTier } from '../config/runtime.ts';
import {
    clampGraphicsForStart,
    isWaitForFullRequested,
    loadStartupProfile,
    readUrlParams,
    type GraphicsLevel,
    type StartupPath,
    type StartupProfile,
} from '../startup-profile.ts';
import { worldExtentForPath, type WorldExtentConfig } from '../../world/world-extent.ts';

export type MaterialSubset = 'none' | 'minimal' | 'batched' | 'full';
export type PostfxQuality = 'off' | 'low' | 'high';
export type ShadowResolution = 'off' | 'low' | 'high';

export interface StartupCapabilities {
    path: StartupPath;
    graphics: 'low' | 'medium' | 'high';
    warmup: { materialSubset: MaterialSubset };
    postfx: { quality: PostfxQuality };
    deferred: { aurora: boolean; fluidFog: boolean };
    shadows: { enabled: boolean; resolution: ShadowResolution };
    /** Visual terrain / population envelope for this path. */
    world: WorldExtentConfig;
}

export interface ResolveStartupCapabilitiesInput {
    profile: StartupProfile;
    deviceTier: LoadMemoryTier;
    isFallbackAdapter: boolean;
    forceWebGL: boolean;
    isHeadlessOrCI: boolean;
    url: {
        postfx?: string | null;
        boot?: string | null;
        /** QA-only `?waitForFull=1` — forces the Explore path. */
        waitForFull?: boolean;
    };
}

const GRAPHICS_TABLE: Record<
    'low' | 'medium' | 'high',
    {
        warmup: MaterialSubset;
        postfx: PostfxQuality;
        aurora: boolean;
        fluidFog: boolean;
        shadows: ShadowResolution;
    }
> = {
    low: {
        warmup: 'minimal',
        postfx: 'off',
        aurora: false,
        fluidFog: false,
        shadows: 'off',
    },
    medium: {
        warmup: 'batched',
        postfx: 'low',
        aurora: false,
        fluidFog: true,
        shadows: 'low',
    },
    high: {
        warmup: 'full',
        postfx: 'high',
        aurora: true,
        fluidFog: true,
        shadows: 'high',
    },
};

function applyUrlPath(path: StartupPath, url: ResolveStartupCapabilitiesInput['url']): StartupPath {
    if (url.waitForFull) return 'explore';
    const boot = url.boot;
    if (boot === 'instant' || boot === 'play') return 'play';
    if (boot === 'explore') return 'explore';
    if (boot === 'core') return 'core';
    return path;
}

function applyUrlPostfx(
    quality: PostfxQuality,
    urlPostfx: string | null | undefined
): PostfxQuality {
    if (urlPostfx === 'off' || urlPostfx === 'low' || urlPostfx === 'high') return urlPostfx;
    return quality;
}

/** Pure function — the only place graphics behaviour is decided. */
export function resolveStartupCapabilities(
    input: ResolveStartupCapabilitiesInput
): StartupCapabilities {
    const path = applyUrlPath(input.profile.path, input.url);
    const forceLite = input.isFallbackAdapter || input.forceWebGL || input.isHeadlessOrCI;

    let graphics = clampGraphicsForStart(input.profile.graphics);
    if (forceLite) graphics = 'low';

    const row = GRAPHICS_TABLE[graphics];
    let materialSubset = row.warmup;
    if (input.isHeadlessOrCI) materialSubset = 'none';

    const postfxQuality = applyUrlPostfx(forceLite ? 'off' : row.postfx, input.url.postfx);

    return {
        path,
        graphics,
        warmup: { materialSubset },
        postfx: { quality: postfxQuality },
        deferred: {
            aurora: forceLite ? false : row.aurora,
            fluidFog: forceLite ? false : row.fluidFog,
        },
        shadows: {
            enabled: !forceLite && row.shadows !== 'off',
            resolution: forceLite ? 'off' : row.shadows,
        },
        world: worldExtentForPath(path),
    };
}

let cached: StartupCapabilities | null = null;

export function getStartupCapabilities(): StartupCapabilities {
    return cached ?? resolveStartupCapabilities(gatherStartupCapabilityInputs());
}

export function applyStartupCapabilities(caps: StartupCapabilities): StartupCapabilities {
    cached = caps;
    try {
        if (typeof window !== 'undefined') {
            (window as any).__startupCapabilities = caps;
        }
    } catch {
        /* non-browser */
    }
    return caps;
}

export function gatherStartupCapabilityInputs(): ResolveStartupCapabilitiesInput {
    const params = readUrlParams();
    const ctx = getGpuContextSync();
    const fallback = Boolean(
        (ctx.adapter as (GPUAdapter & { isFallbackAdapter?: boolean }) | null)?.isFallbackAdapter
    );

    let forceWebGL = false;
    try {
        forceWebGL =
            resolveRendererBackend() === 'webgl' ||
            (typeof window !== 'undefined' && (window as any).usingWebGL === true);
    } catch {
        /* node / no location */
    }

    return {
        profile: loadStartupProfile(),
        deviceTier: getLoadMemoryTier(),
        isFallbackAdapter: fallback,
        forceWebGL,
        isHeadlessOrCI: isCIorHeadless() || CONFIG.safeMode,
        url: {
            postfx: params?.get('postfx') ?? null,
            boot: params?.get('boot') ?? null,
            waitForFull: isWaitForFullRequested(params),
        },
    };
}

export function refreshStartupCapabilities(
    overrides?: Partial<ResolveStartupCapabilitiesInput>
): StartupCapabilities {
    const input = { ...gatherStartupCapabilityInputs(), ...overrides };
    if (overrides?.url) {
        input.url = { ...gatherStartupCapabilityInputs().url, ...overrides.url };
    }
    if (overrides?.profile) {
        input.profile = { ...gatherStartupCapabilityInputs().profile, ...overrides.profile };
    }
    return applyStartupCapabilities(resolveStartupCapabilities(input));
}

export function formatStartupLogLine(
    caps: StartupCapabilities,
    extras?: { deviceTier?: LoadMemoryTier; deviceMemoryGB?: number; fallbackAdapter?: boolean }
): string {
    const gb = typeof extras?.deviceMemoryGB === 'number' ? `, ${extras.deviceMemoryGB}GB` : '';
    const tier = extras?.deviceTier ? `device tier=${extras.deviceTier}${gb}` : '';
    const fallback =
        extras?.fallbackAdapter === undefined ? '' : `, fallbackAdapter=${extras.fallbackAdapter}`;
    const detail = tier || fallback ? ` (${tier}${fallback})` : '';
    return `[Startup] path=${caps.path} graphics=${caps.graphics} world=${caps.world.size}×${caps.world.size}${detail}`;
}

/** @internal tests */
export function __resetStartupCapabilitiesForTests(): void {
    cached = null;
}

export type { GraphicsLevel };
