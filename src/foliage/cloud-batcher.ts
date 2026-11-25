import * as THREE from 'three';
import { InstancedBatcher } from '../core/batcher/instanced-batcher.ts';
import type { FrameContext } from '../core/scheduler/types.ts';
import {
    color,
    uniform,
    mix,
    vec3,
    positionLocal,
    normalLocal,
    mx_noise_float,
    float,
    normalize,
    positionWorld,
    normalWorld,
    cameraPosition,
    dot,
    abs,
    sin,
    pow,
    uv,
    smoothstep,
} from 'three/tsl';
import { attribute } from 'three/tsl';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import { camera } from '../core/camera-ref.ts';
import { CONFIG } from '../core/config.ts';

// --- Global Uniforms (Moved from clouds.js) ---
export const uCloudRainbowIntensity = uniform(0.0);
export const uCloudLightningStrength = uniform(0.0);
export const uCloudLightningColor = uniform(color(0xffffff));

// --- Material Creation ---
function createCloudMaterial() {
    const material = new MeshStandardNodeMaterial({
        color: 0xffffff, // Pure cotton white base
        roughness: 0.9, // Mostly matte but allows some sheen
        metalness: 0.0,
        flatShading: false,
    });

    // --- PALETTE: Juicy Cloud Logic ---

    // 1. Player Interaction (Juicy Landing/Jump Squash)
    // The player touching the cloud pushes it down, causing it to bulge outwards
    const playerDistVector = positionWorld.sub(uPlayerPosition);
    // Ignore Y distance for cylinder interaction radius check
    const playerDistXZ = vec3(playerDistVector.x, float(0.0), playerDistVector.z);
    const distSq = dot(playerDistXZ, playerDistXZ);

    // Interaction Radius = 4.0m (Sq = 16.0)
    const interactRadiusSq = float(16.0);

    // Force falls off with distance. Normalized distance (0 to 1 inside radius)
    const distFactor = distSq.div(interactRadiusSq).min(1.0);
    // Strength: 1.0 at center, 0.0 at edge
    const playerStrength = float(1.0).sub(smoothstep(0.0, 1.0, distFactor));

    // Squash Y down, Bulge XZ out + velocity impact (#1254: juicy jump-through)
    const baseSquash = playerStrength.mul(0.6); // Max 60% squash at rest
    // Fast vertical movement (jumping / landing) adds extra squash
    const verticalVelSquash = uPlayerVelocity.y.abs().mul(0.015).mul(playerStrength).clamp(0.0, 0.4);
    const playerSquashAmount = baseSquash.add(verticalVelSquash);
    const playerSquishScale = vec3(
        float(1.0).add(playerSquashAmount.mul(0.5)), // Expand X
        float(1.0).sub(playerSquashAmount).max(0.4), // Compress Y, clamp at 0.4
        float(1.0).add(playerSquashAmount.mul(0.5)) // Expand Z
    );

    // 2. Wind Shearing (Clouds drift faster at the top)
    // We use positionLocal.y (approx height) to shear along Wind Direction
    // Shearing Factor = Height * WindSpeed * 0.5
    const shearHeight = positionLocal.y.max(0.0); // Clamp to 0 to keep bottom fixed-ish
    // Was private wind math on raw speed, so clouds drifted steadily while the
    // trees below were gusting. Now on the shared speed x gust strength.
    const shearAmount = shearHeight.mul(uWindStrength).mul(0.5);
    const windShear = vec3(
        uWindDirection.x.mul(shearAmount),
        float(0.0), // No vertical shear
        uWindDirection.z.mul(shearAmount)
    );

    // 3. Internal Turbulence (Boiling Effect)
    // Use 3D noise that scrolls with time
    const noiseScale = float(1.2);
    const boilSpeed = float(0.3); // Slow boiling
    const timeOffset = vec3(0.0, uTime.mul(boilSpeed), 0.0);

    const noisePos = positionLocal.mul(noiseScale).add(timeOffset);
    // Standard noise for shape
    const shapeNoise = mx_noise_float(noisePos);

    // 4. Audio Reactivity (Squish + Pulse)
    // Bass Squish: Squashes the cloud vertically on Kick and bulges horizontally
    const bassSquish = uAudioLow.mul(0.3);
    const verticalSquish = vec3(
        float(1.0).add(bassSquish.mul(0.5)),
        float(1.0).sub(bassSquish),
        float(1.0).add(bassSquish.mul(0.5))
    );

    // Melody Puff: Expands the cloud slightly on Highs
    const melodyPuff = uAudioHigh.mul(0.2);

    // Music Impact: soft internal starlight pulse on melody hits
    const melodyGlow = uAudioHigh.mul(float(CONFIG.cloud.emissivePulse));

    // Total Displacement Magnitude
    // Base fluff + Melody expansion
    const displacementStrength = float(0.2).add(melodyPuff);

    // Calculate final position
    // Start with shearing
    const shearedPos = positionLocal.add(windShear);
    // Apply Audio Squish and Player Squash scale
    const squishedPos = shearedPos.mul(verticalSquish).mul(playerSquishScale);

    // Apply Fluff Displacement along Normal
    // Audio-reactive puff intensity during deformation
    const puffIntensity = float(1.0).add(uAudioHigh.mul(0.8));
    const fluffOffset = normalLocal.mul(shapeNoise.mul(displacementStrength)).mul(puffIntensity);

    // ⚡ OPTIMIZATION: TSL Floating Animation (Replaces CPU update)
    // Use world X/Z as phase seed for coherent bobbing
    const floatSpeed = float(0.5);
    const floatAmp = float(0.5);
    const worldPhase = positionWorld.x.mul(0.05).add(positionWorld.z.mul(0.05));
    const floatDisp = sin(uTime.mul(floatSpeed).add(worldPhase)).mul(floatAmp);
    const floatOffset = vec3(0.0, floatDisp, 0.0);

    // === SPRING BOUNCE (player land/jump response) ===
    // High-frequency sine gives that satisfying candy "boing" overshoot
    const bounceRinging = sin(uTime.mul(15.0)).mul(playerStrength).mul(0.15);
    const bounceDisp = vec3(0.0, bounceRinging, 0.0);

    const animatedPos = squishedPos.add(fluffOffset).add(floatOffset).add(bounceDisp);

    // Apply player interaction
    material.positionNode = applyStandardDeformation(animatedPos);

    // 4. Surface Detail (Triplanar Noise for "Cotton" Texture)
    // Adds high-frequency noise to Roughness and slightly to Color
    // Scale 10.0 for micro-detail
    const cottonDetail = triplanarNoise(positionLocal, float(10.0));

    // Modulate roughness: Valleys are rougher (shadowy), Peaks are smoother
    material.roughnessNode = float(0.8).add(cottonDetail.mul(0.2));

    // 5. Lighting & Juice
    // Lightning Flash (Global Event)
    const lightningGlow = uCloudLightningColor.mul(uCloudLightningStrength.mul(3.0));

    // Juicy Rim Light (Replaces standard rim)
    // Reacts to Melody (AudioHigh)
    const rimColor = color(0xfff8e7); // Warm white
    const rimIntensity = float(0.5);
    const rimPower = float(2.0);
    // Note: createJuicyRimLight adds its own audio pulse and color shift
    const juicyRim = createJuicyRimLight(rimColor, rimIntensity, rimPower, normalWorld);

    // Fake Rainbow Sheen (Optical effect)
    // Only visible when looking at grazing angles (Fresnel)
    const viewDir = normalize(cameraPosition.sub(positionWorld));
    const NdotV = abs(dot(normalWorld, viewDir));
    const fresnel = float(1.0).sub(NdotV).pow(float(2.0));

    const irisR = sin(fresnel.mul(10.0));
    const irisG = sin(fresnel.mul(10.0).add(2.0));
    const irisB = sin(fresnel.mul(10.0).add(4.0));
    const rainbowColor = vec3(irisR, irisG, irisB).mul(0.5).add(0.5);

    const rainbowSheen = rainbowColor.mul(uCloudRainbowIntensity).mul(fresnel);

    // Ambient Occlusion Approximation
    // Darken the bottom of the cloud (y < 0)
    // We use positionLocal.y from before displacement for stability
    const aoGradient = smoothstep(-1.0, 1.0, positionLocal.y); // 0 at bottom, 1 at top
    // PALETTE: Candy cloud pastels — lavender shadow, pink body, cream highlights
    const shadowColor = color(CONFIG.cloud.lavenderShadow);
    const candyBody = color(CONFIG.cloud.pastelTint);
    const highlightColor = color(CONFIG.cloud.creamHighlight);
    const baseColor = mix(shadowColor, mix(candyBody, highlightColor, aoGradient), aoGradient);

    // Apply cotton detail to base color (subtle dirtying)
    const texturedColor = baseColor.mul(float(0.95).add(cottonDetail.mul(0.05)));

    // --- INTEGRATED: Day/Night & Storm Logic ---
    // 1. Darken during storms (uSkyDarkness -> 1.0)
    const stormDarkness = float(1.0).sub(uSkyDarkness.mul(0.8)); // Never fully black, keep some form

    // 2. Tint during Twilight/Night (uTwilight -> 1.0)
    // Shift towards deep blue-grey at night
    const nightTint = color(0x223355);
    const dayTint = color(0xffffff);
    const ambientTint = mix(dayTint, nightTint, uTwilight.mul(0.7)); // 0.7 intensity

    // Final Color Composition
    const lakeTint = mix(
        color(0xffffff),
        BiomeUniforms.lakeFeatures.noteColor,
        BiomeUniforms.lakeFeatures.hueShift.mul(0.35)
    );
    const finalColor = texturedColor.mul(ambientTint).mul(stormDarkness).mul(lakeTint);

    material.colorNode = finalColor;

    // --- VERTICAL ECOSYSTEM: Crystallized Rim for Walkable Clouds ---
    // Walkable clouds (tier 1) get a subtle cyan ice-crystal edge glow
    const walkableFlag = attribute('aIsWalkable', 'float');
    const crystalColor = color(0xe0ffff);
    const bobPulse = sin(uTime.mul(2.0).add(positionWorld.x.mul(0.1)))
        .mul(0.3)
        .add(0.7);
    const crystalRim = createJuicyRimLight(crystalColor, float(0.8), float(2.5), normalWorld)
        .mul(walkableFlag)
        .mul(bobPulse)
        .add(walkableFlag.mul(melodyGlow));

    // Dim emissive effects during storms too, except lightning
    material.emissiveNode = lightningGlow
        .add(juicyRim.mul(stormDarkness))
        .add(rainbowSheen.mul(stormDarkness))
        .add(crystalRim)
        .add(candyBody.mul(melodyGlow));

    return material;
}

