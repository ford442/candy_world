/**
 * Tier gates for the two *optional* candy surface knobs — the clearcoat lobe
 * and the dream env — plus the single place the graphics tier is read from
 * inside `material-core`.
 *
 * Why a gate at all: `clearcoat` and `useDreamEnv` are the only two options in
 * `UnifiedMaterialOptions` that add a whole extra *lighting term*, not just a
 * few ALU ops on an existing one. The coat runs `PhysicalLightingModel`'s
 * second specular branch (its own D/G/F, its own fresnel-weighted blend); the
 * env adds an IBL sample. On the `low` tier — which is also what CI, the WebGL
 * fallback path and any fallback adapter get (`resolveStartupCapabilities()`
 * forces `graphics: 'low'` for all of them) — those are exactly the terms worth
 * dropping first, because sheen + rim already carry the candy read without them.
 *
 * The tier is read off the value `applyStartupCapabilities()` publishes on
 * `window` rather than by importing `capabilities.ts`, which would drag the
 * GPU-context module into every foliage bundle.
 */

import { getUrlFlag } from '../../core/config/url-flags.ts';

export type GraphicsTier = 'low' | 'medium' | 'high';

/**
 * The resolved graphics tier, or `undefined` before startup capabilities are
 * published (or outside a browser). Callers treat `undefined` as "not low" —
 * a material built before boot finishes gets the full graph rather than a
 * silently degraded one.
 */
export function getGraphicsTier(): GraphicsTier | undefined {
    try {
        return (globalThis as any).window?.__startupCapabilities?.graphics;
    } catch {
        return undefined;
    }
}

let _clearcoatOverride: boolean | null = null;
let _clearcoatResolved: boolean | null = null;

/**
 * Whether presets may compile the clearcoat lobe this session.
 *
 * Off on `low` (and therefore on CI, headless and the WebGL fallback), forceable
 * either way with `?coat=on` / `?coat=off`. Resolved once and cached, so every
 * material in a session compiles the same graph shape.
 */
export function isClearcoatEnabled(): boolean {
    if (_clearcoatOverride !== null) return _clearcoatOverride;
    if (_clearcoatResolved !== null) return _clearcoatResolved;

    const flag = getUrlFlag('coat');
    if (flag === 'off') return (_clearcoatResolved = false);
    if (flag === 'on') return (_clearcoatResolved = true);

    return (_clearcoatResolved = getGraphicsTier() !== 'low');
}

/**
 * Force the coat on or off. Materials already built keep the graph they
 * compiled with — like the env gate, this only affects materials created
 * afterwards.
 */
export function setClearcoatEnabled(enabled: boolean | null): void {
    _clearcoatOverride = enabled;
    if (enabled === null) _clearcoatResolved = null;
}
