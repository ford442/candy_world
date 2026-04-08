import * as THREE from 'three';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import {
    color, float, vec3, vec2, attribute, positionLocal,
    sin, cos, mix, smoothstep, uniform, If, time, uv,
    varying, dot, normalize, normalLocal, step, Fn, positionWorld,
    instanceIndex, storage, mx_noise_float, normalWorld, floor
} from 'three/tsl';

// WGSL-compatible modulo: x - y * floor(x / y)
// Note: Converts inputs to float first since WGSL floor() only works on floats
const modFloat = (x: any, y: any) => {
    const xf = float(x);
    const yf = float(y);
    return xf.sub(yf.mul(xf.div(yf).floor()));
};
import {
    sharedGeometries, foliageMaterials, uTime,
    uAudioLow, uAudioHigh, CandyPresets, registerReactiveMaterial, createJuicyRimLight
} from './index.ts';
import { foliageGroup } from '../world/state.ts';

const MAX_WATERFALLS = 50; // Reduced from 200 for WebGPU uniform buffer limits
const SPLASHES_PER_WATERFALL = 8;
const MAX_SPLASHES = MAX_WATERFALLS * SPLASHES_PER_WATERFALL;

// Scratch variables
const _scratchMatrix = new THREE.Matrix4();
const _scratchPos = new THREE.Vector3();
const _scratchScale = new THREE.Vector3();
const _scratchQuat = new THREE.Quaternion();
const _scratchColor = new THREE.Color();

export class WaterfallBatcher {
    private static instance: WaterfallBatcher;
    private initialized = false;
    private count = 0;

    public mesh: THREE.InstancedMesh | null = null;
    public splashMesh: THREE.InstancedMesh | null = null;

    // ID Maps
    private idToIndex: Map<string, number> = new Map();
    private indexToId: string[] = [];

    // Splash Attributes
    private splashOrigin: THREE.InstancedBufferAttribute | null = null;
    private splashVelocity: THREE.InstancedBufferAttribute | null = null; // Stores random velocity params

    private constructor() {}

    static getInstance(): WaterfallBatcher {
        if (!WaterfallBatcher.instance) {
            WaterfallBatcher.instance = new WaterfallBatcher();
        }
        return WaterfallBatcher.instance;
    }