let _sharedCloudMaterial: any = null;
export function getSharedCloudMaterial() {
    if (!_sharedCloudMaterial) {
        _sharedCloudMaterial = createCloudMaterial();
    }
    return _sharedCloudMaterial;
}

import { getCIAdjustedCount } from '../core/config.ts';
import { BiomeUniforms } from '../systems/biome-uniforms.ts';
import { batchDistanceCull_c } from '../utils/wasm-batch-animation.ts';
import { foliageGroup } from '../world/state.ts';
import {
    uTime,
    createJuicyRimLight,
    uAudioLow,
    uAudioHigh,
    uWindSpeed,
    uWindDirection,
    uWindStrength,
    triplanarNoise,
    uPlayerPosition,
    applyStandardDeformation,
    uPlayerVelocity,
} from './material-core.ts';
import { uSkyDarkness, uTwilight } from './sky.ts';

// --- Cloud Batcher ---
const MAX_PUFFS = getCIAdjustedCount(400, 0.1, 50); // Reduced from 1000 for WebGPU uniform buffer limits (64KB max)
const _scratchMat = new THREE.Matrix4();
const _scratchWorldMat = new THREE.Matrix4();
const _scratchPos = new THREE.Vector3();
const _scratchQuat = new THREE.Quaternion();
const _scratchScale = new THREE.Vector3();
const _scratchObject3D = new THREE.Object3D();

