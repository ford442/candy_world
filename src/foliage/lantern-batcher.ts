import * as THREE from 'three';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import {
    color, float, vec3, vec4, attribute, positionLocal, positionWorld,
    sin, cos, mix, smoothstep, uniform, If, time,
    varying, dot, normalize, normalLocal, step, uv,
    mx_noise_float
} from 'three/tsl';
const instanceColor = attribute('instanceColor', 'vec3');
import {
    sharedGeometries, foliageMaterials, uTime,
    uAudioLow, uAudioHigh, createRimLight, createJuicyRimLight, calculateWindSway, applyPlayerInteraction,
    createStandardNodeMaterial, createUnifiedMaterial
} from './common.ts';
import { foliageGroup } from '../world/state.ts';

const MAX_LANTERNS = 1000;

export class LanternBatcher {
    private static instance: LanternBatcher;
    private initialized = false;
    private count = 0;

    // Meshes
    public stemMesh: THREE.InstancedMesh | null = null;
    public topMesh: THREE.InstancedMesh | null = null;

    // Attributes
    private stemParams: THREE.InstancedBufferAttribute | null = null; // [height, unused, unused, spawnTime]
    private topParams: THREE.InstancedBufferAttribute | null = null;  // [height, randomPhase, unused, spawnTime]

    private constructor() {}

    static getInstance(): LanternBatcher {
        if (!LanternBatcher.instance) {
            LanternBatcher.instance = new LanternBatcher();
        }
        return LanternBatcher.instance;
    }

    init() {
        if (this.initialized) return;

        this.initStem();
        this.initTop();

        // Add to Scene
        if (foliageGroup) {
            if (this.stemMesh) foliageGroup.add(this.stemMesh);
            if (this.topMesh) foliageGroup.add(this.topMesh);
        }

        this.initialized = true;
        console.log('[LanternBatcher] Initialized with capacity ' + MAX_LANTERNS);
    }

    private initStem() {
        // Stem Geometry (Base Unit Cylinder, pivot at bottom)
        const geometry = sharedGeometries.unitCylinder.clone();

        // Attributes
        this.stemParams = new THREE.InstancedBufferAttribute(new Float32Array(MAX_LANTERNS * 4), 4);
        geometry.setAttribute('instanceParams', this.stemParams);

        // Material (TSL)
        // Clone standard stem material but modify for height scaling
        const mat = foliageMaterials.stem.clone();

        // Custom Position Logic:
        // 1. Scale Y based on instanceParams.x (Height)
        // 2. Pop-In Animation based on instanceParams.w (SpawnTime)
        // 3. Apply Wind/Player Interaction
        const params = attribute('instanceParams', 'vec4');
        const height = params.x;
        const spawnTime = params.w;

        // Pop-In Logic
        const age = uTime.sub(spawnTime);
        const popProgress = smoothstep(0.0, 1.0, age.mul(2.0)); // 0.5s pop
        // Elastic overshoot
        const overshoot = sin(popProgress.mul(10.0)).mul(float(1.0).sub(popProgress)).mul(0.3);
        const popScale = popProgress.add(overshoot).max(0.001);

        const pos = positionLocal;
        // Apply Pop Scale to X/Z (thickness) and Y (height growth)
        const scaledPos = vec3(
            pos.x.mul(0.1).mul(popScale),
            pos.y.mul(height).mul(popScale),
            pos.z.mul(0.1).mul(popScale)
        ); // Thinner stem

        // Apply Sway (Scaled by height factor so bottom is fixed)
        // We use positionLocal.y (0 to 1) as factor
        const sway = calculateWindSway(scaledPos);
        const push = applyPlayerInteraction(scaledPos);

        mat.positionNode = scaledPos.add(sway).add(push);

        // Mesh
        this.stemMesh = new THREE.InstancedMesh(geometry, mat, MAX_LANTERNS);
        this.stemMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        this.stemMesh.count = 0;
        this.stemMesh.castShadow = true;
        this.stemMesh.receiveShadow = true;
    }