    init() {
        if (this.initialized) return;

        // 1. Waterfall Column Mesh
        // Base Geometry: Top Radius 1, Bottom Radius 1.5, Height 1
        const colGeo = new THREE.CylinderGeometry(1, 1.5, 1, 32, 16, true);

        // Material (SeaJelly Variant)
        // We use TSL so we can just use the material logic directly or via preset
        // Note: CandyPresets.SeaJelly returns a MeshPhysicalNodeMaterial usually.
        // We need to modify it for InstancedMesh if needed.
        // But since we are using standard TSL nodes, it should work fine.
        const colMat = CandyPresets.SeaJelly(0x00FFFF, {
            transmission: 0.9,
            thickness: 1.2,
            roughness: 0.1,
            ior: 1.33,
            subsurfaceStrength: 0.5,
            subsurfaceColor: 0xCCFFFF,
            animateMoisture: true,
            thicknessDistortion: 0.6,
            side: THREE.DoubleSide
        });

        // Custom TSL Logic for Column (Juicy Upgrade)
        // 1. Flow & Foam (Accelerated by Highs)
        const speed = float(2.0).add(uAudioHigh.mul(2.0));
        const flowUV = uv().add(vec2(0, uTime.mul(speed).negate()));

        const ripple1 = sin(flowUV.y.mul(15.0).add(flowUV.x.mul(5.0))).mul(0.5).add(0.5);
        const ripple2 = sin(flowUV.y.mul(25.0).sub(flowUV.x.mul(10.0)).add(uTime)).mul(0.5).add(0.5);
        const foamNoise = ripple1.mul(ripple2);

        // 2. Bottom Foam Gradient (Pivot is center Y=0, Height=1, so range -0.5 to 0.5)
        // Strong foam at bottom (-0.5) fading out by -0.2
        const yPos = positionLocal.y;
        const bottomGradient = float(1.0).sub(smoothstep(-0.5, -0.2, yPos));
        const totalFoam = foamNoise.add(bottomGradient.mul(2.0)).min(1.0);

        // 3. Jelly Wobble (Vertex Displacement)
        // Wobble based on position and time
        const wobbleTime = uTime.mul(3.0);
        const noiseInput = positionLocal.mul(2.0).add(vec3(0, wobbleTime, 0));
        const wobbleX = mx_noise_float(noiseInput);
        const wobbleZ = mx_noise_float(noiseInput.add(vec3(10.0)));

        // Audio Impact on wobble (Bass Kick makes it bulge)
        const wobbleAmp = float(0.1).add(uAudioLow.mul(0.2));
        const displacement = vec3(wobbleX, float(0.0), wobbleZ).mul(wobbleAmp);

        // Apply Displacement
        colMat.positionNode = positionLocal.add(displacement);

        // 4. Color & Emission
        const uPulseIntensity = uAudioLow.mul(2.0); // Amplified bass
        const uBaseEmission = float(0.2);

        // Gradient: Cyan (Top) to Purple (Bottom)
        // UV.y 0 (Bottom) -> 1 (Top)
        const gradient = mix(color(0xFF00FF), color(0x00FFFF), uv().y);

        // Mix gradient into base color (Base is Cyan from SeaJelly)
        colMat.colorNode = mix(colMat.colorNode, gradient, 0.5);

        // Juicy Rim Light (The "Palette" Polish)
        // Makes the edges glow with energy
        const rimColor = color(0x00FFFF);
        const rim = createJuicyRimLight(rimColor, float(2.0), float(3.0), normalWorld);

        // Total Emission = Gradient + Foam + Rim + Pulse
        // Foam makes it white/bright
        const foamEmission = color(0xFFFFFF).mul(totalFoam.mul(uBaseEmission.add(uPulseIntensity)));

        // Combine: Base Emission + Foam + Rim
        colMat.emissiveNode = gradient.mul(uBaseEmission).add(foamEmission).add(rim);

        // Roughness: Foam makes it rougher
        const currentRoughness = colMat.roughnessNode || float(colMat.roughness);
        colMat.roughnessNode = currentRoughness.add(totalFoam.mul(0.5));

        this.mesh = new THREE.InstancedMesh(colGeo, colMat, MAX_WATERFALLS);
        this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        this.mesh.count = 0;
        this.mesh.frustumCulled = false; // Always update (audio reactivity)

        // 2. Splash Mesh
        const splashGeo = new THREE.SphereGeometry(1, 8, 8); // Base radius 1, scaled down later
        const splashMat = CandyPresets.Sugar(0xFFFFFF, { roughness: 0.4, bumpStrength: 0.2 });

        // Splash TSL Animation
        this.splashOrigin = new THREE.InstancedBufferAttribute(new Float32Array(MAX_SPLASHES * 3), 3);
        this.splashVelocity = new THREE.InstancedBufferAttribute(new Float32Array(MAX_SPLASHES * 3), 3); // x, y, z (randoms)

        splashGeo.setAttribute('aOrigin', this.splashOrigin);
        splashGeo.setAttribute('aVelocity', this.splashVelocity);

        // Logic
        const aOrigin = attribute('aOrigin', 'vec3');
        const aVelocity = attribute('aVelocity', 'vec3'); // Random seed/velocity

        // Time Loop
        // Each splash has a random phase based on its index or random attr
        // We use aVelocity.y as a seed for phase
        const phase = aVelocity.y.mul(10.0);
        const lifeTime = float(1.0); // 1 second loop
        const t = modFloat(uTime.add(phase), lifeTime); // 0 to 1

        // Physics
        // Pos = Origin + Vel * t - 0.5 * g * t^2
        // Initial Velocity (Boosted by Bass)
        const vUp = float(5.0).add(uAudioLow.mul(10.0));

        // Random horizontal spread
        const vX = aVelocity.x.mul(2.0);
        const vZ = aVelocity.z.mul(2.0);

        const pos = vec3(
            aOrigin.x.add(vX.mul(t)),
            aOrigin.y.add(vUp.mul(t).sub(float(20.0).mul(t).mul(t).mul(0.5))), // Gravity = 20
            aOrigin.z.add(vZ.mul(t))
        );

        // Scale down at end of life (Sine curve 0->1->0)
        const scaleLife = sin(t.mul(Math.PI));

        // TSL Scale Logic (Juicy Upgrade)
        // Scale up with Melody (uAudioHigh) for explosive sparkles
        const audioScale = float(1.0).add(uAudioHigh.mul(2.0));

        // Base splash size (0.5) * Life * Audio
        const splashSize = float(0.5).mul(scaleLife).mul(audioScale);

        // Apply position: Center (pos) + Local Vertex (positionLocal * Size)
        splashMat.positionNode = pos.add(positionLocal.mul(splashSize));

        // Color Logic (Juicy Upgrade)
        // Mix from White (Foam) to Cyan/Magenta based on life or randomness
        // Use aVelocity.y (phase seed) to randomize color
        const randomColor = mix(color(0x00FFFF), color(0xFF00FF), sin(aVelocity.y.mul(10.0)).mul(0.5).add(0.5));

        // Flash white at birth (t < 0.2)
        const flash = float(1.0).sub(smoothstep(0.0, 0.2, t));
        const finalColor = mix(randomColor, color(0xFFFFFF), flash);

        splashMat.colorNode = finalColor;

        // Add emission for glow (Bioluminescent splash)
        splashMat.emissiveNode = finalColor.mul(0.5).add(flash.mul(0.5));

        this.splashMesh = new THREE.InstancedMesh(splashGeo, splashMat, MAX_SPLASHES);
        this.splashMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        this.splashMesh.count = 0;
        this.splashMesh.frustumCulled = false;

        if (foliageGroup) {
            foliageGroup.add(this.mesh);
            foliageGroup.add(this.splashMesh);
        }

        this.initialized = true;
        console.log('WaterfallBatcher initialized');
    }

