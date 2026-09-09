/**
 * Canonical `CandyMapEntity` record building — the single source of truth for
 * turning a live world object into the plain-JSON shape that lives in
 * `assets/map.json`.
 *
 * Extracted from `map-exporter.ts` (which still owns the whole-world export and
 * its instanced fallback) so that per-entity consumers — notably
 * `systems/entity-snapshot-core.ts` — can compose the same logic instead of
 * re-implementing rounding / scale-normalization / category inference.
 *
 * Deliberately free of `world/state.ts` and renderer imports: this module must
 * stay importable from a plain Node test.
 */

import * as THREE from 'three';
import { normalizeMapEntityType } from './generation-utils.ts';
import type { CandyMapEntity } from './map-loader.ts';

export const SUPPORTED_EXPORT_TYPES = new Set<string>([
    'mushroom',
    'flower',
    'cloud',
    'grass',
    'subwoofer_lotus',
    'accordion_palm',
    'fiber_optic_willow',
    'floating_orb',
    'swingable_vine',
    'prism_rose_bush',
    'starflower',
    'vibrato_violet',
    'tremolo_tulip',
    'kick_drum_geyser',
    'arpeggio_fern',
    'portamento_pine',
    'cymbal_dandelion',
    'snare_trap',
    'retrigger_mushroom',
    'panning_pad',
    'silence_spirit',
    'instrument_shrine',
    'bubble_willow',
    'helix_plant',
    'balloon_bush',
    'wisteria_cluster',
    'luminous_plant',
    'melody_mirror',
    'cave',
    'gem_canopy_tree',
    'glass_mushroom',
    'sky_island',
    'vine_ladder'
]);

const _worldPos = new THREE.Vector3();
const _worldQuat = new THREE.Quaternion();
const _worldScale = new THREE.Vector3();

export function round(value: number, digits: number = 4): number {
    const p = Math.pow(10, digits);
    return Math.round(value * p) / p;
}

export function normalizeScale(scale: THREE.Vector3): number | [number, number, number] {
    const sx = round(scale.x);
    const sy = round(scale.y);
    const sz = round(scale.z);
    const nearUniform = Math.abs(sx - sy) <= 0.0001 && Math.abs(sy - sz) <= 0.0001;
    return nearUniform ? sx : [sx, sy, sz];
}

export function inferCategory(type: string): string {
    if (type === 'bubble_willow' || type === 'portamento_pine' || type === 'fiber_optic_willow' || type === 'gem_canopy_tree') return 'mushroom-trees';
    if (type === 'mushroom' || type === 'retrigger_mushroom') return 'face-mushrooms';
    if (type === 'glass_mushroom') return 'mycelium';
    if (type === 'cloud') return 'clouds';
    if (
        type === 'arpeggio_fern' ||
        type === 'vibrato_violet' ||
        type === 'tremolo_tulip' ||
        type === 'kick_drum_geyser' ||
        type === 'subwoofer_lotus' ||
        type === 'portamento_pine' ||
        type === 'cymbal_dandelion'
    ) return 'musical-flora';
    if (type === 'floating_orb' || type === 'silence_spirit' || type === 'instrument_shrine' || type === 'melody_mirror') return 'interactive';
    return 'decorative';
}

export function inferLayer(type: string): string {
    if (type === 'cloud' || type === 'floating_orb') return 'sky';
    if (type === 'instrument_shrine' || type === 'melody_mirror' || type === 'silence_spirit') return 'interactive';
    return 'ground';
}

export function normalizeExportType(value: unknown): string | null {
    if (typeof value !== 'string' || value.trim().length === 0) return null;
    const normalized = normalizeMapEntityType(value.trim());
    return SUPPORTED_EXPORT_TYPES.has(normalized) ? normalized : null;
}

export function withProvenanceParams(base: Record<string, unknown> | undefined, provenance: string, sourceId?: string, isBatched?: boolean): Record<string, unknown> | undefined {
    const params = base ? { ...base } : {};
    params.provenance = provenance;
    if (sourceId) params.sourceId = sourceId;
    if (isBatched) params.batched = true;
    // ⚡ OPTIMIZATION: Bypassed Object.keys() to prevent GC spikes
    for (const _ in params) return params;
    return undefined;
}

