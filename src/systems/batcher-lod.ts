/**
 * Per-instance LOD updates for major foliage batchers.
 * Zero-allocation hot path: module-scope scratch buffers only.
 */
import * as THREE from 'three';
import { CONFIG } from '../core/config.ts';
import { INSTANCE_LOD_ATTR, ensureInstanceLodAttribute } from '../foliage/batcher-lod-utils.ts';
import { foliageGroup } from '../world/state.ts';

export interface FoliageLodConfig {
    enabled: boolean;
    heroMax: number;
    midMax: number;
    blendWidth: number;
    blendSeconds: number;
    farCull: number;
    useImpostors: boolean;
    impostorMinFactor: number;
}

export interface FoliageLodStats {
    hero: number;
    mid: number;
    far: number;
    culled: number;
    impostors: number;
    total: number;
}

export interface BatcherLodTarget {
    id: string;
    getMeshes: () => THREE.InstancedMesh[];
}

const _cameraPos = new THREE.Vector3();
const _instancePos = new THREE.Vector3();
const _scratchMatrix = new THREE.Matrix4();
const _scratchQuat = new THREE.Quaternion();
const _scratchScale = new THREE.Vector3();
const _scratchEuler = new THREE.Euler();
const _billboardMatrix = new THREE.Matrix4();

const _stats: FoliageLodStats = {
    hero: 0,
    mid: 0,
    far: 0,
    culled: 0,
    impostors: 0,
    total: 0
};

const _targets: BatcherLodTarget[] = [];
const _meshTracks = new Map<THREE.InstancedMesh, Float32Array>();

let _impostorMesh: THREE.InstancedMesh | null = null;
let _impostorCapacity = 4096;

export function getFoliageLodConfig(): FoliageLodConfig {
    const lod = CONFIG.foliage?.lod ?? {};
    return {
        enabled: lod.enabled !== false,
        heroMax: lod.heroMax ?? 120,
        midMax: lod.midMax ?? 365,
        blendWidth: lod.blendWidth ?? 30,
        blendSeconds: lod.blendSeconds ?? 0.5,
        farCull: lod.farCull ?? 480,
        useImpostors: lod.useImpostors !== false,
        impostorMinFactor: lod.impostorMinFactor ?? 1.65
    };
}

/** Pure distance → target LOD factor (0 hero, 1 mid, 2 far, 3 culled). Exported for tests. */
export function computeTargetLodFactor(
    distance: number,
    cfg: Pick<FoliageLodConfig, 'heroMax' | 'midMax' | 'blendWidth' | 'farCull'> = getFoliageLodConfig()
): number {
    if (distance >= cfg.farCull) return 3;

    const bw = Math.max(1, cfg.blendWidth);
    const heroEdge = cfg.heroMax;
    const midEdge = cfg.midMax;

    if (distance <= heroEdge - bw) return 0;
    if (distance <= heroEdge + bw) {
        const t = (distance - (heroEdge - bw)) / (2 * bw);
        return smoothstep01(t);
    }
    if (distance <= midEdge - bw) return 1;
    if (distance <= midEdge + bw) {
        const t = (distance - (midEdge - bw)) / (2 * bw);
        return 1 + smoothstep01(t);
    }
    return 2;
}

/**
 * ⚡ OPTIMIZATION: Pure squared distance → target LOD factor.
 * Defers Math.sqrt() until we are exactly within a blend range.
 */