    /**
     * Adds a waterfall instance.
     * @param id Unique identifier (e.g. parent UUID)
     * @param position Top center position (StartPos)
     * @param height Height of waterfall
     * @param width Width (diameter) of waterfall
     */
    add(id: string, position: THREE.Vector3, height: number, width: number) {
        if (!this.initialized) this.init();
        if (this.idToIndex.has(id)) return;
        if (this.count >= MAX_WATERFALLS) return;

        const index = this.count;
        this.count++;

        this.idToIndex.set(id, index);
        this.indexToId[index] = id;

        // 1. Setup Column
        // Cylinder Base: R=1, H=1.
        // Scale: X=width, Y=height, Z=width
        // Position: position.y - height/2 (Mid Point)
        _scratchScale.set(width, height, width);
        _scratchQuat.identity();
        _scratchPos.copy(position);
        _scratchPos.y -= height * 0.5;

        _scratchMatrix.compose(_scratchPos, _scratchQuat, _scratchScale);
        this.mesh!.setMatrixAt(index, _scratchMatrix);
        this.mesh!.instanceMatrix.needsUpdate = true;

        // 2. Setup Splashes (8 per waterfall)
        const startSplash = index * SPLASHES_PER_WATERFALL;
        const bottomY = position.y - height;

        for (let i = 0; i < SPLASHES_PER_WATERFALL; i++) {
            const si = startSplash + i;

            // Origin: Randomly distributed at bottom
            const offsetX = (Math.random() - 0.5) * width;
            const offsetZ = (Math.random() - 0.5) * width;

            this.splashOrigin!.setXYZ(si,
                position.x + offsetX,
                bottomY,
                position.z + offsetZ
            );

            // Velocity Params: X/Z direction, Y seed
            this.splashVelocity!.setXYZ(si,
                (Math.random() - 0.5), // X dir
                Math.random(),         // Y seed (phase)
                (Math.random() - 0.5)  // Z dir
            );

            // Initialize matrix to identity (needed for rendering, even if positionNode overrides)
            _scratchMatrix.identity();
            this.splashMesh!.setMatrixAt(si, _scratchMatrix);
        }

        this.splashOrigin!.needsUpdate = true;
        this.splashVelocity!.needsUpdate = true;

        // Update counts
        this.mesh!.count = this.count;
        this.splashMesh!.count = this.count * SPLASHES_PER_WATERFALL;
        this.splashMesh!.instanceMatrix.needsUpdate = true;
    }

