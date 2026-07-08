/**
 * @file entity-scale.ts
 * Centralized procedural scale / height sampling from CONFIG.world.scaleTable.
 * Map.json entities with explicit `scale` bypass this module.
 */

import { CONFIG, type EntityScaleEntry, type EntityScaleRange } from '../core/config.ts';

export interface ScaleSampleOptions {
    biome?: string;
    /** 0 = biome center, 1 = outer edge — enables subtle forced-perspective shrink. */
    normalizedDistance?: number;
}

function mergeRange(base: EntityScaleRange, override?: Partial<EntityScaleRange>): EntityScaleRange {
    if (!override) return base;
    return {
        base: override.base ?? base.base,
        min: override.min ?? base.min,
        max: override.max ?? base.max,
    };
}

function resolveEntry(entityType: string, biome?: string): EntityScaleEntry {
    const table = CONFIG.world.scaleTable;
    const entry = table[entityType] ?? table._default ?? { base: 1.0, min: 0.85, max: 1.15 };
    if (!biome || !entry.biomeOverrides?.[biome]) return entry;

    const override = entry.biomeOverrides[biome];
    const merged: EntityScaleEntry = {
        ...entry,
        ...mergeRange(entry, override),
    };
    if (entry.height) {
        merged.height = mergeRange(entry.height, override.height);
    }
    return merged;
}

function applyDistanceBias(value: number, normalizedDistance?: number): number {
    if (normalizedDistance === undefined) return value;
    const bias = CONFIG.world.scaleDistanceBias;
    if (!bias.enabled) return value;
    const t = Math.max(0, Math.min(1, normalizedDistance));
    return value * (1 - bias.outerShrink * t);
}

function sampleRange(range: EntityScaleRange, normalizedDistance?: number): number {
    const raw = range.min + Math.random() * (range.max - range.min);
    return applyDistanceBias(raw, normalizedDistance);
}

/**
 * Sample a uniform scale multiplier for a procedural entity type.
 * Clamped by CONFIG.world.scaleTable min/max (default 0.85–1.15 on base 1.0).
 */
export function sampleEntityScale(entityType: string, options: ScaleSampleOptions = {}): number {
    const entry = resolveEntry(entityType, options.biome);
    return sampleRange(entry, options.normalizedDistance);
}

/**
 * Sample absolute world height for types that pass `height` (trees, geysers)
 * or derive from refHeight × scale when only refHeight is defined.
 */
export function sampleEntityHeight(entityType: string, options: ScaleSampleOptions = {}): number {
    const entry = resolveEntry(entityType, options.biome);
    if (entry.height) {
        return sampleRange(entry.height, options.normalizedDistance);
    }
    const refHeight = entry.refHeight ?? 1.0;
    return refHeight * sampleEntityScale(entityType, options);
}

/** Normalized distance from biome center (0 = center, 1 = at/ beyond radius). */
export function biomeNormalizedDistance(
    centerX: number,
    centerZ: number,
    radius: number,
    x: number,
    z: number
): number {
    if (radius <= 0) return 0;
    const dx = x - centerX;
    const dz = z - centerZ;
    return Math.min(1, Math.sqrt(dx * dx + dz * dz) / radius);
}
