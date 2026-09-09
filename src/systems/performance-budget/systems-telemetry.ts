/**
 * @file systems-telemetry.ts
 * @brief Registers live stats providers for every budgeted system.
 *
 * Kept apart from `systems-budget.ts` on purpose: this file imports THREE and
 * the GPU-side systems, that one imports nothing. Only the `?debug=1` path
 * loads this module, so a production boot pays nothing for the overlay, and a
 * headless CI test can exercise the caps without touching a renderer.
 */

import { getIrradianceStats, isIrradianceEnabled } from '../../rendering/irradiance-probes.ts';
import { getClusteredLightingStats } from '../../rendering/clustered-lighting.ts';
import { getLocalLightStats } from '../../rendering/lights.ts';
import { getEmitters, getTotalParticleCapacity } from '../../particles/emitter-api.ts';
import { profiler } from '../../utils/profiler.ts';
import { areSunCascadesActive, getCascadeMapSizes } from '../shadow-cascades.ts';
import { getRigidBodyCount, getAwakeRigidBodyCount } from '../physics/rigid-bodies.ts';
import { registerSystemTelemetry } from './systems-budget.ts';

const BYTES_PER_MB = 1024 * 1024;

/** Depth24 + no colour attachment: 4 bytes per shadow texel is the honest estimate. */
function shadowMapVramMb(sizes: readonly number[]): number {
    let bytes = 0;
    for (const size of sizes) bytes += size * size * 4;
    return bytes / BYTES_PER_MB;
}

/** Read the post-FX pass count published by the WebGPU post graph, if it built one. */
function postfxPasses(): { passes: number; enabled: boolean } {
    const w = globalThis as { __candyPostFxPasses?: number };
    const passes = typeof w.__candyPostFxPasses === 'number' ? w.__candyPostFxPasses : 0;
    return { passes, enabled: passes > 0 };
}

/**
 * Wire every provider. Idempotent — registering twice replaces the previous
 * closure, so a hot reload of the debug panel is harmless.
 */
export function registerAllSystemTelemetry(): void {
    registerSystemTelemetry('shadows', () => {
        const sizes = getCascadeMapSizes();
        const local = getLocalLightStats();
        const active = areSunCascadesActive();
        return {
            enabled: active,
            reason: active ? undefined : 'cascades inactive (WebGL / low / CI)',
            counts: { cascades: sizes.length, localShadowLights: local.shadows },
            vramMb: shadowMapVramMb(sizes),
            frameMs: profiler.getMark('shadows.csmUpdate'),
        };
    });

    registerSystemTelemetry('clusteredLights', () => {
        const s = getClusteredLightingStats();
        return {
            enabled: s.enabled,
            reason: s.enabled ? undefined : s.reason,
            counts: { lights: s.lights, lightsPerCluster: s.maxLightsPerCluster },
            frameMs: s.lastBinMs,
        };
    });

    registerSystemTelemetry('gi', () => {
        const s = getIrradianceStats();
        return {
            enabled: isIrradianceEnabled(),
            reason: isIrradianceEnabled() ? undefined : 'probes disabled',
            counts: { probes: s.probes, probesPerFrame: s.probesPerFrame },
            frameMs: profiler.getMark('gi.probeBake'),
        };
    });

    registerSystemTelemetry('postfx', () => {
        const { passes, enabled } = postfxPasses();
        return {
            enabled,
            reason: enabled ? undefined : 'post graph not built (WebGL / postfx=off)',
            counts: { passes },
            frameMs: profiler.getMark('postfx.render'),
        };
    });

    registerSystemTelemetry('particles', () => {
        const emitters = getEmitters();
        let gpu = 0;
        for (const emitter of emitters.values()) if (emitter.isGPU) gpu++;
        return {
            enabled: emitters.size > 0,
            reason: emitters.size > 0 ? undefined : 'no emitters registered',
            counts: { totalParticles: getTotalParticleCapacity(), emitters: emitters.size },
            // 48 B/particle: position, velocity, colour, life on the GPU tier.
            vramMb: (getTotalParticleCapacity() * 48) / BYTES_PER_MB,
            frameMs: profiler.getMark('particles.update'),
        };
    });

    registerSystemTelemetry('rigidBodies', () => {
        const bodies = getRigidBodyCount();
        return {
            enabled: bodies > 0,
            reason: bodies > 0 ? undefined : 'pool empty (costs nothing)',
            // `awake` has no cap of its own — it is what the frame actually costs.
            counts: { bodies, awake: getAwakeRigidBodyCount() },
            frameMs: profiler.getMark('rigidBodies.step'),
        };
    });

    registerSystemTelemetry('fauna', () => {
        const count = (globalThis as { __faunaCount?: number }).__faunaCount ?? 0;
        return {
            enabled: count > 0,
            reason: count > 0 ? undefined : 'fauna disabled or not spawned',
            counts: { instances: count },
            frameMs: profiler.getMark('fauna.update'),
        };
    });
}
