import * as THREE from 'three';
import { treeBatcher } from './tree-batcher.ts';
import { mushroomBatcher } from './mushroom-batcher.ts';
import { flowerBatcher } from './flower-batcher.ts';
import { simpleFlowerBatcher } from './simple-flower-batcher.ts';
import { CloudBatcher } from './cloud-batcher.ts';
import { luminousPlantBatcher } from './luminous-plant-batcher.ts';
import { gemFruitBatcher } from './gem-fruit-batcher.ts';
import { waterfallBatcher } from './waterfall-batcher.ts';
import { arpeggioFernBatcher } from './arpeggio-batcher.ts';
import { portamentoPineBatcher } from './portamento-batcher.ts';
import { dandelionBatcher } from './dandelion-batcher.ts';
import { lanternBatcher } from './lantern-batcher.ts';

export interface BatcherTelemetryEntry {
    id: string;
    label: string;
    instances: number;
    capacity: number;
    drawCalls: number;
    estimatedVramBytes: number;
}

export interface BatcherTelemetryReport {
    timestamp: number;
    totalInstances: number;
    totalCapacity: number;
    totalDrawCalls: number;
    totalEstimatedVramBytes: number;
    entries: BatcherTelemetryEntry[];
}

function toRecord(value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== 'object') return null;
    return value as Record<string, unknown>;
}

function getMesh(value: unknown): THREE.InstancedMesh | null {
    if (!value) return null;
    if (value instanceof THREE.InstancedMesh) return value;
    return null;
}

function getMeshesFromRecord(record: Record<string, unknown>, keys: readonly string[]): THREE.InstancedMesh[] {
    const meshes: THREE.InstancedMesh[] = [];
    for (const key of keys) {
        const mesh = getMesh(record[key]);
        if (mesh) meshes.push(mesh);
    }
    return meshes;
}

function estimateGeometryBytes(geometry: THREE.BufferGeometry): number {
    let bytes = 0;
    const attrs = geometry.attributes;
    for (const key of Object.keys(attrs)) {
        const attr = attrs[key] as THREE.BufferAttribute | THREE.InterleavedBufferAttribute;
        const attrArray = (attr as { array?: ArrayBufferView }).array;
        if (attrArray && 'byteLength' in attrArray) bytes += attrArray.byteLength;
    }
    if (geometry.index?.array) bytes += geometry.index.array.byteLength;
    return bytes;
}

function estimateMeshBytes(mesh: THREE.InstancedMesh): number {
    let bytes = estimateGeometryBytes(mesh.geometry);
    if (mesh.instanceMatrix?.array) bytes += mesh.instanceMatrix.array.byteLength;
    if (mesh.instanceColor?.array) bytes += mesh.instanceColor.array.byteLength;
    return bytes;
}

function summarize(label: string, id: string, meshes: THREE.InstancedMesh[]): BatcherTelemetryEntry {
    let instances = 0;
    let capacity = 0;
    let drawCalls = 0;
    let estimatedVramBytes = 0;
    for (const mesh of meshes) {
        instances += mesh.count;
        capacity += mesh.instanceMatrix.count;
        drawCalls += 1;
        estimatedVramBytes += estimateMeshBytes(mesh);
    }
    return { id, label, instances, capacity, drawCalls, estimatedVramBytes };
}

export function collectBatcherTelemetry(): BatcherTelemetryReport {
    const treeStats = treeBatcher.getStats();
    const treeCapacity = treeStats.trunks.capacity + treeStats.spheres.capacity + treeStats.capsules.capacity + treeStats.helices.capacity + treeStats.roses.capacity;
    const treeInstances = treeStats.trunks.count + treeStats.spheres.count + treeStats.capsules.count + treeStats.helices.count + treeStats.roses.count;

    const flowerRecord = toRecord(flowerBatcher);
    const simpleFlowerRecord = toRecord(simpleFlowerBatcher);
    const arpeggioRecord = toRecord(arpeggioFernBatcher);
    const portamentoRecord = toRecord(portamentoPineBatcher);
    const dandelionRecord = toRecord(dandelionBatcher);
    const lanternRecord = toRecord(lanternBatcher);

    const entries: BatcherTelemetryEntry[] = [
        {
            id: 'tree',
            label: 'TreeBatcher',
            instances: treeInstances,
            capacity: treeCapacity,
            drawCalls: 5,
            estimatedVramBytes: treeCapacity * 192
        },
        summarize('MushroomBatcher', 'mushroom', [mushroomBatcher.mesh].filter((m): m is THREE.InstancedMesh => !!m)),
        summarize('FlowerBatcher', 'flower', flowerRecord ? getMeshesFromRecord(flowerRecord, ['stems', 'centers', 'stamens', 'petalsSimple', 'petalsMulti', 'petalsSpiral']) : []),
        summarize('SimpleFlowerBatcher', 'simple-flower', simpleFlowerRecord ? getMeshesFromRecord(simpleFlowerRecord, ['stemMesh', 'petalMesh', 'centerMesh', 'stamenMesh', 'beamMesh']) : []),
        summarize(
            'CloudBatcher',
            'cloud',
            [
                cloudPrimary ? getMesh(cloudPrimary.mesh) : null,
                cloudWalkable ? getMesh(cloudWalkable.mesh) : null
            ].filter((m): m is THREE.InstancedMesh => !!m)
        ),
        summarize('LuminousPlantBatcher', 'luminous', [luminousPlantBatcher?.mesh].filter((m): m is THREE.InstancedMesh => !!m)),
        summarize('GemFruitBatcher', 'gem_canopy', gemFruitBatcher?.meshes ?? []),
        summarize('WaterfallBatcher', 'waterfall', [waterfallBatcher?.mesh, waterfallBatcher?.splashMesh].filter((m): m is THREE.InstancedMesh => !!m)),
        summarize('ArpeggioFernBatcher', 'arpeggio', arpeggioRecord ? getMeshesFromRecord(arpeggioRecord, ['mesh']) : []),
        summarize('PortamentoPineBatcher', 'portamento', portamentoRecord ? getMeshesFromRecord(portamentoRecord, ['trunkMesh', 'needleMesh']) : []),
        summarize('DandelionBatcher', 'dandelion', dandelionRecord ? getMeshesFromRecord(dandelionRecord, ['mesh']) : []),
        summarize('LanternBatcher', 'lantern', lanternRecord ? getMeshesFromRecord(lanternRecord, ['stemMesh', 'topMesh']) : []),
    ];

    let totalInstances = 0;
    let totalCapacity = 0;
    let totalDrawCalls = 0;
    let totalEstimatedVramBytes = 0;
    for (const entry of entries) {
        totalInstances += entry.instances;
        totalCapacity += entry.capacity;
        totalDrawCalls += entry.drawCalls;
        totalEstimatedVramBytes += entry.estimatedVramBytes;
    }

    return {
        timestamp: Date.now(),
        totalInstances,
        totalCapacity,
        totalDrawCalls,
        totalEstimatedVramBytes,
        entries
    };
}

export function installBatcherTelemetry(): void {
    if (typeof window === 'undefined') return;
    window.__getBatcherTelemetry = collectBatcherTelemetry;
}
    const cloudPrimary = toRecord(CloudBatcher.getInstance());
    const cloudWalkable = toRecord(CloudBatcher.getWalkableInstance());
