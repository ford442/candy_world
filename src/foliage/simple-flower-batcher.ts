import * as THREE from 'three';
// @ts-ignore
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import {
    color, float, vec3, vec4, attribute, positionLocal, positionWorld,
    sin, cos, mix, smoothstep, uniform, If, time,
    varying, dot, normalize, normalLocal, step, uv,
    Node
} from 'three/tsl';
import {
    sharedGeometries, foliageMaterials, uTime,
    uAudioLow, uAudioHigh, createRimLight, calculateWindSway, applyPlayerInteraction,
    createStandardNodeMaterial, createUnifiedMaterial, calculateFlowerBloom, CandyPresets,
    createClayMaterial
} from './common.ts';
import { foliageGroup } from '../world/state.ts';

const MAX_FLOWERS = 2000;

export class SimpleFlowerBatcher {
    private static instance: SimpleFlowerBatcher;
    private initialized = false;
    private count = 0;

    // Meshes
    public stemMesh: THREE.InstancedMesh | null = null;
    public headMesh: THREE.InstancedMesh | null = null;
    public beamMesh: THREE.InstancedMesh | null = null;

    // Attributes
    // x: Height, y: AnimationOffset, z: BeamActive (0/1), w: SpawnTime
    private stemParams: THREE.InstancedBufferAttribute | null = null;
    private headParams: THREE.InstancedBufferAttribute | null = null;
    private beamParams: THREE.InstancedBufferAttribute | null = null;
    private instanceColor: THREE.InstancedBufferAttribute | null = null; // [r, g, b]

    private constructor() {}

    static getInstance(): SimpleFlowerBatcher {
        if (!SimpleFlowerBatcher.instance) {
            SimpleFlowerBatcher.instance = new SimpleFlowerBatcher();
        }
        return SimpleFlowerBatcher.instance;
    }

    init() {
        if (this.initialized) return;

        this.initStem();
        this.initHead();
        this.initBeam();

        // Add to Scene
        if (foliageGroup) {
            if (this.stemMesh) foliageGroup.add(this.stemMesh);
            if (this.headMesh) foliageGroup.add(this.headMesh);
            if (this.beamMesh) foliageGroup.add(this.beamMesh);
        }

        this.initialized = true;
        console.log('[SimpleFlowerBatcher] Initialized with capacity ' + MAX_FLOWERS);
    }

    private initStem() {
        // Stem Geometry (Base Unit Cylinder, pivot at bottom)
        const geometry = sharedGeometries.unitCylinder.clone();

        // Attributes
        this.stemParams = new THREE.InstancedBufferAttribute(new Float32Array(MAX_FLOWERS * 4), 4);
        geometry.setAttribute('instanceParams', this.stemParams);

        // Material (TSL)
        // Clone standard stem material but modify for height scaling
        const mat = (foliageMaterials.stem as THREE.Material).clone();

        const params = attribute('instanceParams', 'vec4');
        const height = params.x;
        const spawnTime = params.w;

        // Pop-In Logic
        const age = uTime.sub(spawnTime);
        const popProgress = smoothstep(0.0, 1.0, age.mul(2.0));
        const overshoot = sin(popProgress.mul(10.0)).mul(float(1.0).sub(popProgress)).mul(0.3);
        const popScale = popProgress.add(overshoot).max(0.001);

        const pos = positionLocal;
        // Scale Y by height, X/Z uniform thickness
        const scaledPos = vec3(
            pos.x.mul(0.05).mul(popScale), // Standard thin stem
            pos.y.mul(height).mul(popScale),
            pos.z.mul(0.05).mul(popScale)
        );

        // Apply Sway/Push
        const sway = calculateWindSway(scaledPos);
        const push = applyPlayerInteraction(scaledPos);

        (mat as any).positionNode = scaledPos.add(sway).add(push);

        // Mesh
        this.stemMesh = new THREE.InstancedMesh(geometry, mat, MAX_FLOWERS);
        this.stemMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        this.stemMesh.count = 0;
        this.stemMesh.castShadow = true;
        this.stemMesh.receiveShadow = true;
    }

