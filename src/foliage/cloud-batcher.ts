import * as THREE from 'three';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import {
    color, uniform, mix, vec3, positionLocal, normalLocal, mx_noise_float,
    float, normalize, positionWorld, normalWorld, cameraPosition, dot, abs, sin, pow,
    uv, smoothstep
} from 'three/tsl';
import {
    uTime, createJuicyRimLight, uAudioLow, uAudioHigh,
    uWindSpeed, uWindDirection, triplanarNoise
} from './common.ts';
import { foliageGroup } from '../world/state.ts';

// --- Global Uniforms (Moved from clouds.js) ---
export const uCloudRainbowIntensity = uniform(0.0);
export const uCloudLightningStrength = uniform(0.0);
export const uCloudLightningColor = uniform(color(0xFFFFFF));

// --- Material Creation ---
function createCloudMaterial() {
    const material = new MeshStandardNodeMaterial({
        color: 0xffffff,     // Pure cotton white base
        roughness: 0.9,      // Mostly matte but allows some sheen
        metalness: 0.0,
        flatShading: false,
    });

    // --- PALETTE: Juicy Cloud Logic ---

    // 1. Wind Shearing (Clouds drift faster at the top)
    // We use positionLocal.y (approx height) to shear along Wind Direction
    // Shearing Factor = Height * WindSpeed * 0.5
    const shearHeight = positionLocal.y.max(0.0); // Clamp to 0 to keep bottom fixed-ish
    const shearAmount = shearHeight.mul(uWindSpeed).mul(0.5);
    const windShear = vec3(
        uWindDirection.x.mul(shearAmount),
        float(0.0), // No vertical shear
        uWindDirection.z.mul(shearAmount)
    );

    // 2. Internal Turbulence (Boiling Effect)
    // Use 3D noise that scrolls with time
    const noiseScale = float(1.2);
    const boilSpeed = float(0.3); // Slow boiling
    const timeOffset = vec3(0.0, uTime.mul(boilSpeed), 0.0);

    const noisePos = positionLocal.mul(noiseScale).add(timeOffset);
    // Standard noise for shape
    const shapeNoise = mx_noise_float(noisePos);

    // 3. Audio Reactivity (Squish + Pulse)
    // Bass Squish: Squashes the cloud vertically on Kick
    const bassSquish = uAudioLow.mul(0.3);
    const verticalSquish = vec3(1.0, float(1.0).sub(bassSquish), 1.0);

    // Melody Puff: Expands the cloud slightly on Highs
    const melodyPuff = uAudioHigh.mul(0.2);

    // Total Displacement Magnitude
    // Base fluff + Melody expansion
    const displacementStrength = float(0.2).add(melodyPuff);

    // Calculate final position
    // Start with shearing
    const shearedPos = positionLocal.add(windShear);
    // Apply squish scale
    const squishedPos = shearedPos.mul(verticalSquish);

    // Apply Fluff Displacement along Normal
    const fluffOffset = normalLocal.mul(shapeNoise.mul(displacementStrength));

    material.positionNode = squishedPos.add(fluffOffset);

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
    const rimColor = color(0xFFF8E7); // Warm white
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
    // Mix shadow color (Blue-Grey) with White
    const shadowColor = color(0x8899AA);
    const baseColor = mix(shadowColor, color(0xFFFFFF), aoGradient);

    // Apply cotton detail to base color (subtle dirtying)
    const texturedColor = baseColor.mul(float(0.95).add(cottonDetail.mul(0.05)));

    material.colorNode = texturedColor;
    material.emissiveNode = lightningGlow.add(juicyRim).add(rainbowSheen);

    return material;
}

export const sharedCloudMaterial = createCloudMaterial();

// --- Cloud Batcher ---
const MAX_PUFFS = 5000;
const _scratchMat = new THREE.Matrix4();
const _scratchPos = new THREE.Vector3();
const _scratchQuat = new THREE.Quaternion();
const _scratchScale = new THREE.Vector3();
const _scratchObject3D = new THREE.Object3D();

export class CloudBatcher {
    initialized: boolean;
    count: number;
    mesh: THREE.InstancedMesh | null;
    clouds: any[]; // Logic objects

    constructor() {
        this.initialized = false;
        this.count = 0;
        this.mesh = null;
        this.clouds = [];
    }

    init() {
        if (this.initialized) return;

        // PALETTE: Increased detail for smoother TSL displacement (1 -> 2)
        const puffGeometry = new THREE.IcosahedronGeometry(1, 2);

        this.mesh = new THREE.InstancedMesh(puffGeometry, sharedCloudMaterial, MAX_PUFFS);
        this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        this.mesh.castShadow = true;
        this.mesh.receiveShadow = true;
        this.mesh.count = 0;
        this.mesh.frustumCulled = false; // Clouds might be large

        foliageGroup.add(this.mesh);

        this.initialized = true;
        console.log(`[CloudBatcher] Initialized with capacity ${MAX_PUFFS}`);
    }

    register(cloudGroup: any, options: any = {}) {
        if (!this.initialized) this.init();
        if (!this.mesh) return;

        const { scale = 1.0, puffCount = 12 + Math.floor(Math.random() * 8) } = options;

        if (this.count + puffCount > MAX_PUFFS) {
            console.warn('[CloudBatcher] Max capacity reached');
            return;
        }

        const startIndex = this.count;
        this.count += puffCount;

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
            _scratchObject3D.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
            _scratchObject3D.updateMatrix();

            puffs.push(_scratchObject3D.matrix.clone());
        }

        cloudGroup.userData.puffs = puffs;
        cloudGroup.userData.batchStart = startIndex;
        cloudGroup.userData.batchCount = puffCount;

        this.clouds.push(cloudGroup);

        // Initial Update
        this.updateCloudInstance(cloudGroup);
    }

    updateCloudInstance(cloud: any) {
        if (!this.mesh) return;

        const start = cloud.userData.batchStart;
        const count = cloud.userData.batchCount;
        const puffs = cloud.userData.puffs;

        cloud.updateMatrixWorld();
        const worldMat = cloud.matrixWorld;

        for (let i = 0; i < count; i++) {
            // Global = CloudWorld * PuffLocal
            _scratchMat.multiplyMatrices(worldMat, puffs[i]);
            this.mesh.setMatrixAt(start + i, _scratchMat);
        }
    }

    update(delta: number) {
        if (!this.initialized || !this.mesh) return;

        let needsUpdate = false;

        // Iterate over clouds
        // ⚡ OPTIMIZATION: Only update moving clouds?
        // For now, update all as they all have sine animation or physics
        for (const cloud of this.clouds) {
            // Run Cloud Logic (Sine Wave / Falling)
            // Note: updateFallingClouds in clouds.js handles falling physics on cloud.position externally.
            // Here we just handle the "Animation" callback if it exists.
            if (cloud.userData.onAnimate) {
                cloud.userData.onAnimate(delta, uTime.value);
            }

            // Sync Visuals
            this.updateCloudInstance(cloud);
            needsUpdate = true;
        }

        if (needsUpdate) {
            this.mesh.count = this.count;
            this.mesh.instanceMatrix.needsUpdate = true;
        }
    }
}

export const cloudBatcher = new CloudBatcher();
