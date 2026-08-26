/**
 * Forward+ clustered local lights on the shared WebGPU device.
 *
 * v1 bins on the CPU into a 16×8×16 view-space grid and uploads two storage
 * buffers the renderer already owns — no second `requestDevice()`. Compute
 * binning is a follow-up if the `ClusteredLighting` profiler mark exceeds
 * CLUSTER_BIN_BUDGET_MS_*.
 *
 * @see docs/CLUSTERED_LIGHTS.md
 */
import * as THREE from 'three';
import {
    uniform,
    storage,
    float,
    vec3,
    positionView,
    Loop,
    uint,
    cameraProjectionMatrix,
    vec4,
    max,
    dot,
    pow,
    mix,
    log,
    clamp,
    smoothstep,
    step,
} from 'three/tsl';
import { StorageInstancedBufferAttribute } from 'three/webgpu';
import { CONFIG } from '../core/config/defaults.ts';
import { FEATURE_FLAGS, hasUrlFlag } from '../core/config/url-flags.ts';
import { getStartupCapabilities } from '../core/startup/capabilities.ts';
import { isGpuComputeAvailable, onGpuDeviceLost } from './gpu-context.ts';
import { forEachLocalLight, getLocalLightStats, muteAnalyticLocalLights } from './lights.ts';
import {
    CLUSTER_GRID_X,
    CLUSTER_GRID_Y,
    CLUSTER_GRID_Z,
    LIGHT_FLOATS,
    binLightViewSphere,
    clusterCount,
    clusterStride,
    packLight,
    resetClusterCounts,
} from './clustered-bin.ts';

const _worldPos = new THREE.Vector3();
const _viewPos = new THREE.Vector3();

export interface ClusteredLightingStats {
    enabled: boolean;
    reason: string;
    lights: number;
    clustersWritten: number;
    lastBinMs: number;
    maxLights: number;
    maxLightsPerCluster: number;
    budgetMs: number;
}

function clampMaxLights(n: number | undefined): number {
    if (!Number.isFinite(n)) return 128;
    return Math.max(8, Math.min(128, Math.round(n as number)));
}

function clampPerCluster(n: number | undefined): number {
    if (!Number.isFinite(n)) return 32;
    return Math.max(4, Math.min(32, Math.round(n as number)));
}

/**
 * Shader + CPU path. WebGL / `low` / `?no_clustered` stay on hemisphere+sun
 * plus the tiny Three.js local pool.
 */
export function areClusteredLightsEnabled(): boolean {
    if (!FEATURE_FLAGS.clusteredLights || hasUrlFlag('no_clustered')) return false;
    try {
        if (getLocalLightStats().webgl) return false;
    } catch {
        return false;
    }
    try {
        if (getStartupCapabilities().graphics === 'low') return false;
    } catch {
        /* non-browser tests */
    }
    return true;
}

export class ClusteredLightingSystem {
    public maxLights: number;
    public maxLightsPerCluster: number;
    public gridX: number;
    public gridY: number;
    public gridZ: number;

    private lightData: Float32Array;
    private lightBuffer: StorageInstancedBufferAttribute;
    private clusterData: Uint32Array;
    private clusterBuffer: StorageInstancedBufferAttribute;

    private numLightsUniform: ReturnType<typeof uniform>;
    private nearUniform: ReturnType<typeof uniform>;
    private farUniform: ReturnType<typeof uniform>;
    private scaleZUniform: ReturnType<typeof uniform>;

    private lastLights = 0;
    private lastClustersWritten = 0;
    private lastBinMs = 0;
    private lastReason = 'init';

