import type { MeshPhysicalNodeMaterial } from 'three/webgpu';
import { createUnifiedMaterial, type UnifiedMaterialOptions } from './unified-material.ts';

/**
 * Candy World's material vocabulary. Every factory is `(hex, opts?)`; `opts`
 * spreads last, so any knob below is overridable per call site.
 *
 * Three cross-cutting knobs landed together and are worth reading as a set —
 * full write-up in `docs/CANDY_MATERIAL_COOKBOOK.md`:
 *
 * - **`clearcoat`** — a real second specular lobe. On by default only for
 *   `Sugar` (the crust wants a wet-looking coat); opt-in everywhere else via
 *   `{ clearcoat: 0.6 }`, because the lobe is not free.
 * - **`useDreamEnv`** — points the material at one shared procedural sky so
 *   reflections read as candy sky rather than grey studio. Default on for
 *   `Crystal` and `Gummy`, the two presets you look *through*.
 * - **`subsurface*`** — wrapped translucency (not real SSS; see the cookbook).
 */

type PresetFn = (
    hex: number | string | import('three').Color,
    opts?: UnifiedMaterialOptions
) => MeshPhysicalNodeMaterial;

export const CandyPresets: { [key: string]: PresetFn } = {
    Clay: (hex, opts = {}) =>
        createUnifiedMaterial(hex, {
            roughness: 0.8,
            bumpStrength: 0.15,
            noiseScale: 8.0,
            triplanar: true,
            contactDarkening: 0.3,
            contactDarkeningHeight: 1.0,
            rimStrength: 0.3,
            rimPower: 3.0,
            ...opts,
        }),

    Sugar: (hex, opts = {}) =>
        createUnifiedMaterial(hex, {
            roughness: 0.6,
            bumpStrength: 0.8,
            noiseScale: 60.0,
            sheen: 1.0,
            sheenColor: 0xffffff,
            sheenRoughness: 0.5,
            // 🎨 PALETTE: the icing coat. Sheen alone gave frosted crust a dusty,
            // powdered-sugar read; a thin clearcoat over the micro-bumps is what
            // makes it look *glazed*. Deliberately below 1.0 — a full coat flattens
            // the noiseScale-60 crust into shrink-wrap.
            clearcoat: 0.7,
            // Visual Impact: coat roughness tracks the crust. Mirror-smooth (0.0)
            // reads as wet plastic; this keeps the highlight soft and broad.
            clearcoatRoughness: 0.25,
            contactDarkening: 0.2,
            contactDarkeningHeight: 0.8,
            ...opts,
        }),

    /**
     * Translucent, inner-glow candy. Clearcoat is **opt-in** here — pass
     * `{ clearcoat: 0.8, clearcoatRoughness: 0.1 }` for a wrapper-fresh,
     * just-unwrapped read; the bare preset stays matte-surfaced so the
     * translucency, not the coat, is what the eye lands on.
     */
    Gummy: (hex, opts = {}) =>
        createUnifiedMaterial(hex, {
            transmission: 0.9,
            thickness: 1.5,
            roughness: 0.2,
            ior: 1.4,
            subsurfaceStrength: 0.6,
            subsurfaceColor: hex,
            // Visual Impact: wide wrap + soft lobe = light bleeding through a
            // fruit gum. Tighten `subsurfacePower` for a harder candied edge.
            subsurfaceWrap: 0.6,
            subsurfaceDistortion: 0.25,
            subsurfacePower: 2.5,
            subsurfaceThicknessFalloff: 0.3,
            thicknessDistortion: 0.3,
            // 🎨 PALETTE: candy sky in the highlights. Under 1.0 so a gummy still
            // reads as a diffuse-ish blob rather than a chrome bead.
            useDreamEnv: true,
            envMapIntensity: 0.6,
            contactDarkening: 0.2,
            contactDarkeningHeight: 1.0,
            ...opts,
        }),

    SeaJelly: (hex, opts = {}) =>
        createUnifiedMaterial(hex, {
            transmission: 0.95,
            thickness: 0.8,
            ior: 1.33,
            roughness: 0.05,
            subsurfaceStrength: 0.4,
            subsurfaceColor: 0xccffff,
            animateMoisture: true,
            thicknessDistortion: 0.5,
            ...opts,
        }),

    Crystal: (hex, opts = {}) =>
        createUnifiedMaterial(hex, {
            transmission: 1.0,
            thickness: 4.0,
            roughness: 0.0,
            ior: 2.0,
            iridescenceStrength: 0.7,
            iridescenceFresnelPower: 2.5,
            // 🎨 PALETTE: a roughness-0 gem with nothing to reflect is a grey
            // lump with a sun dot on it. Full-strength dream sky is what turns
            // the facets into gem corridors.
            useDreamEnv: true,
            envMapIntensity: 1.0,
            ...opts,
        }),

    Velvet: (hex, opts = {}) =>
        createUnifiedMaterial(hex, {
            roughness: 1.0,
            sheen: 1.0,
            sheenColor: hex,
            sheenRoughness: 1.0,
            bumpStrength: 0.05,
            ...opts,
        }),

    OilSlick: (hex = 0x222222, opts = {}) =>
        createUnifiedMaterial(hex, {
            roughness: 0.3,
            metalness: 0.8,
            iridescenceStrength: 1.0,
            iridescenceFresnelPower: 1.5,
            ...opts,
        }),
};