export function computeTargetLodFactorSq(
    distSq: number,
    cfg: Pick<FoliageLodConfig, 'heroMax' | 'midMax' | 'blendWidth' | 'farCull'> = getFoliageLodConfig()
): number {
    if (distSq >= cfg.farCull * cfg.farCull) return 3;

    const bw = Math.max(1, cfg.blendWidth);
    const heroEdge = cfg.heroMax;
    const midEdge = cfg.midMax;

    const heroMin = heroEdge - bw;
    if (heroMin >= 0 && distSq <= heroMin * heroMin) return 0;

    const heroMax = heroEdge + bw;
    if (distSq <= heroMax * heroMax) {
        const distance = Math.sqrt(distSq);
        const t = (distance - heroMin) / (2 * bw);
        return smoothstep01(t);
    }

    const midMin = midEdge - bw;
    if (midMin >= 0 && distSq <= midMin * midMin) return 1;

    const midMax = midEdge + bw;
    if (distSq <= midMax * midMax) {
        const distance = Math.sqrt(distSq);
        const t = (distance - midMin) / (2 * bw);
        return 1 + smoothstep01(t);
    }
    return 2;
}

function smoothstep01(t: number): number {
    const x = Math.max(0, Math.min(1, t));
    return x * x * (3 - 2 * x);
}

export function registerFoliageBatcherLod(target: BatcherLodTarget): void {
    if (_targets.some((t) => t.id === target.id)) return;
    _targets.push(target);
    for (const mesh of target.getMeshes()) {
        trackLodMesh(mesh);
    }
}

function trackLodMesh(mesh: THREE.InstancedMesh): void {
    if (_meshTracks.has(mesh)) return;
    ensureInstanceLodAttribute(mesh);
    _meshTracks.set(mesh, new Float32Array(mesh.instanceMatrix.count));
    mesh.userData.foliageLodTracked = true;
}

function ensureImpostorMesh(): THREE.InstancedMesh {
    if (_impostorMesh) return _impostorMesh;

    const geo = new THREE.PlaneGeometry(1, 1);
    const mat = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.82,
        side: THREE.DoubleSide,
        depthWrite: false
    });

    _impostorMesh = new THREE.InstancedMesh(geo, mat, _impostorCapacity);
    _impostorMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(_impostorCapacity * 3), 3);
    _impostorMesh.frustumCulled = false;
    _impostorMesh.count = 0;
    _impostorMesh.name = 'FoliageFarImpostor';
    _impostorMesh.userData.isFoliageImpostor = true;
    foliageGroup.add(_impostorMesh);
    return _impostorMesh;
}

function updateImpostors(
    camera: THREE.Camera,
    cfg: FoliageLodConfig,
    smoothed: Map<THREE.InstancedMesh, Float32Array>
): number {
    if (!cfg.useImpostors) {
        if (_impostorMesh) _impostorMesh.count = 0;
        return 0;
    }

    const impostor = ensureImpostorMesh();
    let impostorCount = 0;
    camera.getWorldPosition(_cameraPos);

    const farCullSq = cfg.farCull * cfg.farCull;

    for (const [mesh, factors] of smoothed) {
        const count = mesh.count;
        if (count === 0) continue;

        const matrixArray = mesh.instanceMatrix.array as Float32Array;
        const colorArray = mesh.instanceColor?.array as Float32Array | undefined;

        for (let i = 0; i < count; i++) {
            const factor = factors[i];
            if (factor < cfg.impostorMinFactor || factor >= 3) continue;
            if (impostorCount >= _impostorCapacity) break;

            _scratchMatrix.fromArray(matrixArray, i * 16);
            _scratchMatrix.decompose(_instancePos, _scratchQuat, _scratchScale);

            const dx = _instancePos.x - _cameraPos.x;
            const dy = _instancePos.y - _cameraPos.y;
            const dz = _instancePos.z - _cameraPos.z;
            const distSq = dx * dx + dy * dy + dz * dz;
            // ⚡ OPTIMIZATION: Deferred Math.sqrt() by using squared distance for early-out far cull check.
            if (distSq >= farCullSq) continue;

            const size = Math.max(_scratchScale.x, _scratchScale.y, _scratchScale.z) * 2.2;
            _billboardMatrix.makeRotationFromQuaternion(camera.quaternion);
            _billboardMatrix.setPosition(_instancePos);
            _billboardMatrix.scale(new THREE.Vector3(size, size * 1.15, 1));
            _billboardMatrix.toArray(impostor.instanceMatrix.array, impostorCount * 16);

            if (impostor.instanceColor && colorArray) {
                const dst = impostor.instanceColor.array as Float32Array;
                const srcOff = i * 3;
                const dstOff = impostorCount * 3;
                dst[dstOff] = colorArray[srcOff];
                dst[dstOff + 1] = colorArray[srcOff + 1];
                dst[dstOff + 2] = colorArray[srcOff + 2];
            }

            impostorCount++;
        }
    }

    impostor.count = impostorCount;
    impostor.instanceMatrix.needsUpdate = true;
    if (impostor.instanceColor) impostor.instanceColor.needsUpdate = true;
    return impostorCount;
}