    constructor() {
        this.maxLights = clampMaxLights(CONFIG.lighting.maxClusterLights);
        this.maxLightsPerCluster = clampPerCluster(CONFIG.lighting.maxLightsPerCluster);
        this.gridX = CLUSTER_GRID_X;
        this.gridY = CLUSTER_GRID_Y;
        this.gridZ = CLUSTER_GRID_Z;

        this.lightData = new Float32Array(this.maxLights * LIGHT_FLOATS);
        this.lightBuffer = new StorageInstancedBufferAttribute(this.lightData, LIGHT_FLOATS);

        const numClusters = clusterCount(this.gridX, this.gridY, this.gridZ);
        const stride = clusterStride(this.maxLightsPerCluster);
        this.clusterData = new Uint32Array(numClusters * stride);
        this.clusterBuffer = new StorageInstancedBufferAttribute(this.clusterData, stride);

        this.numLightsUniform = uniform(0);
        this.nearUniform = uniform(1.0);
        this.farUniform = uniform(200.0);
        this.scaleZUniform = uniform(1.0);

        onGpuDeviceLost(() => {
            this.numLightsUniform.value = 0;
            muteAnalyticLocalLights(false);
            this.lastReason = 'device-lost';
            publishStats(this.snapshot());
        });
    }

    public update(camera: THREE.PerspectiveCamera): void {
        const t0 = performance.now();
        if (!areClusteredLightsEnabled()) {
            this.numLightsUniform.value = 0;
            muteAnalyticLocalLights(false);
            this.lastLights = 0;
            this.lastClustersWritten = 0;
            this.lastBinMs = performance.now() - t0;
            this.lastReason = 'disabled';
            publishStats(this.snapshot());
            return;
        }
        if (!isGpuComputeAvailable()) {
            this.numLightsUniform.value = 0;
            muteAnalyticLocalLights(false);
            this.lastReason = 'no-device';
            this.lastBinMs = performance.now() - t0;
            publishStats(this.snapshot());
            return;
        }

        muteAnalyticLocalLights(true);

        const near = Math.max(0.1, camera.near);
        const far = Math.max(near + 1, camera.far);
        this.nearUniform.value = near;
        this.farUniform.value = far;
        this.scaleZUniform.value = this.gridZ / Math.log(far / near);

        const numClusters = clusterCount(this.gridX, this.gridY, this.gridZ);
        const stride = clusterStride(this.maxLightsPerCluster);
        resetClusterCounts(this.clusterData, numClusters, stride);

        const viewMatrix = camera.matrixWorldInverse;
        let numLights = 0;
        let clustersWritten = 0;

        forEachLocalLight((snap) => {
            if (numLights >= this.maxLights) return;
            if (snap.intensity <= 0) return;

            if (snap.parent) {
                snap.parent.updateMatrixWorld();
                if (snap.gpu) {
                    _worldPos.setFromMatrixPosition(snap.parent.matrixWorld);
                } else {
                    _worldPos.set(snap.localX, snap.localY, snap.localZ);
                    _worldPos.applyMatrix4(snap.parent.matrixWorld);
                }
            } else {
                _worldPos.set(0, 0, 0);
            }

            packLight(
                this.lightData,
                numLights,
                _worldPos,
                snap.distance || 10,
                snap.color,
                snap.intensity,
                snap.dirX,
                snap.dirY,
                snap.dirZ,
                snap.coneCos
            );

            _viewPos.copy(_worldPos).applyMatrix4(viewMatrix);
            clustersWritten += binLightViewSphere(
                this.clusterData,
                numLights,
                _viewPos,
                snap.distance || 10,
                near,
                far,
                camera.projectionMatrix,
                this.gridX,
                this.gridY,
                this.gridZ,
                this.maxLightsPerCluster
            );
            numLights += 1;
        });

        this.numLightsUniform.value = numLights;
        this.lastLights = numLights;
        this.lastClustersWritten = clustersWritten;
        this.lastReason = 'ok';
        if (numLights > 0) {
            (this.lightBuffer as THREE.BufferAttribute).needsUpdate = true;
            (this.clusterBuffer as THREE.BufferAttribute).needsUpdate = true;
        }
        this.lastBinMs = performance.now() - t0;
        publishStats(this.snapshot());
    }

    public snapshot(): ClusteredLightingStats {
        const budgetMs = this.lastLights <= 32 ? 2 : 6;
        return {
            enabled: this.lastReason === 'ok',
            reason: this.lastReason,
            lights: this.lastLights,
            clustersWritten: this.lastClustersWritten,
            lastBinMs: this.lastBinMs,
            maxLights: this.maxLights,
            maxLightsPerCluster: this.maxLightsPerCluster,
            budgetMs,
        };
    }

