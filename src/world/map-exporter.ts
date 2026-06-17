import * as THREE from 'three';
import type { CandyMapData, CandyMapEntity } from './map-loader.ts';
import { normalizeMapEntityType } from './generation-utils.ts';
import { animatedFoliage, foliageGroup } from './state.ts';

const SUPPORTED_EXPORT_TYPES = new Set<string>([
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
    'gem_canopy_tree'
]);

const _worldPos = new THREE.Vector3();
const _worldQuat = new THREE.Quaternion();
const _worldScale = new THREE.Vector3();
const _instancedMatrix = new THREE.Matrix4();

export interface ExportWorldOptions {
    sourceLabel?: string;
    includeInstancedFallback?: boolean;
}

interface WindowExportOptions extends ExportWorldOptions {
    download?: boolean;
    fileName?: string;
}

export interface ExportWorldResult {
    map: CandyMapData;
    stats: {
        totalEntities: number;
        byType: Record<string, number>;
        byProvenance: Record<string, number>;
        deduped: number;
    };
}

function round(value: number, digits: number = 4): number {
    const p = Math.pow(10, digits);
    return Math.round(value * p) / p;
}

function normalizeScale(scale: THREE.Vector3): number | [number, number, number] {
    const sx = round(scale.x);
    const sy = round(scale.y);
    const sz = round(scale.z);
    const nearUniform = Math.abs(sx - sy) <= 0.0001 && Math.abs(sy - sz) <= 0.0001;
    return nearUniform ? sx : [sx, sy, sz];
}