    private initHead() {
        const geometry = this.createHeadGeometry();

        // Attributes
        this.headParams = new THREE.InstancedBufferAttribute(new Float32Array(MAX_FLOWERS * 4), 4);
        this.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_FLOWERS * 3), 3);

        geometry.setAttribute('instanceParams', this.headParams);
        geometry.setAttribute('instanceColor', this.instanceColor);

        // Materials
        // 0: Center (Brown/Velvet)
        // 1: Stamen (Yellow Clay)
        // 2: Petal (User Color Clay/Velvet)

        const centerMat = (foliageMaterials.flowerCenter as THREE.Material).clone();
        const stamenMat = createClayMaterial(0xFFFF00);

        // Petal Material needs to handle instanceColor
        const petalMat = createClayMaterial(0xFFFFFF); // Base white

        // --- TSL Setup for ALL materials in the Head ---
        // All parts need to:
        // 1. Move up by 'height'
        // 2. Sway/Push based on that height (rigid head movement)
        // 3. Bloom (Petals only? Or whole head?)
        //    Original code: bloom applied to petals via deformationNode. Center/Stamens followed head matrix.
        //    So Bloom affects local position relative to Head Origin.

        const params = attribute('instanceParams', 'vec4');
        const height = params.x;
        const spawnTime = params.w;
        const animOffset = params.y;
        const colorAttr = attribute('instanceColor', 'vec3');

        // Pop-In Logic
        const age = uTime.sub(spawnTime);
        const popProgress = smoothstep(0.0, 1.0, age.mul(2.0));
        const overshoot = sin(popProgress.mul(10.0)).mul(float(1.0).sub(popProgress)).mul(0.3);
        const popScale = popProgress.add(overshoot).max(0.001);

        // Apply Bloom (Local Deformation)
        // calculateFlowerBloom uses uTime. We should add animOffset to uTime?
        // But calculateFlowerBloom uses global uTime.
        // Let's reimplement bloom with offset.

        const breath = sin(uTime.add(animOffset).mul(2.0)).mul(0.05);
        const bloomPulse = uAudioLow.mul(0.3);
        const bloomScale = float(1.0).add(breath).add(bloomPulse);

        // Local Position Scaling (Bloom + Pop)
        // Note: Head Geometry is built around (0,0,0).
        const localPos = positionLocal.mul(bloomScale).mul(popScale);

        // Offset to Top of Stem
        const offsetPos = localPos.add(vec3(0, height.mul(popScale), 0));

        // Wind/Push at Head Position
        // We approximate wind at the tip (height)
        const stemTipPos = vec3(0, height, 0); // Logic position
        // Ideally we should use the same logic as stem tip.
        // calculateWindSway uses positionWorld.
        // But we are in Local Space TSL.
        // Let's use the same approximation as Stem: sway based on height.
        // Since Stem scales Y, and uses pos.y for bending.
        // Top of stem has pos.y = height.
        // So we calculate sway/push for a point at y=height.
        // But sway function uses current pos to determine phase.

        // Let's use the logic from LanternBatcher:
        // Just use `calculateWindSway(vec3(0, height, 0))`?
        // No, calculateWindSway uses `positionWorld` internally for phase.
        // `positionWorld` in InstancedMesh is correct (matrix applied).
        // But `posNode.y` passed to it is Local Y.
        // For Stem: `scaledPos` was passed. `scaledPos.y` goes from 0 to height.
        // For Head: We want to match the sway of Stem at y=height.
        // So we construct a vector representing the stem tip in local space:
        const tipRef = vec3(0, height, 0).mul(popScale);
        const tipSway = calculateWindSway(tipRef);
        const tipPush = applyPlayerInteraction(tipRef);

        const finalPos = offsetPos.add(tipSway).add(tipPush);

        // Apply Position to All Materials
        (centerMat as any).positionNode = finalPos;
        (stamenMat as any).positionNode = finalPos;

        // Petal also gets Color override
        (petalMat as any).positionNode = finalPos;
        (petalMat as any).colorNode = colorAttr; // Tint with instance color

        this.headMesh = new THREE.InstancedMesh(
            geometry,
            [centerMat, stamenMat, petalMat],
            MAX_FLOWERS
        );
        this.headMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        this.headMesh.count = 0;
        this.headMesh.castShadow = true;
        this.headMesh.receiveShadow = true;
    }

    private initBeam() {
        // Beam Geometry (Cone)
        const geometry = sharedGeometries.unitCone.clone();

        // Attributes
        this.beamParams = new THREE.InstancedBufferAttribute(new Float32Array(MAX_FLOWERS * 4), 4);
        geometry.setAttribute('instanceParams', this.beamParams);

        // Material
        const mat = (foliageMaterials.lightBeam as THREE.Material).clone();

        const params = attribute('instanceParams', 'vec4');
        const height = params.x;
        const beamActive = params.z;
        const spawnTime = params.w;

        // Pop-In Logic
        const age = uTime.sub(spawnTime);
        const popProgress = smoothstep(0.0, 1.0, age.mul(2.0));
        const popScale = popProgress.max(0.001);

        // Visibility Toggle (Scale to 0 if not active)
        const activeScale = beamActive.step(0.5); // 1.0 if > 0.5, else 0.0

        const pos = positionLocal;

        // Scale: Thin, Tall (4.0), active toggle
        const scaledPos = vec3(
            pos.x.mul(0.1).mul(popScale).mul(activeScale),
            pos.y.mul(4.0).mul(popScale).mul(activeScale),
            pos.z.mul(0.1).mul(popScale).mul(activeScale)
        );

        // Offset to Head Height
        const offsetPos = scaledPos.add(vec3(0, height.mul(popScale), 0));

        // Sway/Push (Follow Head)
        const tipRef = vec3(0, height, 0).mul(popScale);
        const tipSway = calculateWindSway(tipRef);
        const tipPush = applyPlayerInteraction(tipRef);

        (mat as any).positionNode = offsetPos.add(tipSway).add(tipPush);

        this.beamMesh = new THREE.InstancedMesh(geometry, mat, MAX_FLOWERS);
        this.beamMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        this.beamMesh.count = 0;
        // Beams don't cast shadow usually, but fine
        this.beamMesh.castShadow = false;
        this.beamMesh.receiveShadow = false;
    }

    private createHeadGeometry(): THREE.BufferGeometry {
        const positions: number[] = [];
        const normals: number[] = [];
        const indices: number[] = [];
        const uvs: number[] = [];

        let vertexOffset = 0;
        const groups: { start: number, count: number, materialIndex: number }[] = [];

        const addPart = (geo: THREE.BufferGeometry, matIndex: number, transform: THREE.Matrix4) => {
             const posAttr = geo.attributes.position;
             const normAttr = geo.attributes.normal;

             const v = new THREE.Vector3();
             const n = new THREE.Vector3();

             for(let i=0; i<posAttr.count; i++){
                 v.set(posAttr.getX(i), posAttr.getY(i), posAttr.getZ(i));
                 v.applyMatrix4(transform);
                 positions.push(v.x, v.y, v.z);

                 if (normAttr) {
                     n.set(normAttr.getX(i), normAttr.getY(i), normAttr.getZ(i));
                     n.transformDirection(transform);
                     normals.push(n.x, n.y, n.z);
                 } else {
                     normals.push(0, 1, 0);
                 }
                 uvs.push(0,0);
             }

             if (geo.index) {
                 for(let i=0; i<geo.index.count; i++){
                     indices.push(geo.index.getX(i) + vertexOffset);
                 }
             } else {
                 for(let i=0; i<posAttr.count; i++){
                     indices.push(i + vertexOffset);
                 }
             }
             vertexOffset += posAttr.count;
        };

        const m = new THREE.Matrix4();

        // 1. Center (Mat 0) - Sphere R=0.1
        let startIndex = indices.length;
        m.makeScale(0.1, 0.1, 0.1);
        addPart(sharedGeometries.unitSphere, 0, m);
        groups.push({ start: startIndex, count: indices.length - startIndex, materialIndex: 0 });

        // 2. Stamens (Mat 1) - 3 Cylinders
        startIndex = indices.length;
        const stamenCount = 3;
        for (let i = 0; i < stamenCount; i++) {
            // Random rotation (fixed seed for batcher)
            const rx = (i / stamenCount) * 0.5 - 0.25;
            const rz = (i / stamenCount) * 0.5 - 0.25;

            // Compose: Translate(0, 0.075, 0) * Rotate * Scale
            // Actually: Scale -> Rotate -> Translate
            // T * R * S
            m.compose(
                new THREE.Vector3(0, 0.075, 0),
                new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, 0, rz)),
                new THREE.Vector3(0.01, 0.15, 0.01)
            );
            addPart(sharedGeometries.unitCylinder, 1, m);
        }
        groups.push({ start: startIndex, count: indices.length - startIndex, materialIndex: 1 });

        // 3. Petals (Mat 2) - 6 Icosahedrons
        startIndex = indices.length;
        const petalCount = 6;
        let basePetalGeo = new THREE.IcosahedronGeometry(0.15, 0);
        basePetalGeo = mergeVertices(basePetalGeo);
        // Pre-scale the geometry to flatten it: (1, 0.5, 1)
        basePetalGeo.scale(1, 0.5, 1);

        for (let i = 0; i < petalCount; i++) {
            const angle = (i / petalCount) * Math.PI * 2;

            // Rotation: Z 45deg
            const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, Math.PI / 4));
            // Rotate around Y by angle
            const qY = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -angle, 0)); // -angle to match loop
            // Combined rotation
            q.premultiply(qY);

            // Position
            const x = Math.cos(angle) * 0.18;
            const z = Math.sin(angle) * 0.18;

            m.compose(
                new THREE.Vector3(x, 0, z),
                qY.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(0,0,Math.PI/4))), // Correct rotation
                new THREE.Vector3(1, 1, 1)
            );
            addPart(basePetalGeo, 2, m);
        }
        groups.push({ start: startIndex, count: indices.length - startIndex, materialIndex: 2 });

        // Build BufferGeometry
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
        geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
        geo.setIndex(indices);

        groups.forEach(g => geo.addGroup(g.start, g.count, g.materialIndex));

        return geo;
    }

    register(dummy: THREE.Object3D, options: any) {
        if (!this.initialized) this.init();
        if (this.count >= MAX_FLOWERS) return;

        const i = this.count;
        this.count++;

        // Transforms
        dummy.updateMatrix();

        // Sync Meshes
        this.stemMesh!.setMatrixAt(i, dummy.matrix);
        this.headMesh!.setMatrixAt(i, dummy.matrix);
        this.beamMesh!.setMatrixAt(i, dummy.matrix);

        // Options
        const height = options.height !== undefined ? options.height : 0.8;
        const colorHex = options.color || 0xFFFFFF; // Default white if undefined
        const spawnTime = options.spawnTime !== undefined ? options.spawnTime : -100.0;
        const beamActive = options.hasBeam ? 1.0 : 0.0;
        const animOffset = Math.random() * 10.0;

        const c = new THREE.Color(colorHex);

        this.stemParams!.setXYZW(i, height, animOffset, beamActive, spawnTime);
        this.headParams!.setXYZW(i, height, animOffset, beamActive, spawnTime);
        this.beamParams!.setXYZW(i, height, beamActive, beamActive, spawnTime); // z and w recycled
        this.instanceColor!.setXYZ(i, c.r, c.g, c.b);

        this.stemMesh!.instanceMatrix.needsUpdate = true;
        this.headMesh!.instanceMatrix.needsUpdate = true;
        this.beamMesh!.instanceMatrix.needsUpdate = true;

        this.stemParams!.needsUpdate = true;
        this.headParams!.needsUpdate = true;
        this.beamParams!.needsUpdate = true;
        this.instanceColor!.needsUpdate = true;
    }
}

export const simpleFlowerBatcher = SimpleFlowerBatcher.getInstance();