interface CloudPuffRecord {
    cloud: THREE.Object3D;
    puff: THREE.Matrix4;
    matrix: Float32Array;
    walkable: number;
}

class CloudPuffBatcher extends InstancedBatcher<CloudPuffRecord> {
    isWalkableAttribute: THREE.InstancedBufferAttribute | null = null;
    private readonly repackScratch: CloudPuffRecord[] = [];

    constructor(capacity: number) {
        super('cloud-puffs', 'animate', capacity);
    }

    protected createMesh(capacity: number): THREE.InstancedMesh {
        // Instance attributes belong to this mesh, not the shared geometry cache.
        const geometry = new THREE.IcosahedronGeometry(1, 2);
        this.isWalkableAttribute = this.registerAttribute(
            new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1)
        );
        geometry.setAttribute('aIsWalkable', this.isWalkableAttribute);
        const mesh = new THREE.InstancedMesh(geometry, getSharedCloudMaterial(), capacity);
        mesh.userData.preventMaterialDispose = true;
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.frustumCulled = false;
        foliageGroup.add(mesh);
        return mesh;
    }

    protected writeRecord(record: CloudPuffRecord, slot: number, array: Float32Array): void {
        array.set(record.matrix, slot * 16);
        this.isWalkableAttribute!.setX(slot, record.walkable);
    }

    protected step(_ctx: FrameContext): void {}

    init(): void { this.ensureMesh(); }

    createRecord(cloud: THREE.Object3D, puff: THREE.Matrix4): CloudPuffRecord {
        const record = { cloud, puff, matrix: new Float32Array(16), walkable: cloud.userData.isWalkable ? 1 : 0 };
        this.updateRecordMatrix(record);
        return record;
    }

    private updateRecordMatrix(record: CloudPuffRecord): void {
        _scratchWorldMat.compose(record.cloud.position, record.cloud.quaternion, record.cloud.scale);
        _scratchMat.multiplyMatrices(_scratchWorldMat, record.puff).toArray(record.matrix);
    }

    updateCloud(cloud: THREE.Object3D): void {
        for (let i = cloud.userData.batchStart; i < cloud.userData.batchStart + cloud.userData.batchCount; i++) {
            const record = this.recordAt(i);
            if (!record) continue;
            this.updateRecordMatrix(record);
            this.writeRecord(record, i, this.mesh!.instanceMatrix.array as Float32Array);
            this.markSlotDirty(i);
        }
    }

    removeCloudRange(start: number, count: number): void {
        // A swap-remove can split another cloud's variable-sized puff range.
        // Repack only the suffix, reusing records and scratch storage.
        const remaining = this.repackScratch;
        for (let i = start + count; i < this.count; i++) {
            remaining.push(this.records[i]!);
        }
        for (let i = this.count - 1; i >= start; i--) {
            this.remove(this.slotToHandle[i]);
        }
        for (const record of remaining) this.add(record);
        remaining.length = 0;
    }

    dispose(): void {
        super.dispose();
        this.isWalkableAttribute = null;
    }
}

