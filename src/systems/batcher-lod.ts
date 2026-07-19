/**
 * Per-instance LOD updates for major foliage batchers.
 * Zero-allocation hot path: module-scope scratch buffers only.
 */
import * as THREE from 'three';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import { attribute, float, varyingProperty } from 'three/tsl';
import { CONFIG } from '../core/config.ts';
import { safeRemoveAndDispose } from '../utils/dispose-utils.ts';
import { INSTANCE_LOD_ATTR, ensureInstanceLodAttribute } from '../foliage/batcher-lod-utils.ts';
import { syncFoliageLodUniforms, uLodDebugHighlight } from '../foliage/lod-nodes.ts';
import { uAerialFogColor } from '../foliage/aerial-perspective.ts';
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
    impostorMaxFactor: number;
    impostorScaleMul: number;
    impostorAspect: number;
}

export interface FoliageLodStats {
    hero: number;
    mid: number;
    far: number;
    culled: number;
    impostors: number;
    /** Instances in hero↔mid or mid↔far cross-fade bands. */
    blendBand: number;
    total: number;
}

export interface BatcherLodTarget {
    id: string;
    getMeshes: () => THREE.InstancedMesh[];
}

const IMPOSTOR_ALPHA_ATTR = 'instanceImpostorAlpha';

const _cameraPos = new THREE.Vector3();
const _scratchMatrix = new THREE.Matrix4();
const _scratchScale = new THREE.Vector3();

const _stats: FoliageLodStats = {
    hero: 0,
    mid: 0,
    far: 0,
    culled: 0,
    impostors: 0,
    blendBand: 0,
    total: 0
};

const _targets: BatcherLodTarget[] = [];
const _meshTracks = new Map<THREE.InstancedMesh, Float32Array>();
const _meshMaxScales = new Map<THREE.InstancedMesh, Float32Array>(); // ⚡ OPTIMIZATION: Cache impostor scales to avoid Math.sqrt in hot loops

let _impostorMesh: THREE.InstancedMesh | null = null;
let _impostorCapacity = 4096;
let _debugHighlight = false;

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
        impostorMinFactor: lod.impostorMinFactor ?? 1.55,
        impostorMaxFactor: lod.impostorMaxFactor ?? 2.05,
        impostorScaleMul: lod.impostorScaleMul ?? 2.15,
        impostorAspect: lod.impostorAspect ?? 1.12,
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

/** True when instance is in a tier cross-fade band (for stats / debug). */
export function isInLodBlendBand(factor: number, cfg: FoliageLodConfig = getFoliageLodConfig()): boolean {
    if (factor >= 3) return false;
    if (factor > 0.75 && factor < 1.15) return true;
    if (factor > 1.45 && factor < 2.15) return true;
    if (factor >= cfg.impostorMinFactor && factor <= cfg.impostorMaxFactor) return true;
    return false;
}

function impostorAlphaFromFactor(factor: number, cfg: FoliageLodConfig): number {
    if (factor < cfg.impostorMinFactor) return 0;
    if (factor >= cfg.impostorMaxFactor) return 1;
    const t = (factor - cfg.impostorMinFactor) / (cfg.impostorMaxFactor - cfg.impostorMinFactor);
    return smoothstep01(t);
}

export function setFoliageLodDebugHighlight(enabled: boolean): void {
    _debugHighlight = enabled;
    uLodDebugHighlight.value = enabled ? 1.0 : 0.0;
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
    const aImpostorAlpha = attribute(IMPOSTOR_ALPHA_ATTR, 'float');
    const instanceColor = varyingProperty('vec3', 'vInstanceColor');
    const mat = new MeshBasicNodeMaterial({
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
    });
    mat.colorNode = instanceColor;
    mat.opacityNode = aImpostorAlpha.mul(float(0.92));

    _impostorMesh = new THREE.InstancedMesh(geo, mat, _impostorCapacity);
    _impostorMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(_impostorCapacity * 3), 3);
    geo.setAttribute(
        IMPOSTOR_ALPHA_ATTR,
        new THREE.InstancedBufferAttribute(new Float32Array(_impostorCapacity), 1)
    );
    _impostorMesh.frustumCulled = false;
    _impostorMesh.count = 0;
    _impostorMesh.name = 'FoliageFarImpostor';
    _impostorMesh.userData.isFoliageImpostor = true;
    foliageGroup.add(_impostorMesh);
    return _impostorMesh;
}