    public getLightingNode(
        worldPos: unknown,
        viewPos: unknown,
        worldNormal: unknown,
        baseColor: unknown
    ) {
        const sLightData = storage(this.lightBuffer, 'vec4', this.maxLights * 3);
        const sClusterData = storage(
            this.clusterBuffer,
            'uint',
            this.gridX * this.gridY * this.gridZ * clusterStride(this.maxLightsPerCluster)
        );

        const vZ = (viewPos as { z: { negate: () => unknown } }).z.negate();
        const zSlice = log(max(this.nearUniform, vZ as never).div(this.nearUniform))
            .mul(this.scaleZUniform)
            .floor();
        const zClamped = clamp(zSlice, 0.0, float(this.gridZ - 1));

        const clipPos = vec4(viewPos as never, 1.0).mul(cameraProjectionMatrix);
        const ndc = clipPos.xyz.div(clipPos.w);
        const screenUv = ndc.xy.mul(0.5).add(0.5);
        const xSlice = clamp(screenUv.x.mul(float(this.gridX)).floor(), 0.0, float(this.gridX - 1));
        const ySlice = clamp(screenUv.y.mul(float(this.gridY)).floor(), 0.0, float(this.gridY - 1));

        const clusterIdx = zClamped
            .mul(float(this.gridX * this.gridY))
            .add(ySlice.mul(float(this.gridX)))
            .add(xSlice);

        const stride = this.maxLightsPerCluster + 1;
        const clusterOffset = uint(clusterIdx).mul(uint(stride));
        const lightCount = sClusterData.element(clusterOffset);

        const totalIllum = vec3(0.0).toVar();

        Loop(
            { start: uint(0), end: lightCount, type: 'uint', condition: '<' },
            ({ i }: { i: ReturnType<typeof uint> }) => {
                const lightIdx = sClusterData.element(clusterOffset.add(1).add(i));
                const v0 = sLightData.element(lightIdx.mul(3));
                const v1 = sLightData.element(lightIdx.mul(3).add(1));
                const v2 = sLightData.element(lightIdx.mul(3).add(2));

                const lPos = v0.xyz;
                const lDist = v0.w;
                const lColor = v1.xyz;
                const lIntensity = v1.w;
                const spotDir = v2.xyz;
                const coneCos = v2.w;

                const lightVector = lPos.sub(worldPos as never);
                const dist = lightVector.length();
                const lightDir = lightVector.div(dist);

                // Windowed inverse-square — candy fill, not a hard bulb.
                const attenuation = clamp(float(1.0).sub(pow(dist.div(lDist), 4.0)), 0.0, 1.0)
                    .pow(2.0)
                    .div(dist.mul(dist).add(1.0));

                // Wrapped diffuse keeps Gummy/Crystal from reading as metallic-rough.
                const nDotL = max(dot(worldNormal as never, lightDir), 0.0);
                const wrap = nDotL.mul(0.65).add(0.35);

                const toSurface = lightDir.negate();
                const spotDot = dot(toSurface, spotDir);
                const inCone = smoothstep(coneCos.sub(0.12), coneCos, spotDot);
                const spotMask = mix(float(1.0), inCone, step(float(0.0), coneCos));

                totalIllum.addAssign(
                    lColor.mul(lIntensity).mul(attenuation).mul(wrap).mul(spotMask)
                );
            }
        );

        // Albedo tint — pastel fill, not a second specular lobe.
        return totalIllum.mul(baseColor as never).mul(0.55);
    }

    public dispose(): void {
        muteAnalyticLocalLights(false);
        const lb = this.lightBuffer as unknown as { dispose?: () => void };
        const cb = this.clusterBuffer as unknown as { dispose?: () => void };
        lb.dispose?.();
        cb.dispose?.();
    }
}

export const globalClusteredLighting = new ClusteredLightingSystem();

function publishStats(state: ClusteredLightingStats): void {
    try {
        if (typeof window !== 'undefined') {
            window.__clusteredLighting = state;
        }
    } catch {
        /* non-browser */
    }
}

export function getClusteredLightingStats(): ClusteredLightingStats {
    return globalClusteredLighting.snapshot();
}