export class CloudBatcher {
    private static instance: CloudBatcher;
    private static walkableInstance: CloudBatcher;

    public static getInstance(): CloudBatcher {
        if (!CloudBatcher.instance) {
            CloudBatcher.instance = new CloudBatcher();
        }
        return CloudBatcher.instance;
    }

    public static getWalkableInstance(): CloudBatcher {
        if (!CloudBatcher.walkableInstance) {
            CloudBatcher.walkableInstance = new CloudBatcher();
        }
        return CloudBatcher.walkableInstance;
    }
    initialized: boolean;
    count: number;
    private readonly puffs: CloudPuffBatcher;
    get mesh(): THREE.InstancedMesh | null { return this.puffs.mesh; }
    clouds: any[]; // Logic objects
    get isWalkableAttribute(): THREE.InstancedBufferAttribute | null { return this.puffs.isWalkableAttribute; }
    dropped = 0;
    private _cullPositions: Float32Array | null = null;
    private _cullFlags: Float32Array | null = null;

    constructor(capacity: number = MAX_PUFFS) {
        this.initialized = false;
        this.count = 0;
        this.puffs = new CloudPuffBatcher(capacity);
        this.clouds = [];
    }

    init() {
        if (this.initialized) return;

        this.puffs.init();
        this.initialized = true;
        console.log(`[CloudBatcher] Initialized with capacity ${this.puffs.maxInstances}`);
    }