function _billboardMatrixFromCamera(
    camera: THREE.Camera,
    px: number,
    py: number,
    pz: number,
    width: number,
    height: number
): void {
    _scratchMatrix.makeRotationFromQuaternion(camera.quaternion);
    _scratchScale.set(width, height, 1);
    _scratchMatrix.scale(_scratchScale);
    _scratchMatrix.setPosition(px, py, pz);
    _billboardMatrix.copy(_scratchMatrix);
}

const _billboardMatrix = new THREE.Matrix4();

function accumulateStats(factor: number, cfg: FoliageLodConfig): void {
    if (isInLodBlendBand(factor, cfg)) _stats.blendBand++;
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

    syncFoliageLodUniforms();
    uLodDebugHighlight.value = _debugHighlight ? 1.0 : 0.0;

    _stats.hero = 0;
    _stats.mid = 0;
    _stats.far = 0;
    _stats.culled = 0;
    _stats.impostors = 0;
    _stats.blendBand = 0;
    _stats.total = 0;


    const impostor = cfg.useImpostors ? ensureImpostorMesh() : null;
    let alphaAttr: THREE.InstancedBufferAttribute | undefined, alphaArray: Float32Array | undefined, impostorCount = 0;
    const farCullSq = cfg.farCull * cfg.farCull;
    const fogR = uAerialFogColor.value.r;
    const fogG = uAerialFogColor.value.g;
    const fogB = uAerialFogColor.value.b;
    const aerialMix = 0.55;

    if (impostor) {
        alphaAttr = impostor.geometry.getAttribute(IMPOSTOR_ALPHA_ATTR) as THREE.InstancedBufferAttribute;
        alphaArray = alphaAttr.array as Float32Array;
    }

    camera.getWorldPosition(_cameraPos);
    const blendT = cfg.blendSeconds > 0 ? Math.min(1, delta / cfg.blendSeconds) : 1;

    for (const [mesh, smoothed] of _meshTracks) {
        const count = mesh.count;
        if (count === 0) continue;

        if (smoothed.length < mesh.instanceMatrix.count) {
            _meshTracks.set(mesh, new Float32Array(mesh.instanceMatrix.count));
            const maxScales = new Float32Array(mesh.instanceMatrix.count);
            maxScales.fill(-1);
            _meshMaxScales.set(mesh, maxScales);
            continue;
        }

        const maxScales = _meshMaxScales.get(mesh);
        const attr = ensureInstanceLodAttribute(mesh);
        const attrArray = attr.array as Float32Array;
        const matrixArray = mesh.instanceMatrix.array as Float32Array;
        const colorArray = mesh.instanceColor?.array as Float32Array | undefined;

        for (let i = 0; i < count; i++) {
            const offset = i * 16;
            const px = matrixArray[offset + 12];
            const py = matrixArray[offset + 13];
            const pz = matrixArray[offset + 14];

            const dx = px - _cameraPos.x;
            const dy = py - _cameraPos.y;
            const dz = pz - _cameraPos.z;
            const distSq = dx * dx + dy * dy + dz * dz;

            // ⚡ OPTIMIZATION: Bypassed redundant second loop and double distance calculations by updating impostors inline.
            const target = computeTargetLodFactorSq(distSq, cfg);
            const current = smoothed[i];
            const next = current + (target - current) * blendT;
            smoothed[i] = next;
            attrArray[i] = next;
            accumulateStats(next, cfg);

            if (impostor) {
                const factor = next;
                const alpha = impostorAlphaFromFactor(factor, cfg);
                if (alpha > 0.001 && factor < 3 && impostorCount < _impostorCapacity && distSq < farCullSq) {
                    // ⚡ OPTIMIZATION: Cache impostor scale to drop per-frame Math.sqrt
                    let size = cfg.impostorScaleMul;
                    let scaleVal = -1;
                    if (maxScales && maxScales[i] >= 0) {
                        scaleVal = maxScales[i];
                    } else {
                        const m00 = matrixArray[offset + 0], m01 = matrixArray[offset + 1], m02 = matrixArray[offset + 2];
                        const m10 = matrixArray[offset + 4], m11 = matrixArray[offset + 5], m12 = matrixArray[offset + 6];
                        const m20 = matrixArray[offset + 8], m21 = matrixArray[offset + 9], m22 = matrixArray[offset + 10];

                        const scaleXSq = m00 * m00 + m01 * m01 + m02 * m02;
                        const scaleYSq = m10 * m10 + m11 * m11 + m12 * m12;
                        const scaleZSq = m20 * m20 + m21 * m21 + m22 * m22;
                        const maxScaleSq = Math.max(scaleXSq, scaleYSq, scaleZSq);

                        scaleVal = Math.sqrt(maxScaleSq);
                        if (maxScales) maxScales[i] = scaleVal;
                    }
                    size = scaleVal * cfg.impostorScaleMul;

                    _billboardMatrixFromCamera(camera, px, py, pz, size, size * cfg.impostorAspect);
                    _billboardMatrix.toArray(impostor.instanceMatrix.array, impostorCount * 16);

                    if (impostor.instanceColor && colorArray) {
                        const dst = impostor.instanceColor.array as Float32Array;
                        const srcOff = i * 3;
                        const dstOff = impostorCount * 3;
                        const sr = colorArray[srcOff];
                        const sg = colorArray[srcOff + 1];
                        const sb = colorArray[srcOff + 2];
                        dst[dstOff] = sr * (1 - aerialMix) + fogR * aerialMix;
                        dst[dstOff + 1] = sg * (1 - aerialMix) + fogG * aerialMix;
                        dst[dstOff + 2] = sb * (1 - aerialMix) + fogB * aerialMix;
                    }

                    alphaArray![impostorCount] = alpha;
                    impostorCount++;
                }
            }
        }

        attr.needsUpdate = true;
    }

    if (impostor) {
        impostor.count = impostorCount;
        impostor.instanceMatrix.needsUpdate = true;
        if (impostor.instanceColor) impostor.instanceColor.needsUpdate = true;
        alphaAttr!.needsUpdate = true;
    } else if (_impostorMesh) {
        _impostorMesh.count = 0;
    }
    _stats.impostors = impostorCount;
}