    remove(id: string) {
        if (!this.initialized || !this.idToIndex.has(id)) return;

        const indexToRemove = this.idToIndex.get(id)!;
        const lastIndex = this.count - 1;
        const lastId = this.indexToId[lastIndex];

        if (indexToRemove !== lastIndex) {
            // Swap Column
            this.mesh!.getMatrixAt(lastIndex, _scratchMatrix);
            this.mesh!.setMatrixAt(indexToRemove, _scratchMatrix);

            // Swap Splashes (Block of 8)
            const srcStart = lastIndex * SPLASHES_PER_WATERFALL;
            const destStart = indexToRemove * SPLASHES_PER_WATERFALL;

            for (let i = 0; i < SPLASHES_PER_WATERFALL; i++) {
                const src = srcStart + i;
                const dest = destStart + i;

                // Copy Origin
                this.splashOrigin!.setXYZ(dest,
                    this.splashOrigin!.getX(src),
                    this.splashOrigin!.getY(src),
                    this.splashOrigin!.getZ(src)
                );

                // Copy Velocity
                this.splashVelocity!.setXYZ(dest,
                    this.splashVelocity!.getX(src),
                    this.splashVelocity!.getY(src),
                    this.splashVelocity!.getZ(src)
                );
            }

            // Update Map
            this.idToIndex.set(lastId, indexToRemove);
            this.indexToId[indexToRemove] = lastId;
        }

        this.idToIndex.delete(id);
        this.count--;

        this.mesh!.count = this.count;
        this.splashMesh!.count = this.count * SPLASHES_PER_WATERFALL;

        this.mesh!.instanceMatrix.needsUpdate = true;
        this.splashOrigin!.needsUpdate = true;
        this.splashVelocity!.needsUpdate = true;
    }

    /**
     * Updates an instance (e.g. for pulsing thickness).
     * @param id
     * @param thicknessScale Scaling factor for thickness (Z-axis flattening or uniform scale)
     */
    updateInstance(id: string, thicknessScale: number) {
        if (!this.initialized || !this.idToIndex.has(id)) return;

        // Note: We need to know the original scale to modify it.
        // But we didn't store it.
        // We can get it from matrix.
        const index = this.idToIndex.get(id)!;
        this.mesh!.getMatrixAt(index, _scratchMatrix);
        _scratchMatrix.decompose(_scratchPos, _scratchQuat, _scratchScale);

        // Original logic:
        // width (X) and height (Y) are fixed.
        // thickness (Z) is modified.
        // But if we only stored the matrix, how do we know the "base" Z?
        // Assuming X and Z were equal initially (circular).
        // So base Z = current X.

        _scratchScale.z = _scratchScale.x * thicknessScale;

        _scratchMatrix.compose(_scratchPos, _scratchQuat, _scratchScale);
        this.mesh!.setMatrixAt(index, _scratchMatrix);
        this.mesh!.instanceMatrix.needsUpdate = true;
    }
}

export const waterfallBatcher = WaterfallBatcher.getInstance();
