import * as THREE from 'three';
import { InstancedBatcher } from '../core/batcher/instanced-batcher.ts';
import {
    color, float, vec3, vec2, attribute, positionLocal,
    sin, cos, mix, smoothstep, uniform, If, time, uv,
    varying, dot, normalize, normalLocal, step, Fn, positionWorld,
    instanceIndex, storage, mx_noise_float, normalWorld, floor, add
} from 'three/tsl';
import { MeshStandardNodeMaterial } from 'three/webgpu';

// WGSL-compatible modulo: x - y * floor(x / y)
// Note: Converts inputs to float first since WGSL floor() only works on floats
const modFloat = (x: any, y: any) => {
    const xf = float(x);
    const yf = float(y);
    return xf.sub(yf.mul(xf.div(yf).floor()));
};
import { CONFIG, getCIAdjustedCount } from '../core/config.ts';
import { getBiomeUniforms, type BiomeId } from '../systems/biome-uniforms.ts';
import { foliageGroup } from '../world/state.ts';
import { foliageMaterials } from './foliage-materials.ts';
import { registerReactiveMaterial } from './foliage-reactivity.ts';
import {
    sharedGeometries,
    uTime,
    uAudioLow,
    uAudioHigh,
    CandyPresets,
    createJuicyRimLight,
    applyStandardDeformation,
    $sn,
    $sf,
} from './material-core.ts';

const MAX_WATERFALLS = getCIAdjustedCount(50, 0.2, 10); // Reduced from 200 for WebGPU uniform buffer limits
const SPLASHES_PER_WATERFALL = 8;
const MAX_SPLASHES = MAX_WATERFALLS * SPLASHES_PER_WATERFALL;

// Scratch variables
const _scratchMatrix = new THREE.Matrix4();
const _scratchPos = new THREE.Vector3();
const _scratchScale = new THREE.Vector3();
const _scratchQuat = new THREE.Quaternion();
const _scratchColor = new THREE.Color();

interface WaterfallRecord {
    position: THREE.Vector3;
    height: number;
    width: number;
    /** Z thickness relative to width; updateInstance() pulses it. */
    thickness: number;
    /** Per-splash origin (xyz) and velocity seed (xyz), fixed at add. */
    splashOrigins: Float32Array;
    splashVelocities: Float32Array;
}

interface WaterfallMeshes {
    column: THREE.InstancedMesh;
    splash: THREE.InstancedMesh;
    origin: THREE.InstancedBufferAttribute;
    velocity: THREE.InstancedBufferAttribute;
}

/** The slot space: one column and SPLASHES_PER_WATERFALL splashes per waterfall. */
class WaterfallSlots extends InstancedBatcher<WaterfallRecord> {
    private parts: WaterfallMeshes | null = null;

    constructor(private readonly build: () => WaterfallMeshes) {
        super('waterfall', 'animate', MAX_WATERFALLS);
        this.rangedUploads = true;
    }

    protected createMesh(): THREE.InstancedMesh {
        const parts = this.build();
        this.parts = parts;
        this.linkMesh(parts.splash, SPLASHES_PER_WATERFALL);
        this.registerAttribute(parts.origin, SPLASHES_PER_WATERFALL);
        this.registerAttribute(parts.velocity, SPLASHES_PER_WATERFALL);
        return parts.column;
    }

    protected writeRecord(r: WaterfallRecord, slot: number, array: Float32Array): void {
        // Cylinder base R=1, H=1, centred: scale (width, height, width × thickness)
        // and drop by half the height so `position` is the top centre.
        _scratchScale.set(r.width, r.height, r.width * r.thickness);
        _scratchQuat.identity();
        _scratchPos.copy(r.position);
        _scratchPos.y -= r.height * 0.5;
        _scratchMatrix.compose(_scratchPos, _scratchQuat, _scratchScale);
        // ⚡ OPTIMIZATION: Write directly to instanceMatrix array instead of updateMatrix + setMatrixAt
        _scratchMatrix.toArray(array, slot * 16);

        const { splash, origin, velocity } = this.parts!;
        const start = slot * SPLASHES_PER_WATERFALL;
        (origin.array as Float32Array).set(r.splashOrigins, start * 3);
        (velocity.array as Float32Array).set(r.splashVelocities, start * 3);
        // Identity matrices: the splash positionNode places each one.
        _scratchMatrix.identity();
        for (let i = 0; i < SPLASHES_PER_WATERFALL; i++) {
            _scratchMatrix.toArray(splash.instanceMatrix.array, (start + i) * 16);
        }
    }

    protected step(): void {
        // The TSL graph animates flow and splashes.
    }

    /** Build the meshes now (init()), not on the first add. */
    open(): void {
        this.ensureMesh();
    }

    put(id: string, r: WaterfallRecord): boolean {
        if (this.hasKey(id)) return false;
        return this.addKeyed(id, r) !== null;
    }

    take(id: string): boolean {
        return this.removeKeyed(id);
    }

    /** Rewrite `id`'s slot after its record changed. */
    rewrite(id: string): void {
        const slot = this.slotOfKey(id);
        if (slot === undefined || !this.mesh) return;
        this.writeRecord(this.recordAt(slot)!, slot, this.mesh.instanceMatrix.array as Float32Array);
        this.markSlotDirty(slot);
    }

    record(id: string): WaterfallRecord | null {
        const slot = this.slotOfKey(id);
        return slot === undefined ? null : this.recordAt(slot);
    }

    release(): void {
        this.parts = null;
        this.dispose();
    }
}

