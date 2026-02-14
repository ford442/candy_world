import * as THREE from 'three';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import {
    color, float, vec3, vec2, attribute, positionLocal,
    sin, cos, mix, smoothstep, uniform, If, time, uv,
    varying, dot, normalize, normalLocal, step, Fn, positionWorld,
    instanceIndex, storage
} from 'three/tsl';
import {
    sharedGeometries, foliageMaterials, uTime,
    uAudioLow, uAudioHigh, CandyPresets, registerReactiveMaterial
} from './common.ts';
import { foliageGroup } from '../world/state.ts';

const MAX_WATERFALLS = 200;
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

        // Custom TSL Logic for Column
        const speed = float(2.0);
        const flowUV = uv().add(vec2(0, uTime.mul(speed).negate()));

        const ripple1 = sin(flowUV.y.mul(15.0).add(flowUV.x.mul(5.0))).mul(0.5).add(0.5);
        const ripple2 = sin(flowUV.y.mul(25.0).sub(flowUV.x.mul(10.0)).add(uTime)).mul(0.5).add(0.5);
        const foam = ripple1.mul(ripple2);

        // Audio Pulse (Global)
        const uPulseIntensity = uAudioLow.mul(2.0); // Amplified bass
        const uBaseEmission = float(0.2);

        const gradient = mix(color(0xFF00FF), color(0x00FFFF), uv().y);

        // Mix gradient into base color
        colMat.colorNode = mix(colMat.colorNode, gradient, 0.5);

        // Emission
        const emission = gradient.mul(uBaseEmission.add(uPulseIntensity)).mul(foam.add(0.2));
        colMat.emissiveNode = emission;

        // Roughness
        const currentRoughness = colMat.roughnessNode || float(colMat.roughness);
        colMat.roughnessNode = currentRoughness.add(foam.mul(0.5));

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
        const t = uTime.add(phase).mod(lifeTime); // 0 to 1

        // Physics
        // Pos = Origin + Vel * t - 0.5 * g * t^2
        // Initial Velocity:
        // Upward surge: V_y = 5.0 + uAudioLow * 10.0
        const vUp = float(5.0).add(uAudioLow.mul(10.0));

        // Random horizontal spread
        const vX = aVelocity.x.mul(2.0);
        const vZ = aVelocity.z.mul(2.0);

        const pos = vec3(
            aOrigin.x.add(vX.mul(t)),
            aOrigin.y.add(vUp.mul(t).sub(float(20.0).mul(t).mul(t).mul(0.5))), // Gravity = 20
            aOrigin.z.add(vZ.mul(t))
        );

        // Bounce check?
        // Just let it fall through floor, it resets.
        // Scale down at end of life
        const scaleLife = sin(t.mul(Math.PI)); // 0 -> 1 -> 0

        splashMat.positionNode = pos;

        // Adjust scale
        // Base splash size is ~0.15 * width.
        // We'll set the base scale in the matrix to (width*0.15), then modulate here?
        // Actually, since width varies per waterfall, we must set the base scale in JS via matrix.
        // Then we multiply by life scale in TSL.

        // TSL Scale Logic
        // scaleNode affects the local vertex position *before* matrix transform.
        // So `positionLocal` is scaled.
        // BUT `splashMat.positionNode` overrides the World Position calculation if not careful.
        // `positionNode` usually replaces the Vertex Stage output.
        // If we want to modify the vertex position relative to the instance matrix, we should use `vertexPositionNode`?
        // In `MeshStandardNodeMaterial`, `positionNode` is the final world position.
        // We calculated `pos` as World Position (using `aOrigin` which is world space).
        // So we don't use the instance matrix for position, only for scale reference?
        // Actually, if we use `positionNode = pos`, the instance matrix is ignored for position.
        // But we want to use the instance matrix to control the *size* (scale) of the splash.
        // We can extract scale from matrix? Or just set it.
        // `MeshStandardNodeMaterial` doesn't automatically apply instance matrix if `positionNode` is set explicitly to a world value.
        // UNLESS we add it.
        // `pos` is absolute world position.
        // We need to apply the size scaling.
        // `splashGeo` is radius 1.
        // If we want radius R, we scale local vertex by R.
        // `positionLocal` * scale.

        // The `pos` we calculated is the *center* of the sphere.
        // The vertex position is `pos + positionLocal * scale`.

        // Get scale from instance matrix?
        // Accessing instance matrix in TSL is possible but complex.
        // Simpler: Just pass `width` as an attribute or use a fixed size.
        // Waterfalls are usually similar size.
        // Let's assume a fixed splash size for optimization, or use `aVelocity.w` if we had it.
        // Let's use `aVelocity`'s magnitude or similar? No.
        // Let's just use a constant size of 0.5.
        const splashSize = float(0.5).mul(scaleLife);

        splashMat.positionNode = pos.add(positionLocal.mul(splashSize));

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
