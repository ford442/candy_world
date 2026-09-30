import * as THREE from 'three';
import { arpeggioFernBatcher } from './arpeggio-batcher.ts';
import { getCandyDebrisStats, MAX_DEBRIS } from './candy-debris-batcher.ts';
import { CloudBatcher } from './cloud-batcher.ts';
import { dandelionBatcher } from './dandelion-batcher.ts';
import { FaunaBatcher } from './fauna-batcher.ts';
import { flowerBatcher } from './flower-batcher.ts';
import { gemFruitBatcher } from './gem-fruit-batcher.ts';
import { glassMushroomBatcher } from './glass-mushroom-batcher.ts';
import { glowingFlowerBatcher } from './glowing-flower-batcher.ts';
import { kickDrumGeyserBatcher } from './kick-drum-geyser-batcher.ts';
import { lanternBatcher } from './lantern-batcher.ts';
import { luminousPlantBatcher } from './luminous-plant-batcher.ts';
import { mushroomBatcher } from './mushroom-batcher/index.ts';
import { nightMarketBatcher } from './night-market-batcher.ts';
import { portamentoPineBatcher } from './portamento-batcher.ts';
import { simpleFlowerBatcher } from './simple-flower-batcher.ts';
import { subwooferLotusBatcher } from './subwoofer-lotus-batcher.ts';
import { sugarCaveBatcher } from './sugar-cave-batcher.ts';
import { treeBatcher } from './tree-batcher.ts';
import { waterfallBatcher } from './waterfall-batcher.ts';

export interface BatcherTelemetryEntry {
    id: string;
    label: string;
    instances: number;
    capacity: number;
    drawCalls: number;
    estimatedVramBytes: number;
    /**
     * Live `byteLength` of the per-instance buffers (instanceMatrix, instanceColor and
     * instanced geometry attributes). Unlike `estimatedVramBytes` this is read off the
     * typed arrays, so it moves if a batcher ever reallocates — a load → walk-away →
     * return loop must leave it flat.
     */
    byteLength: number;
}

