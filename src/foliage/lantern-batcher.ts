import * as THREE from 'three';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import {
    color, float, vec3, vec4, attribute, positionLocal, positionWorld,
    sin, cos, mix, smoothstep, uniform, If, time,
    varying, dot, normalize, normalLocal, step, uv
} from 'three/tsl';
import {
    sharedGeometries, foliageMaterials, uTime,
    uAudioLow, uAudioHigh, createRimLight, calculateWindSway, applyPlayerInteraction,
    createStandardNodeMaterial, createUnifiedMaterial
} from './common.js';
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
    private stemParams: THREE.InstancedBufferAttribute | null = null; // [height, unused, unused, unused]
    private topParams: THREE.InstancedBufferAttribute | null = null;  // [height, unused, unused, unused]
    private instanceColor: THREE.InstancedBufferAttribute | null = null; // [r, g, b]

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
        // If spawnTime is 0 or negative, we assume instant show (or old object)
        // Actually uTime starts at 0. So spawnTime should be valid.
        // We handle case where spawnTime might be undefined (default 0).
        // If spawnTime > uTime, it shouldn't show?

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
        // Merged Geometry for Top (Hook + Cap + Bulb)
        // We build this relative to (0,0,0) which will be placed at (0, Height, 0) via Instance Matrix?
        // NO. InstancedMesh matrix handles position.
        // But the Stem scales. The Top just translates.
        // If we use the SAME instance matrix (Position/Rot), we need to Offset the Top by Height in TSL.
        // Because the InstanceMatrix is for the ROOT.
        // So:
        // Stem: Scale Y in TSL.
        // Top: Translate Y in TSL.

        const geometry = this.createTopGeometry();

        // Attributes
        this.topParams = new THREE.InstancedBufferAttribute(new Float32Array(MAX_LANTERNS * 4), 4);
        this.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_LANTERNS * 3), 3);

        geometry.setAttribute('instanceParams', this.topParams);
        geometry.setAttribute('instanceColor', this.instanceColor);

        // Materials
        // 0: Dark Metal (Hook/Cap)
        // 1: Emissive Glass (Bulb)

        // Mat 0
        const darkMat = createUnifiedMaterial(0x2F4F4F, { roughness: 0.7, metalness: 0.5 });

        // Mat 1 (Bulb)
        const bulbMat = createStandardNodeMaterial({
            color: 0xFFFFFF,
            roughness: 0.2
        });

        // TSL for Top
        // 1. Offset Y by Height
        const params = attribute('instanceParams', 'vec4');
        const height = params.x;
        const spawnTime = params.w;
        const colorAttr = attribute('instanceColor', 'vec3');

        // Pop-In Logic (Scale from 0)
        const age = uTime.sub(spawnTime);
        const popProgress = smoothstep(0.0, 1.0, age.mul(2.0));
        const overshoot = sin(popProgress.mul(10.0)).mul(float(1.0).sub(popProgress)).mul(0.3);
        const popScale = popProgress.add(overshoot).max(0.001);

        // Scale geometry first (around 0,0,0 - which is top center)
        const scaledPos = positionLocal.mul(popScale);

        // Then Offset
        const offsetPos = scaledPos.add(vec3(0, height.mul(popScale), 0));
        // Note: height also scales up so it grows from bottom!

        // 2. Apply Sway (Top sways fully)
        // Wind at top is max
        // We need to calculate sway at height.
        // Re-use calculateWindSway but using the Offset Position
        // Note: calculateWindSway uses positionWorld usually?
        // In common.js: `const swayPhase = positionWorld.x...`
        // But `posNode.y` (local) is used for bending factor.
        // Here `posNode` is local. `posNode.y` is relative to Top Center.
        // The effective height for bending is `height + pos.y`.
        // Let's approximate: Sway amount based on `height`.

        // Sway Logic tailored for Top
        const windTime = uTime.mul(uWindSpeed.add(0.5));
        // Use Instance Position (from Matrix) for phase?
        // positionWorld is available.
        // We want the whole Top to move as a rigid body attached to stem tip.
        // Stem tip offset = calculateWindSway(vec3(0, height, 0))

        // We can just apply the same wind function with y=height
        const stemTipPos = vec3(0, height, 0);
        const tipSway = calculateWindSway(stemTipPos);
        const tipPush = applyPlayerInteraction(stemTipPos);

        const finalPos = offsetPos.add(tipSway).add(tipPush);

        // Apply to both materials
        darkMat.positionNode = finalPos;
        bulbMat.positionNode = finalPos;

        // Bulb Emissive Logic (Beat Reactivity)
        // Base Emissive from Instance Color
        // Pulse on Kick (uAudioLow)
        const pulse = uAudioLow.mul(2.0); // Strong flicker
        const baseIntensity = float(2.0);
        const totalIntensity = baseIntensity.add(pulse);

        bulbMat.emissiveNode = colorAttr.mul(totalIntensity);
        bulbMat.colorNode = colorAttr; // Tint the glass

        // Create Mesh
        this.topMesh = new THREE.InstancedMesh(geometry, [darkMat, bulbMat], MAX_LANTERNS);
        this.topMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
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
        const uvs: number[] = []; // Needed? Maybe for default attr

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
        // Rotate to arch over: Z -90deg.
        m.makeRotationZ(-Math.PI/2);
        // Translate to offset (0.5, 0, 0)
        m.setPosition(0.5, 0, 0);
        addPart(hookGeo, 0, m);

        // Cap (Cone)
        const capGeo = new THREE.ConeGeometry(0.2, 0.2, 6);
        // Position: End of hook is at (1.0, -0.2 approx?)
        // Torus R=0.5. Center at 0.5,0,0.
        // Arc goes from top (0.5, 0.5, 0) to side (1.0, 0, 0)?
        // Wait, Torus center is 0,0,0. Radius 0.5.
        // Rotated Z -90:
        // Start (angle 0) is at (0.5, 0, 0) -> (0, -0.5, 0) relative to torus center?
        // Let's visualize: Torus in XY plane.
        // makeRotationZ(-PI/2) -> X becomes -Y, Y becomes X.
        // Original Torus (Radius 0.5): ring in XY.
        // Arc PI (half circle).
        // Positioned at (0.5, 0, 0).
        // Let's assume the hook works like the original code:
        // hook.rotation.z = -Math.PI / 2;
        // hook.position.set(0.5, 0, 0);
        // bulbGroup.position.set(1.0, height - 0.2, 0);

        // We are relative to (0, Height, 0).
        // So Bulb is at (1.0, -0.2, 0).

        m.makeTranslation(1.0, -0.2, 0);
        addPart(capGeo, 0, m);

        groups.push({ start: startIndex, count: indices.length - startIndex, materialIndex: 0 });

        // 2. Bulb (Emissive Material 1)
        startIndex = indices.length;

        // Bulb Sphere
        const bulbGeo = sharedGeometries.unitSphere; // R=1
        m.makeScale(0.25, 0.4, 0.25);
        // Position: Cap is at (1.0, -0.2, 0).
        // Bulb below cap. Original: bulb.position.y = -0.3 (local to bulbGroup)
        // bulbGroup was at (1.0, height-0.2).
        // So Bulb is at (1.0, -0.5, 0).
        const posMat = new THREE.Matrix4().makeTranslation(1.0, -0.5, 0);
        m.premultiply(posMat);
        // Wait, order: Scale, then Translate.
        // makeScale resets matrix.
        m.makeTranslation(1.0, -0.5, 0);
        m.scale(new THREE.Vector3(0.25, 0.4, 0.25)); // Scale applies first? No, ThreeJS m.scale() applies Post-Multiply?
        // m.scale() multiplies current m by scale matrix?
        // Actually safe way: compose.
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

        this.stemParams!.setXYZW(i, height, 0, 0, spawnTime);
        this.topParams!.setXYZW(i, height, 0, 0, spawnTime);
        this.instanceColor!.setXYZ(i, c.r, c.g, c.b);

        this.stemMesh!.instanceMatrix.needsUpdate = true;
        this.topMesh!.instanceMatrix.needsUpdate = true;
        this.stemParams!.needsUpdate = true;
        this.topParams!.needsUpdate = true;
        this.instanceColor!.needsUpdate = true;
    }
}

export const lanternBatcher = LanternBatcher.getInstance();