    register(cloudGroup: any, options: any = {}) {
        if (!this.initialized) this.init();
        const { scale = 1.0, puffCount = 12 + Math.floor(Math.random() * 8) } = options;

        if (this.clouds.includes(cloudGroup)) return cloudGroup.userData.batchStart;
        if (this.count + puffCount > this.puffs.maxInstances) {
            if (this.dropped++ === 0) console.warn(`[CloudBatcher] Max capacity reached (${this.count} / ${this.puffs.maxInstances})`);
            return -1;
        }

        const startIndex = this.count;

        // Generate Puffs (Local Transforms)
        const puffs: THREE.Matrix4[] = [];

        for (let i = 0; i < puffCount; i++) {
            const radiusSpread = (Math.random() * 2.5 + 0.5) * scale;
            const theta = Math.random() * Math.PI * 2;
            const phi = Math.acos(2 * Math.random() - 1);

            const x = radiusSpread * Math.sin(phi) * Math.cos(theta);
            const z = radiusSpread * Math.sin(phi) * Math.sin(theta);
            let y = radiusSpread * Math.cos(phi);

            y *= 0.6; // Flatten bottom

            _scratchObject3D.position.set(x, y, z);

            const distFromCenter = _scratchObject3D.position.length();
            const sizeBase = 1.0 - (distFromCenter / (3.5 * scale)) * 0.5;
            const puffScaleRandom = 0.5 + Math.random() * 1.0;
            const finalPuffScale = Math.max(0.2, sizeBase * puffScaleRandom * scale);

            _scratchObject3D.scale.setScalar(finalPuffScale);
            _scratchObject3D.rotation.set(
                Math.random() * Math.PI,
                Math.random() * Math.PI,
                Math.random() * Math.PI
            );
            _scratchMat.compose(
                _scratchObject3D.position,
                _scratchObject3D.quaternion,
                _scratchObject3D.scale
            );
            puffs.push(_scratchMat.clone());
        }

        cloudGroup.userData.puffs = puffs;
        cloudGroup.userData.batchStart = startIndex;
        cloudGroup.userData.batchIndex = startIndex;
        cloudGroup.userData.batchCount = puffCount;

        // ⚡ OPTIMIZATION: Copy to pre-allocated state (from createCloud) for dirty checking
        if (!cloudGroup.userData.lastPos) cloudGroup.userData.lastPos = new THREE.Vector3();
        if (!cloudGroup.userData.lastRot) cloudGroup.userData.lastRot = new THREE.Euler();
        cloudGroup.userData.lastPos.copy(cloudGroup.position);
        cloudGroup.userData.lastRot.copy(cloudGroup.rotation);

        this.clouds.push(cloudGroup);
        for (const puff of puffs) this.puffs.add(this.puffs.createRecord(cloudGroup, puff));
        this.count = this.puffs.instanceCount;
        this.puffs.flush();
        return startIndex;
    }


    removeInstance(cloudGroup: any) {
        if (!this.initialized || !this.mesh) return;

        const indexToRemove = this.clouds.indexOf(cloudGroup);
        if (indexToRemove === -1) return;
        const start = cloudGroup.userData.batchStart;
        const count = cloudGroup.userData.batchCount;
        if (!Number.isInteger(start) || !Number.isInteger(count) || start < 0 || count < 0 || start + count > this.count) return;
        this.clouds.splice(indexToRemove, 1);
        cloudGroup.userData.batchStart = undefined;
        cloudGroup.userData.batchCount = undefined;
        cloudGroup.userData.batchIndex = undefined;
        this.puffs.removeCloudRange(start, count);
        for (let i = indexToRemove; i < this.clouds.length; i++) {
            const cloud = this.clouds[i];
            cloud.userData.batchStart -= count;
            cloud.userData.batchIndex = cloud.userData.batchStart;
        }
        this.count = this.puffs.instanceCount;
        this.puffs.flush();
    }