export interface BatcherTelemetryReport {
    timestamp: number;
    totalInstances: number;
    totalCapacity: number;
    totalDrawCalls: number;
    totalEstimatedVramBytes: number;
    totalByteLength: number;
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

function getMeshesFromRecord(
    record: Record<string, unknown>,
    keys: readonly string[]
): THREE.InstancedMesh[] {
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
    // ⚡ OPTIMIZATION: Bypassed Object.keys() to prevent GC spikes when estimating geometry sizes
    for (const key in attrs) {
        if (Object.prototype.hasOwnProperty.call(attrs, key)) {
            const attr = attrs[key] as THREE.BufferAttribute | THREE.InterleavedBufferAttribute;
            const attrArray = (attr as { array?: ArrayBufferView }).array;
            if (attrArray && 'byteLength' in attrArray) bytes += attrArray.byteLength;
        }
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

function instanceBufferBytes(mesh: THREE.InstancedMesh): number {
    let bytes = mesh.instanceMatrix?.array?.byteLength ?? 0;
    if (mesh.instanceColor?.array) bytes += mesh.instanceColor.array.byteLength;
    const attrs = mesh.geometry.attributes;
    for (const key in attrs) {
        const attr = attrs[key] as THREE.BufferAttribute & { isInstancedBufferAttribute?: boolean };
        if (attr.isInstancedBufferAttribute) bytes += attr.array.byteLength;
    }
    return bytes;
}

function summarize(
    label: string,
    id: string,
    meshes: THREE.InstancedMesh[]
): BatcherTelemetryEntry {
    let instances = 0;
    let capacity = 0;
    let drawCalls = 0;
    let estimatedVramBytes = 0;
    let byteLength = 0;
    for (const mesh of meshes) {
        instances += mesh.count;
        capacity += mesh.instanceMatrix.count;
        drawCalls += 1;
        estimatedVramBytes += estimateMeshBytes(mesh);
        byteLength += instanceBufferBytes(mesh);
    }
    return { id, label, instances, capacity, drawCalls, estimatedVramBytes, byteLength };
}

export function collectBatcherTelemetry(): BatcherTelemetryReport {
    const treeStats = treeBatcher.getStats();
    const treeCapacity =
        treeStats.trunks.capacity +
        treeStats.spheres.capacity +
        treeStats.capsules.capacity +
        treeStats.helices.capacity +
        treeStats.roses.capacity;
    const treeInstances =
        treeStats.trunks.count +
        treeStats.spheres.count +
        treeStats.capsules.count +
        treeStats.helices.count +
        treeStats.roses.count;

    const treeRecord = toRecord(treeBatcher);
    const flowerRecord = toRecord(flowerBatcher);
    const simpleFlowerRecord = toRecord(simpleFlowerBatcher);
    const arpeggioRecord = toRecord(arpeggioFernBatcher);
    const portamentoRecord = toRecord(portamentoPineBatcher);
    const dandelionRecord = toRecord(dandelionBatcher);
    const lanternRecord = toRecord(lanternBatcher);

    const cloudPrimary = toRecord(CloudBatcher.getInstance());
    const cloudWalkable = toRecord(CloudBatcher.getWalkableInstance());
    const entries: BatcherTelemetryEntry[] = [
        {
            id: 'tree',
            label: 'TreeBatcher',
            instances: treeInstances,
            capacity: treeCapacity,
            drawCalls: 5,
            estimatedVramBytes: treeCapacity * 192,
            byteLength: treeRecord
                ? getMeshesFromRecord(treeRecord, [
                      'trunks',
                      'spheres',
                      'capsules',
                      'helices',
                      'roses',
                      'accordionLeaves',
                  ]).reduce((sum, mesh) => sum + instanceBufferBytes(mesh), 0)
                : 0,
        },
        // ⚡ OPTIMIZATION: Bypassed .filter() array allocation to prevent GC spikes
        summarize(
            'MushroomBatcher',
            'mushroom',
            mushroomBatcher.mesh ? [mushroomBatcher.mesh] : []
        ),
        summarize(
            'FlowerBatcher',
            'flower',
            flowerRecord
                ? getMeshesFromRecord(flowerRecord, [
                      'stems',
                      'centers',
                      'stamens',
                      'petalsSimple',
                      'petalsMulti',
                      'petalsSpiral',
                  ])
                : []
        ),
        summarize(
            'SimpleFlowerBatcher',
            'simple-flower',
            simpleFlowerRecord
                ? getMeshesFromRecord(simpleFlowerRecord, [
                      'stemMesh',
                      'petalMesh',
                      'centerMesh',
                      'stamenMesh',
                      'beamMesh',
                  ])
                : []
        ),
        // ⚡ OPTIMIZATION: Bypassed .filter() array allocation to prevent GC spikes
        summarize(
            'CloudBatcher',
            'cloud',
            (() => {
                const arr: THREE.InstancedMesh[] = [];
                const p = cloudPrimary ? getMesh(cloudPrimary.mesh) : null;
                if (p) arr.push(p);
                const w = cloudWalkable ? getMesh(cloudWalkable.mesh) : null;
                if (w) arr.push(w);
                return arr;
            })()
        ),
        // ⚡ OPTIMIZATION: Bypassed .filter() array allocation to prevent GC spikes
        summarize(
            'LuminousPlantBatcher',
            'luminous',
            luminousPlantBatcher?.mesh ? [luminousPlantBatcher.mesh] : []
        ),
        summarize('GemFruitBatcher', 'gem_canopy', gemFruitBatcher?.meshes ?? []),
        // ⚡ OPTIMIZATION: Bypassed .filter() array allocation to prevent GC spikes
        summarize(
            'GlassMushroomBatcher',
            'glass_mushroom',
            glassMushroomBatcher?.mesh ? [glassMushroomBatcher.mesh] : []
        ),
        // ⚡ OPTIMIZATION: Bypassed .filter() array allocation to prevent GC spikes
        summarize(
            'WaterfallBatcher',
            'waterfall',
            (() => {
                const arr: THREE.InstancedMesh[] = [];
                if (waterfallBatcher?.mesh) arr.push(waterfallBatcher.mesh);
                if (waterfallBatcher?.splashMesh) arr.push(waterfallBatcher.splashMesh);
                return arr;
            })()
        ),
        summarize(
            'ArpeggioFernBatcher',
            'arpeggio',
            arpeggioRecord ? getMeshesFromRecord(arpeggioRecord, ['mesh']) : []
        ),
        summarize(
            'PortamentoPineBatcher',
            'portamento',
            portamentoRecord
                ? getMeshesFromRecord(portamentoRecord, ['trunkMesh', 'needleMesh'])
                : []
        ),
        summarize(
            'DandelionBatcher',
            'dandelion',
            dandelionRecord ? getMeshesFromRecord(dandelionRecord, ['mesh']) : []
        ),
        summarize(
            'LanternBatcher',
            'lantern',
            lanternRecord ? getMeshesFromRecord(lanternRecord, ['stemMesh', 'topMesh']) : []
        ),
        (() => {
            // Debris is lazily constructed, so read its stats rather than its mesh —
            // summarize() would report a phantom 0/0 entry before the first burst.
            const debris = getCandyDebrisStats();
            return {
                id: 'candy_debris',
                label: 'CandyDebrisBatcher',
                instances: debris.count,
                capacity: MAX_DEBRIS,
                drawCalls: debris.drawCalls,
                estimatedVramBytes: MAX_DEBRIS * 76,
                byteLength: debris.byteLength,
            };
        })(),
        // Species the chunk streamer evicts (or, for fauna, a fixed ambient population):
        // reported so a load → walk-away → return loop can be watched per batcher.
        summarize(
            'SubwooferLotusBatcher',
            'subwoofer_lotus',
            getMeshesFromRecord(toRecord(subwooferLotusBatcher) ?? {}, [
                'padMesh',
                'ringsMesh',
                'centerMesh',
            ])
        ),
        summarize(
            'GlowingFlowerBatcher',
            'glowing_flower',
            getMeshesFromRecord(toRecord(glowingFlowerBatcher) ?? {}, [
                'stemMesh',
                'headMesh',
                'washMesh',
            ])
        ),
        summarize(
            'SugarCaveBatcher',
            'sugar_cave',
            sugarCaveBatcher.mesh ? [sugarCaveBatcher.mesh] : []
        ),
        summarize(
            'KickDrumGeyserBatcher',
            'kick_drum_geyser',
            getMeshesFromRecord(toRecord(kickDrumGeyserBatcher) ?? {}, [
                'baseMesh',
                'coreMesh',
                'plumeMesh',
            ])
        ),
        summarize(
            'NightMarketBatcher',
            'night_market',
            getMeshesFromRecord(toRecord(nightMarketBatcher) ?? {}, [
                'frameMesh',
                'awningMesh',
                'lanternMesh',
            ])
        ),
        summarize('FaunaBatcher', 'fauna', FaunaBatcher.getInstance().getMeshes()),
    ];

    let totalInstances = 0;
    let totalCapacity = 0;
    let totalDrawCalls = 0;
    let totalEstimatedVramBytes = 0;
    let totalByteLength = 0;
    for (const entry of entries) {
        totalInstances += entry.instances;
        totalCapacity += entry.capacity;
        totalDrawCalls += entry.drawCalls;
        totalEstimatedVramBytes += entry.estimatedVramBytes;
        totalByteLength += entry.byteLength;
    }

    return {
        timestamp: Date.now(),
        totalInstances,
        totalCapacity,
        totalDrawCalls,
        totalEstimatedVramBytes,
        totalByteLength,
        entries,
    };
}

export function installBatcherTelemetry(): void {
    if (typeof window === 'undefined') return;
    window.__getBatcherTelemetry = collectBatcherTelemetry;
    (window as any).__batcherCounts = () => {
        const report = collectBatcherTelemetry();
        const counts: Record<string, number> = {};
        for (const entry of report.entries) {
            counts[entry.id] = entry.instances;
        }
        return counts;
    };
    // Same keys as __batcherCounts, with the live instance-buffer byteLength alongside.
    // A stream-out that really frees slots leaves `byteLength` flat and `count` falling.
    window.__batcherBuffers = () => {
        const report = collectBatcherTelemetry();
        const buffers: Record<string, { count: number; byteLength: number }> = {};
        for (const entry of report.entries) {
            buffers[entry.id] = { count: entry.instances, byteLength: entry.byteLength };
        }
        return buffers;
    };
}
