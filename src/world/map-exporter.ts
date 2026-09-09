import * as THREE from 'three';
import {
    buildEntityFromObject,
    entityHash,
    inferCategory,
    inferLayer,
    normalizeExportType,
    normalizeScale,
    round,
} from './map-entity-record.ts';
import type { CandyMapData, CandyMapEntity } from './map-loader.ts';
import { animatedFoliage, foliageGroup } from './state.ts';

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

function buildEntityFromInstanced(
    mesh: THREE.InstancedMesh,
    type: string,
    index: number
): CandyMapEntity {
    mesh.getMatrixAt(index, _instancedMatrix);
    _instancedMatrix.decompose(_worldPos, _worldQuat, _worldScale);
    return {
        id: `canonical:${type}:instanced:${index}`,
        type,
        position: [round(_worldPos.x), round(_worldPos.y), round(_worldPos.z)],
        rotation: {
            quat: [
                round(_worldQuat.x, 6),
                round(_worldQuat.y, 6),
                round(_worldQuat.z, 6),
                round(_worldQuat.w, 6),
            ],
        },
        scale: normalizeScale(_worldScale),
        category: inferCategory(type),
        layer: inferLayer(type),
        placement: type === 'cloud' || _worldPos.y > 8 ? 'absolute' : 'ground',
        params: { provenance: 'instanced-fallback', batched: true },
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
        const provenance =
            typeof entity.params?.provenance === 'string' ? entity.params.provenance : 'runtime';
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
            const mappedType = normalizeExportType(mesh.userData?.type);
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
            bounds: {
                min: [round(minX, 2), round(minZ, 2)],
                max: [round(maxX, 2), round(maxZ, 2)],
            },
            exportedAt: new Date().toISOString(),
            source: options.sourceLabel ?? 'runtime-export',
        },
        entities,
    };

    return {
        map,
        stats: {
            totalEntities: entities.length,
            byType,
            byProvenance,
            deduped,
        },
    };
}

export function installWorldExportTools(): void {
    if (typeof window === 'undefined') return;
    window.exportCurrentWorldToMap = async (options: WindowExportOptions = {}) => {
        const result = buildCanonicalMapFromWorld({
            includeInstancedFallback: options.includeInstancedFallback ?? true,
            sourceLabel: options.sourceLabel ?? 'window-export',
        });
        const fileName = options.fileName ?? 'canonical-part1-map.json';
        const json = JSON.stringify(result.map, null, 2);
        if (options.download !== false && typeof document !== 'undefined') {
            downloadJson(json, fileName);
        }
        return result;
    };
}