function inferCategory(type: string): string {
    if (type === 'bubble_willow' || type === 'portamento_pine' || type === 'fiber_optic_willow' || type === 'gem_canopy_tree') return 'mushroom-trees';
    if (type === 'mushroom' || type === 'retrigger_mushroom') return 'face-mushrooms';
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

function inferLayer(type: string): string {
    if (type === 'cloud' || type === 'floating_orb') return 'sky';
    if (type === 'instrument_shrine' || type === 'melody_mirror' || type === 'silence_spirit') return 'interactive';
    return 'ground';
}

function normalizeType(value: unknown): string | null {
    if (typeof value !== 'string' || value.trim().length === 0) return null;
    const normalized = normalizeMapEntityType(value.trim());
    return SUPPORTED_EXPORT_TYPES.has(normalized) ? normalized : null;
}

function withProvenanceParams(base: Record<string, unknown> | undefined, provenance: string, sourceId?: string, isBatched?: boolean): Record<string, unknown> | undefined {
    const params = base ? { ...base } : {};
    params.provenance = provenance;
    if (sourceId) params.sourceId = sourceId;
    if (isBatched) params.batched = true;
    return Object.keys(params).length > 0 ? params : undefined;
}

function entityHash(entity: CandyMapEntity): string {
    const p = entity.position;
    const s = entity.scale;
    const scaleHash = Array.isArray(s) ? s.join(',') : String(s ?? 1);
    const rot = (entity.rotation && typeof entity.rotation === 'object' && !Array.isArray(entity.rotation) && 'quat' in entity.rotation && Array.isArray(entity.rotation.quat))
        ? entity.rotation.quat.join(',')
        : 'none';
    return `${entity.type}|${round(p[0], 2)}|${round(p[1], 2)}|${round(p[2], 2)}|${scaleHash}|${rot}|${entity.variant ?? ''}|${entity.note ?? ''}|${entity.noteIndex ?? ''}`;
}

function buildEntityFromObject(obj: THREE.Object3D, index: number): CandyMapEntity | null {
    const exportMeta = (obj.userData?.mapExport ?? {}) as Record<string, unknown>;
    const mappedType = normalizeType(exportMeta.type) ??
        normalizeType(obj.userData?.mapEntityType) ??
        normalizeType(obj.userData?.type);
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

function buildEntityFromInstanced(mesh: THREE.InstancedMesh, type: string, index: number): CandyMapEntity {
    mesh.getMatrixAt(index, _instancedMatrix);
    _instancedMatrix.decompose(_worldPos, _worldQuat, _worldScale);
    return {
        id: `canonical:${type}:instanced:${index}`,
        type,
        position: [round(_worldPos.x), round(_worldPos.y), round(_worldPos.z)],
        rotation: { quat: [round(_worldQuat.x, 6), round(_worldQuat.y, 6), round(_worldQuat.z, 6), round(_worldQuat.w, 6)] },
        scale: normalizeScale(_worldScale),
        category: inferCategory(type),
        layer: inferLayer(type),
        placement: type === 'cloud' || _worldPos.y > 8 ? 'absolute' : 'ground',
        params: { provenance: 'instanced-fallback', batched: true }
    };
}

function downloadJson(json: string, fileName: string): void {
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
}

export function buildCanonicalMapFromWorld(options: ExportWorldOptions = {}): ExportWorldResult {
    const entities: CandyMapEntity[] = [];
    const seen = new Set<string>();
    const byType: Record<string, number> = {};
    const byProvenance: Record<string, number> = {};
    let deduped = 0;

    let logicalIndex = 0;
    for (const obj of animatedFoliage) {
        if (!obj || !obj.parent) continue;
        const entity = buildEntityFromObject(obj as THREE.Object3D, logicalIndex++);
        if (!entity) continue;
        const hash = entityHash(entity);
        if (seen.has(hash)) {
            deduped++;
            continue;
        }
        seen.add(hash);
        entities.push(entity);
        byType[entity.type] = (byType[entity.type] || 0) + 1;
        const provenance = typeof entity.params?.provenance === 'string' ? entity.params.provenance : 'runtime';
        byProvenance[provenance] = (byProvenance[provenance] || 0) + 1;
    }

    if (options.includeInstancedFallback) {
        const existingTypeCounts = new Map<string, number>();
        for (const entity of entities) {
            existingTypeCounts.set(entity.type, (existingTypeCounts.get(entity.type) || 0) + 1);
        }
        let instancedIndex = 0;
        foliageGroup.traverse((child: THREE.Object3D) => {
            const mesh = child as THREE.InstancedMesh;
            if (!mesh.isInstancedMesh || mesh.count <= 0) return;
            const mappedType = normalizeType(mesh.userData?.type);
            if (!mappedType) return;
            if ((existingTypeCounts.get(mappedType) || 0) > 0) return;
            for (let i = 0; i < mesh.count; i++) {
                const entity = buildEntityFromInstanced(mesh, mappedType, instancedIndex++);
                const hash = entityHash(entity);
                if (seen.has(hash)) {
                    deduped++;
                    continue;
                }
                seen.add(hash);
                entities.push(entity);
                byType[entity.type] = (byType[entity.type] || 0) + 1;
                byProvenance['instanced-fallback'] = (byProvenance['instanced-fallback'] || 0) + 1;
            }
        });
    }

    entities.sort((a, b) => (a.type + a.id).localeCompare(b.type + b.id));
    entities.forEach((entity, idx) => {
        entity.id = `canonical:${entity.type}:${idx}`;
    });

    let minX = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxZ = -Infinity;
    for (const entity of entities) {
        minX = Math.min(minX, entity.position[0]);
        minZ = Math.min(minZ, entity.position[2]);
        maxX = Math.max(maxX, entity.position[0]);
        maxZ = Math.max(maxZ, entity.position[2]);
    }
    if (!Number.isFinite(minX)) {
        minX = minZ = -150;
        maxX = maxZ = 150;
    }

    const map: CandyMapData = {
        metadata: {
            version: '2.0',
            seed: 0,
            entityCount: entities.length,
            bounds: { min: [round(minX, 2), round(minZ, 2)], max: [round(maxX, 2), round(maxZ, 2)] },
            exportedAt: new Date().toISOString(),
            source: options.sourceLabel ?? 'runtime-export'
        },
        entities
    };

    return {
        map,
        stats: {
            totalEntities: entities.length,
            byType,
            byProvenance,
            deduped
        }
    };
}

export function installWorldExportTools(): void {
    if (typeof window === 'undefined') return;
    window.exportCurrentWorldToMap = async (options: WindowExportOptions = {}) => {
        const result = buildCanonicalMapFromWorld({
            includeInstancedFallback: options.includeInstancedFallback ?? true,
            sourceLabel: options.sourceLabel ?? 'window-export'
        });
        const fileName = options.fileName ?? 'canonical-part1-map.json';
        const json = JSON.stringify(result.map, null, 2);
        if (options.download !== false && typeof document !== 'undefined') {
            downloadJson(json, fileName);
        }
        return result;
    };
}