    private initTop() {
        const geometry = this.createTopGeometry();

        // Attributes - SINGLE packed attribute to stay within WebGPU 8 buffer limit
        this.topParams = new THREE.InstancedBufferAttribute(new Float32Array(MAX_LANTERNS * 4), 4);
        geometry.setAttribute('instanceParams', this.topParams);

        // Materials
        // 0: Dark Metal (Hook/Cap)
        // 1: Emissive Glass (Bulb)

        // Mat 0
        const darkMat = createUnifiedMaterial(0x2F4F4F, { roughness: 0.7, metalness: 0.5 });

        // Mat 1 (Bulb)
        const bulbMat = createStandardNodeMaterial({
            roughness: 0.2
        });

        // TSL for Top
        const params = attribute('instanceParams', 'vec4');
        const height = params.x;
        const randomPhase = params.y; // Used for swing physics
        const spawnTime = params.w;

        // Pop-In Logic (Scale from 0)
        const age = uTime.sub(spawnTime);
        const popProgress = smoothstep(0.0, 1.0, age.mul(2.0));
        const overshoot = sin(popProgress.mul(10.0)).mul(float(1.0).sub(popProgress)).mul(0.3);
        const popScale = popProgress.add(overshoot).max(0.001);

        // Scale geometry first (around 0,0,0 - which is top center)
        const scaledPos = positionLocal.mul(popScale);

        // Then Offset
        const offsetPos = scaledPos.add(vec3(0, height.mul(popScale), 0));

        // 2. Apply Sway (Top sways fully)
        // Wind at top is max

        // --- PALETTE: Physics Swing ---
        // A pendulum-like motion lagging behind or independent of the stem
        // Seed phase with instance-specific random value to make it rigid per instance
        const swingPhase = uTime.mul(3.0).add(randomPhase);
        const swingAmp = float(0.1); // Swing amplitude
        const swingX = sin(swingPhase).mul(swingAmp);
        const swingZ = cos(swingPhase.mul(0.8)).mul(swingAmp); // Different freq for chaos
        const swingOffset = vec3(swingX, float(0.0), swingZ);

        // Apply global wind sway (tip of stem)
        const stemTipPos = vec3(0, height, 0);
        const tipSway = calculateWindSway(stemTipPos);
        const tipPush = applyPlayerInteraction(stemTipPos);

        const finalPos = offsetPos.add(tipSway).add(tipPush).add(swingOffset);

        // Apply to both materials
        darkMat.positionNode = finalPos;
        bulbMat.positionNode = finalPos;

        // --- PALETTE: Juicy Bulb Material ---
        // Plasma Effect
        const noiseScale = float(5.0);
        const noiseSpeed = uTime.mul(2.0);
        const plasmaNoise = mx_noise_float(positionLocal.add(vec3(0, noiseSpeed, 0)).mul(noiseScale));

        // Mix Colors
        // Base is instanceColor. Hot is slightly yellow/white.
        // instanceColor is a node representing the color set via setColorAt
        const baseColor = instanceColor;
        const hotColor = vec3(1.0, 1.0, 0.8);
        const mixFactor = plasmaNoise.mul(0.5).add(0.5); // 0..1

        // Audio Boost (Pulse)
        const audioBoost = uAudioLow.mul(2.0);
        const totalIntensity = float(1.5).add(audioBoost).add(plasmaNoise.mul(0.5));

        const finalColor = mix(baseColor, hotColor, mixFactor);

        // Juicy Rim Light
        const rim = createJuicyRimLight(finalColor, float(2.0), float(3.0));

        bulbMat.emissiveNode = finalColor.mul(totalIntensity).add(rim);
        bulbMat.colorNode = finalColor; // Also set base color

        // Create Mesh
        this.topMesh = new THREE.InstancedMesh(geometry, [darkMat, bulbMat], MAX_LANTERNS);
        this.topMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        // Explicitly create instanceColor buffer for use with setColorAt
        this.topMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_LANTERNS * 3), 3);
        this.topMesh.count = 0;
        this.topMesh.castShadow = true;
        this.topMesh.receiveShadow = true;
    }

    private createTopGeometry(): THREE.BufferGeometry {
        // Merged Geometry: Hook (Torus), Cap (Cone), Bulb (Sphere)
        // Relative to Top connection point (0,0,0)

        const positions: number[] = [];
        const normals: number[] = [];
        const indices: number[] = [];
        const uvs: number[] = [];

        let vertexOffset = 0;
        const groups: { start: number, count: number, materialIndex: number }[] = [];

        const addPart = (geo: THREE.BufferGeometry, matIndex: number, transform: THREE.Matrix4) => {
             const posAttr = geo.attributes.position;
             const normAttr = geo.attributes.normal;
             // uv ignored for now

             const v = new THREE.Vector3();
             const n = new THREE.Vector3();

             for(let i=0; i<posAttr.count; i++){
                 v.set(posAttr.getX(i), posAttr.getY(i), posAttr.getZ(i));
                 v.applyMatrix4(transform);
                 positions.push(v.x, v.y, v.z);

                 n.set(normAttr.getX(i), normAttr.getY(i), normAttr.getZ(i));
                 n.transformDirection(transform);
                 normals.push(n.x, n.y, n.z);
                 uvs.push(0,0);
             }

             // Indices
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

        // 1. Hook (Dark Material 0)
        let startIndex = indices.length;

        // Hook Geometry: Torus segment
        const hookGeo = new THREE.TorusGeometry(0.5, 0.08, 6, 8, Math.PI);
        m.makeRotationZ(-Math.PI/2);
        m.setPosition(0.5, 0, 0);
        addPart(hookGeo, 0, m);

        // Cap (Cone)
        const capGeo = new THREE.ConeGeometry(0.2, 0.2, 6);
        m.makeTranslation(1.0, -0.2, 0);
        addPart(capGeo, 0, m);

        groups.push({ start: startIndex, count: indices.length - startIndex, materialIndex: 0 });

        // 2. Bulb (Emissive Material 1)
        startIndex = indices.length;

        // Bulb Sphere
        const bulbGeo = sharedGeometries.unitSphere; // R=1
        m.compose(new THREE.Vector3(1.0, -0.5, 0), new THREE.Quaternion(), new THREE.Vector3(0.25, 0.4, 0.25));

        addPart(bulbGeo, 1, m);

        groups.push({ start: startIndex, count: indices.length - startIndex, materialIndex: 1 });

        // Build Geometry
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
        if (this.count >= MAX_LANTERNS) return;

        const i = this.count;
        this.count++;

        // Transforms
        dummy.updateMatrix();

        // Stem
        this.stemMesh!.setMatrixAt(i, dummy.matrix);

        // Top
        this.topMesh!.setMatrixAt(i, dummy.matrix);

        // Params
        const height = options.height || 2.5;
        const colorHex = options.color || 0xFFA500;
        const spawnTime = options.spawnTime !== undefined ? options.spawnTime : -100.0;
        const c = new THREE.Color(colorHex);

        // Generate Random Phase for this instance
        const randomPhase = Math.random() * Math.PI * 2;

        this.stemParams!.setXYZW(i, height, 0, 0, spawnTime);
        this.topParams!.setXYZW(i, height, randomPhase, 0, spawnTime);
        
        // Use setColorAt
        this.topMesh!.setColorAt(i, c);

        this.stemMesh!.instanceMatrix.needsUpdate = true;
        this.topMesh!.instanceMatrix.needsUpdate = true;
        this.stemParams!.needsUpdate = true;
        this.topParams!.needsUpdate = true;
        if (this.topMesh!.instanceColor) this.topMesh!.instanceColor.needsUpdate = true;
    }
}

export const lanternBatcher = LanternBatcher.getInstance();