function accumulateStats(factor: number): void {
    if (factor >= 3) _stats.culled++;
    else if (factor >= 1.55) _stats.far++;
    else if (factor >= 0.85) _stats.mid++;
    else _stats.hero++;
    _stats.total++;
}

export function getFoliageLodStats(): Readonly<FoliageLodStats> {
    return _stats;
}

export function updateFoliageBatcherLOD(camera: THREE.Camera, delta: number): void {
    const cfg = getFoliageLodConfig();
    if (!cfg.enabled || _meshTracks.size === 0) return;

    _stats.hero = 0;
    _stats.mid = 0;
    _stats.far = 0;
    _stats.culled = 0;
    _stats.impostors = 0;
    _stats.total = 0;

    camera.getWorldPosition(_cameraPos);
    const blendT = cfg.blendSeconds > 0 ? Math.min(1, delta / cfg.blendSeconds) : 1;

    for (const [mesh, smoothed] of _meshTracks) {
        const count = mesh.count;
        if (count === 0) continue;

        if (smoothed.length < mesh.instanceMatrix.count) {
            _meshTracks.set(mesh, new Float32Array(mesh.instanceMatrix.count));
            continue;
        }

        const attr = ensureInstanceLodAttribute(mesh);
        const attrArray = attr.array as Float32Array;
        const matrixArray = mesh.instanceMatrix.array as Float32Array;

        for (let i = 0; i < count; i++) {
            _scratchMatrix.fromArray(matrixArray, i * 16);
            _instancePos.setFromMatrixPosition(_scratchMatrix);
            const dx = _instancePos.x - _cameraPos.x;
            const dy = _instancePos.y - _cameraPos.y;
            const dz = _instancePos.z - _cameraPos.z;
            const distSq = dx * dx + dy * dy + dz * dz;

            // ⚡ OPTIMIZATION: Pass squared distance to defer Math.sqrt() in LOD computation.
            const target = computeTargetLodFactorSq(distSq, cfg);
            const current = smoothed[i];
            const next = current + (target - current) * blendT;
            smoothed[i] = next;
            attrArray[i] = next;
            accumulateStats(next);
        }

        attr.needsUpdate = true;
    }

    _stats.impostors = updateImpostors(camera, cfg, _meshTracks);
}

export function refreshFoliageLodMesh(mesh: THREE.InstancedMesh): void {
    ensureInstanceLodAttribute(mesh);
    const prev = _meshTracks.get(mesh);
    const next = new Float32Array(mesh.instanceMatrix.count);
    if (prev) {
        next.set(prev);
    }
    _meshTracks.set(mesh, next);
}

export function getFoliageLodImpostorMesh(): THREE.InstancedMesh | null {
    return _impostorMesh;
}

export function disposeFoliageBatcherLOD(): void {
    _targets.length = 0;
    _meshTracks.clear();
    if (_impostorMesh) {
        foliageGroup.remove(_impostorMesh);
        _impostorMesh.geometry.dispose();
        (_impostorMesh.material as THREE.Material).dispose();
        _impostorMesh = null;
    }
}

// Dev hook
if (typeof window !== 'undefined') {
    (window as unknown as { __foliageLodStats?: () => Readonly<FoliageLodStats> }).__foliageLodStats = getFoliageLodStats;
}