    updateCloudInstance(cloud: any) {
        if (!this.mesh) return;

        if (this.clouds.includes(cloud)) this.puffs.updateCloud(cloud);
    }

    update(delta: number, cameraPos?: THREE.Vector3) {
        if (!this.initialized || !this.mesh) return;

        let needsUpdate = false;

        // 1. Sync capacity
        const cloudCount = this.clouds.length;
        if (!this._cullPositions || this._cullPositions.length < cloudCount * 3) {
            const newCap = Math.max(cloudCount * 2, 256);
            this._cullPositions = new Float32Array(newCap * 3);
            this._cullFlags = new Float32Array(newCap);
        }

        // 2. Pack positions
        for (let i = 0; i < cloudCount; i++) {
            const cloud = this.clouds[i];
            this._cullPositions[i * 3] = cloud.position.x;
            this._cullPositions[i * 3 + 1] = cloud.position.y;
            this._cullPositions[i * 3 + 2] = cloud.position.z;
        }

        // 3. WASM batch distance cull (max distance ~250m)
        if (cameraPos && cloudCount > 0 && this._cullPositions && this._cullFlags) {
            const cullPositions = this._cullPositions;
            const cullFlags = this._cullFlags;
            const cx = cameraPos.x;
            const cy = cameraPos.y;
            const cz = cameraPos.z;
            batchDistanceCull_c(cullPositions, cloudCount, cx, cy, cz, 250 * 250, cullFlags);
        } else if (this._cullFlags) {
            // Default everything to visible if no camera
            for (let i = 0; i < cloudCount; i++) this._cullFlags[i] = 1.0;
        }

        // Iterate over clouds
        // ⚡ OPTIMIZATION: Only update moving clouds (e.g. falling or dragged)
        // Static clouds are now animated via TSL (Vertex Shader)
        for (let i = 0; i < cloudCount; i++) {
            const cloud = this.clouds[i];

            // ⚡ OPTIMIZATION: Skip distant clouds completely based on WASM cull flags
            if (!this._cullFlags || this._cullFlags[i] === 0.0) continue;

            // Run Cloud Logic (Sine Wave / Falling)
            // Note: updateFallingClouds in clouds.js handles falling physics on cloud.position externally.
            // Here we just handle the "Animation" callback if it exists.
            if (cloud.userData.onAnimate) {
                cloud.userData.onAnimate(delta, uTime.value);
            }

            // Check for Movement
            // ⚡ OPTIMIZATION: Dirty check against last frame's transform
            // Only update matrix buffer if cloud actually moved (physics/drag)
            // Floating animation is handled by TSL Vertex Shader
            if (cloud.userData.lastPos) {
                const dx = cloud.position.x - cloud.userData.lastPos.x;
                const dy = cloud.position.y - cloud.userData.lastPos.y;
                const dz = cloud.position.z - cloud.userData.lastPos.z;
                const moved = dx * dx + dy * dy + dz * dz > 0.0001;
                const rotated =
                    Math.abs(cloud.rotation.x - cloud.userData.lastRot.x) > 0.001 ||
                    Math.abs(cloud.rotation.y - cloud.userData.lastRot.y) > 0.001 ||
                    Math.abs(cloud.rotation.z - cloud.userData.lastRot.z) > 0.001;

                if (moved || rotated) {
                    cloud.userData.lastPos.copy(cloud.position);
                    cloud.userData.lastRot.copy(cloud.rotation);
                    this.updateCloudInstance(cloud);
                    needsUpdate = true;
                }
            }
        }

        if (needsUpdate) {
            this.puffs.flush();
        }
    }

    dispose(): void {
        for (const cloud of this.clouds) {
            cloud.userData.batchStart = undefined;
            cloud.userData.batchCount = undefined;
            cloud.userData.batchIndex = undefined;
        }
        this.puffs.dispose();
        this.clouds.length = 0;
        this.count = 0;
        this.initialized = false;
        this.dropped = 0;
        this._cullPositions = null;
        this._cullFlags = null;
    }
}