/**
 * Waterfall columns and their splashes (#2166: ported to InstancedBatcher,
 * through WaterfallSlots). Public API unchanged.
 */
export class WaterfallBatcher {
    private static instance: WaterfallBatcher;
    private initialized = false;
    private readonly slots = new WaterfallSlots(() => this.buildMeshes());

    public mesh: THREE.InstancedMesh | null = null;
    public splashMesh: THREE.InstancedMesh | null = null;

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

    /** The column-mesh slot of waterfall `id`, or undefined. */
    slotOf(id: string): number | undefined {
        return this.slots.slotOfKey(id);
    }

    get maxInstances(): number {
        return this.slots.maxInstances;
    }

    /** Live waterfalls. */
    get count(): number {
        return this.slots.instanceCount;
    }

    init() {
        if (this.initialized) return;
        this.initialized = true;
        this.slots.open();
    }

    private buildMeshes(): WaterfallMeshes {

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
        const displacedPos = positionLocal.add(displacement);

        // Apply Player Interaction
        colMat.positionNode = applyStandardDeformation(displacedPos); // 🎨 PALETTE: Replaced applyPlayerInteraction with applyStandardDeformation for wind-shear + player interaction

        // 4. Color & Emission
        const uPulseIntensity = uAudioLow.mul(2.0); // Amplified bass
        const uBaseEmission = float(0.2);

        // Gradient: Cyan (Top) to Purple (Bottom)
        // UV.y 0 (Bottom) -> 1 (Top)
        const gradient = mix(color(0xFF00FF), color(0x00FFFF), uv().y);

        // Mix gradient into base color (Base is Cyan from SeaJelly)
        colMat.colorNode = mix($sn(colMat.colorNode ?? color(0x00FFFF)), gradient, 0.5);

        // Juicy Rim Light (The "Palette" Polish)
        // Makes the edges glow with energy
        const rimColor = color(0x00FFFF);
        const rim = createJuicyRimLight(rimColor, float(2.0), float(3.0), normalWorld);

        // Total Emission = Gradient + Foam + Rim + Pulse
        // Foam makes it white/bright
        const foamEmission = color(0xFFFFFF).mul(totalFoam.mul(uBaseEmission.add(uPulseIntensity)));

        // Combine: Base Emission + Foam + Rim
        // Music Impact: crystalline nebula shimmer/noteColor adds bioluminescent tint to waterfall
        const nebulaUniforms = getBiomeUniforms('crystalline_nebula');
        const musicTint = nebulaUniforms.noteColor.mul(nebulaUniforms.shimmer).mul(0.3);
        colMat.emissiveNode = gradient.mul(uBaseEmission).add(foamEmission).add(rim).add(musicTint);

        // Roughness: Foam makes it rougher
        const currentRoughness = $sf(colMat.roughnessNode ?? float(colMat.roughness));
        colMat.roughnessNode = add(currentRoughness, totalFoam.mul(0.5));

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

        console.log('WaterfallBatcher initialized');
        return {
            column: this.mesh,
            splash: this.splashMesh,
            origin: this.splashOrigin,
            velocity: this.splashVelocity,
        };
    }

    dispose() {
        if (!this.initialized) return;
        this.slots.release();
        this.mesh = null;
        this.splashMesh = null;
        this.splashOrigin = null;
        this.splashVelocity = null;
        this.initialized = false;
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
        if (this.slots.hasKey(id) || this.slots.instanceCount >= MAX_WATERFALLS) return;

        // Splashes: origins randomly distributed at the bottom, velocity
        // params (X/Z direction, Y phase seed). Drawn once here so a slot swap
        // moves them with the waterfall.
        const n = SPLASHES_PER_WATERFALL;
        const splashOrigins = new Float32Array(n * 3);
        const splashVelocities = new Float32Array(n * 3);
        const bottomY = position.y - height;
        for (let i = 0; i < n; i++) {
            splashOrigins[i * 3] = position.x + (Math.random() - 0.5) * width;
            splashOrigins[i * 3 + 1] = bottomY;
            splashOrigins[i * 3 + 2] = position.z + (Math.random() - 0.5) * width;
            splashVelocities[i * 3] = Math.random() - 0.5;
            splashVelocities[i * 3 + 1] = Math.random();
            splashVelocities[i * 3 + 2] = Math.random() - 0.5;
        }
        this.slots.put(id, {
            position: position.clone(),
            height,
            width,
            thickness: 1,
            splashOrigins,
            splashVelocities,
        });
        this.slots.flush();
    }

    remove(id: string) {
        if (!this.initialized) return;
        if (this.slots.take(id)) this.slots.flush();
    }

    /**
     * Updates an instance (e.g. for pulsing thickness).
     * @param id
     * @param thicknessScale Z thickness as a multiple of the width
     */
    updateInstance(id: string, thicknessScale: number) {
        if (!this.initialized) return;
        const r = this.slots.record(id);
        if (!r) return;
        // Skip sub-tolerance changes: callers pulse this every frame and the
        // value rarely moves (same squared-scale tolerance as before the port).
        const w2 = r.width * r.width;
        const diffSq = w2 * (thicknessScale * thicknessScale - r.thickness * r.thickness);
        if (diffSq <= 0.0001 && diffSq >= -0.0001) return;
        r.thickness = thicknessScale;
        this.slots.rewrite(id);
    }

    removeInstance(logicObject: THREE.Object3D) {
        if (!logicObject) return;
        this.remove(logicObject.uuid);
    }
}

export const waterfallBatcher = WaterfallBatcher.getInstance();