export function refreshFoliageLodMesh(mesh: THREE.InstancedMesh): void {
    ensureInstanceLodAttribute(mesh);
    const prev = _meshTracks.get(mesh);
    const next = new Float32Array(mesh.instanceMatrix.count);
    if (prev) {
        next.set(prev);
    }
    _meshTracks.set(mesh, next);

    const prevScales = _meshMaxScales.get(mesh);
    const nextScales = new Float32Array(mesh.instanceMatrix.count);
    nextScales.fill(-1);
    if (prevScales) {
        nextScales.set(prevScales);
    }
    _meshMaxScales.set(mesh, nextScales);
}

export function getFoliageLodImpostorMesh(): THREE.InstancedMesh | null {
    return _impostorMesh;
}

export function disposeFoliageBatcherLOD(): void {
    _targets.length = 0;
    _meshTracks.clear();
    _meshMaxScales.clear();
    if (_impostorMesh) {
        safeRemoveAndDispose(foliageGroup as unknown as THREE.Scene, _impostorMesh);
        _impostorMesh = null;
    }
}

// Dev hooks
if (typeof window !== 'undefined') {
    const w = window as unknown as {
        __foliageLodStats?: () => Readonly<FoliageLodStats>;
        __setFoliageLodDebugHighlight?: (enabled: boolean) => void;
    };
    w.__foliageLodStats = getFoliageLodStats;
    w.__setFoliageLodDebugHighlight = setFoliageLodDebugHighlight;
}