export function entityHash(entity: CandyMapEntity): string {
    const p = entity.position;
    const s = entity.scale;
    const scaleHash = Array.isArray(s) ? s.join(',') : String(s ?? 1);
    const rot = (entity.rotation && typeof entity.rotation === 'object' && !Array.isArray(entity.rotation) && 'quat' in entity.rotation && Array.isArray(entity.rotation.quat))
        ? entity.rotation.quat.join(',')
        : 'none';
    return `${entity.type}|${round(p[0], 2)}|${round(p[1], 2)}|${round(p[2], 2)}|${scaleHash}|${rot}|${entity.variant ?? ''}|${entity.note ?? ''}|${entity.noteIndex ?? ''}`;
}

/**
 * Build the canonical `CandyMapEntity` for one live object, reading its
 * transform from the CPU-side `Object3D` (the batcher's CPU mirror for batched
 * entities) — never from a GPU-resident instance buffer.
 *
 * Returns `null` for objects that carry no exportable map type.
 */
export function buildEntityFromObject(obj: THREE.Object3D, index: number): CandyMapEntity | null {
    const exportMeta = (obj.userData?.mapExport ?? {}) as Record<string, unknown>;
    const mappedType = normalizeExportType(exportMeta.type) ??
        normalizeExportType(obj.userData?.mapEntityType) ??
        normalizeExportType(obj.userData?.type);
    if (!mappedType) return null;

    obj.getWorldPosition(_worldPos);
    obj.getWorldQuaternion(_worldQuat);
    obj.getWorldScale(_worldScale);

    const provenance = typeof exportMeta.provenance === 'string' ? exportMeta.provenance : 'runtime';
    const sourceId = typeof exportMeta.sourceId === 'string' ? exportMeta.sourceId : undefined;
    const params = withProvenanceParams(
        exportMeta.params && typeof exportMeta.params === 'object' ? (exportMeta.params as Record<string, unknown>) : undefined,
        provenance,
        sourceId,
        !!obj.userData?.isBatched
    );

    const entity: CandyMapEntity = {
        id: `canonical:${mappedType}:${index}`,
        type: mappedType,
        position: [round(_worldPos.x), round(_worldPos.y), round(_worldPos.z)],
        rotation: { quat: [round(_worldQuat.x, 6), round(_worldQuat.y, 6), round(_worldQuat.z, 6), round(_worldQuat.w, 6)] },
        scale: normalizeScale(_worldScale),
        category: (typeof exportMeta.category === 'string' && exportMeta.category) || inferCategory(mappedType),
        layer: (typeof exportMeta.layer === 'string' && exportMeta.layer) || inferLayer(mappedType),
        biome: (typeof exportMeta.biome === 'string' && exportMeta.biome) || (typeof obj.userData?.biome === 'string' ? obj.userData.biome : undefined),
        placement: (typeof exportMeta.placement === 'string' && ['ground', 'absolute', 'offset'].includes(exportMeta.placement))
            ? exportMeta.placement as 'ground' | 'absolute' | 'offset'
            : (mappedType === 'cloud' || _worldPos.y > 8 ? 'absolute' : 'ground'),
        params
    };

    const storedBaseOffset = typeof exportMeta.baseOffset === 'number'
        ? exportMeta.baseOffset
        : (typeof params?.baseOffset === 'number' ? params.baseOffset : undefined);
    if (storedBaseOffset !== undefined && Number.isFinite(storedBaseOffset)) {
        entity.baseOffset = storedBaseOffset;
    }

    const variant = exportMeta.variant ?? obj.userData?.variant ?? obj.userData?.size;
    if (typeof variant === 'string') entity.variant = variant;
    if (typeof exportMeta.note === 'string') entity.note = exportMeta.note;
    else if (typeof obj.userData?.note === 'string') entity.note = obj.userData.note;
    if (Number.isInteger(exportMeta.noteIndex)) entity.noteIndex = exportMeta.noteIndex as number;
    else if (Number.isInteger(obj.userData?.noteIndex)) entity.noteIndex = obj.userData.noteIndex;
    if (typeof exportMeta.hasFace === 'boolean') entity.hasFace = exportMeta.hasFace;
    else if (typeof obj.userData?.hasFace === 'boolean') entity.hasFace = obj.userData.hasFace;
    if (exportMeta.music && typeof exportMeta.music === 'object') {
        entity.music = exportMeta.music as CandyMapEntity['music'];
    } else if (entity.biome) {
        entity.music = { biomeTag: entity.biome };
    }

    if (mappedType === 'portamento_pine' && entity.params && typeof entity.params.height !== 'number') {
        entity.params.height = round(_worldScale.y * 4, 3);
    }
    if (mappedType === 'cloud' && entity.params && typeof entity.params.size !== 'number') {
        entity.params.size = round(Math.max(_worldScale.x, _worldScale.y, _worldScale.z), 3);
    }

    return entity;
}
