import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { MeshStandardNodeMaterial, StorageInstancedBufferAttribute } from 'three/webgpu';
import {
    attribute, float, sin, cos, positionLocal, normalLocal,
    exp, rotate, normalize, vec4, vec3, smoothstep, step,
    mix, color, storage, instanceIndex, uniform, Fn, If
} from 'three/tsl';
import { uTime, uAudioHigh, uWindSpeed, uWindDirection, createSugarSparkle } from './index.ts';

const MAX_SEEDS = 500; // Reduced from 2000 for WebGPU uniform buffer limits
const MAX_SPAWNS_PER_FRAME = 200; // Allow multiple explosions in a single frame

let _seedMesh: THREE.InstancedMesh | null = null;
let _head = 0;

export interface DandelionSeedUserData {
    isDandelionSeedSystem: boolean;
    computeNode: any;
    uSpawnCount: any;
    uSpawnIndex: any;
    stagingSpawnArray: Float32Array;
    stagingVelArray: Float32Array;
    stagingMiscArray: Float32Array;
    stagingSpawnBuffer: StorageInstancedBufferAttribute;
    stagingVelBuffer: StorageInstancedBufferAttribute;
    stagingMiscBuffer: StorageInstancedBufferAttribute;
    maxSpawnsPerFrame: number;
}

// ⚡ OPTIMIZATION: Scratch variables
const _scratchVec3 = new THREE.Vector3();

// WGSL-compatible modulo: x - y * floor(x / y)
const modUint = (x: any, y: any) => {
    return x.remainder(y);
};

// Colors
const COLOR_STALK = new THREE.Color(0xFFFFFF); // White
const COLOR_TIP = new THREE.Color(0xFFD700);   // Gold

export function createDandelionSeedSystem(): THREE.InstancedMesh {
    if (_seedMesh) return _seedMesh;

    // --- 1. Geometry Construction (Stalk + Tip) ---
    // Reusing logic from DandelionBatcher to match visuals

    // A. Stalk
    const stalkGeo = new THREE.CylinderGeometry(0.005, 0.005, 0.4, 3);
    stalkGeo.translate(0, 0.2, 0); // Pivot at bottom

    // B. Tip
    const tipGeo = new THREE.SphereGeometry(0.04, 6, 6);
    tipGeo.translate(0, 0.4, 0); // Tip at end of stalk

    // Add 'color' attribute to distinguish parts
    const stalkCount = stalkGeo.attributes.position.count;
    const tipCount = tipGeo.attributes.position.count;

    const stalkColors = new Float32Array(stalkCount * 3);
    for(let i=0; i<stalkCount; i++) {
        stalkColors[i*3] = COLOR_STALK.r;
        stalkColors[i*3+1] = COLOR_STALK.g;
        stalkColors[i*3+2] = COLOR_STALK.b;
    }
    stalkGeo.setAttribute('color', new THREE.BufferAttribute(stalkColors, 3));

    const tipColors = new Float32Array(tipCount * 3);
    for(let i=0; i<tipCount; i++) {
        tipColors[i*3] = COLOR_TIP.r;
        tipColors[i*3+1] = COLOR_TIP.g;
        tipColors[i*3+2] = COLOR_TIP.b;
    }
    tipGeo.setAttribute('color', new THREE.BufferAttribute(tipColors, 3));

    const geometry = mergeGeometries([stalkGeo, tipGeo]);
    geometry.computeBoundingSphere();


    // Custom Attributes for TSL via Storage Instanced Buffers
    const spawnArray = new Float32Array(MAX_SEEDS * 4);
    const velArray = new Float32Array(MAX_SEEDS * 4);
    const miscArray = new Float32Array(MAX_SEEDS * 4);

    // Initialize to dead
    for(let i=0; i<MAX_SEEDS; i++) {
        spawnArray[i*4+3] = -1000.0;
        miscArray[i * 4 + 0] = Math.random() - 0.5;
        miscArray[i * 4 + 1] = Math.random() - 0.5;
        miscArray[i * 4 + 2] = Math.random() - 0.5;
    }

    const spawnBuffer = new StorageInstancedBufferAttribute(spawnArray, 4);
    const velBuffer = new StorageInstancedBufferAttribute(velArray, 4);
    const miscBuffer = new StorageInstancedBufferAttribute(miscArray, 4);

    // --- 2. TSL Material ---

    const mat = new MeshStandardNodeMaterial({
        vertexColors: true,
        roughness: 0.8,
        metalness: 0.0,
        transparent: true,
        depthWrite: false,
    });

    // Attributes mapped to storage buffers
    const aSpawn = storage(spawnBuffer, 'vec4', spawnBuffer.count);
    const aVelocity = storage(velBuffer, 'vec4', velBuffer.count);
    const aMisc = storage(miscBuffer, 'vec4', miscBuffer.count);

    const spawnPos = aSpawn.element(instanceIndex).xyz;
    const birthTime = aSpawn.element(instanceIndex).w;

    const velocity = aVelocity.element(instanceIndex).xyz;
    const lifeSpan = aVelocity.element(instanceIndex).w;

    const rotAxis = aMisc.element(instanceIndex).xyz;
    const randomPhase = aMisc.element(instanceIndex).w;

    // Time & Age
    const age = uTime.sub(birthTime);
    const lifeProgress = age.div(lifeSpan);
    const isAlive = lifeProgress.greaterThan(0.0).and(lifeProgress.lessThan(1.0));

    // Physics: Floating
    // 1. Initial burst with drag
    const drag = float(1.5);
    const burstDist = velocity.mul(float(1.0).sub(exp(age.mul(drag).negate()))).div(drag);

    // 2. Wind Drift (starts affecting after initial burst slows down)
    const windInfluence = smoothstep(0.5, 2.0, age);
    const windDrift = uWindDirection.mul(uWindSpeed).mul(age.mul(windInfluence));

    // 3. Floating Sway (Sine wave up/down/side)
    const swayFreq = float(2.0);
    const swayAmp = float(0.2);
    const sway = vec3(
        sin(age.mul(swayFreq).add(randomPhase)).mul(swayAmp),
        cos(age.mul(swayFreq.mul(0.7)).add(randomPhase)).mul(swayAmp),
        sin(age.mul(swayFreq.mul(1.3)).add(randomPhase)).mul(swayAmp)
    );

    // 4. Gravity (Very slight downward drift, or updraft)
    const gravity = vec3(0.0, -0.2, 0.0);
    const gravityDrop = gravity.mul(age);

    const particleWorldPos = spawnPos.add(burstDist).add(windDrift).add(sway).add(gravityDrop);


    // Rotation: Tumbling
    const tumbleSpeed = float(2.0);
    const tumbleAngle = age.mul(tumbleSpeed).add(randomPhase);
    const rotatedLocal = rotate(positionLocal, normalize(rotAxis), tumbleAngle);

    // Apply Position
    mat.positionNode = particleWorldPos.add(rotatedLocal);

    // Color & Opacity
    const vColor = attribute('color', 'vec3');

    // Sparkle on Gold Tip
    // Detect Gold Tip: Red > 0.5 AND Blue < 0.1
    // Stalk: R=1, G=1, B=1
    // Tip: R=1, G=0.84, B=0
    // Low Blue check works
    const isGold = float(1.0).sub(step(0.1, vColor.b));

    const sparkle = createSugarSparkle(normalLocal, float(40.0), float(0.5), float(2.0));
    const emission = vColor.mul(sparkle).mul(isGold);

    mat.colorNode = vColor;
    mat.emissiveNode = emission;

    // Fade Out
    const opacity = float(1.0).sub(smoothstep(0.7, 1.0, lifeProgress));
    mat.opacityNode = opacity.mul(isAlive);


    // --- 3. Mesh Setup ---

    _seedMesh = new THREE.InstancedMesh(geometry, mat, MAX_SEEDS);
    _seedMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    _seedMesh.count = MAX_SEEDS;
    _seedMesh.frustumCulled = false;
    _seedMesh.castShadow = false;
    _seedMesh.receiveShadow = false;

    // COMPUTE SHADER LOGIC
    const stagingSpawnArray = new Float32Array(MAX_SPAWNS_PER_FRAME * 4);
    const stagingVelArray = new Float32Array(MAX_SPAWNS_PER_FRAME * 4);
    const stagingMiscArray = new Float32Array(MAX_SPAWNS_PER_FRAME * 4);

    const stagingSpawnBuffer = new StorageInstancedBufferAttribute(stagingSpawnArray, 4);
    const stagingVelBuffer = new StorageInstancedBufferAttribute(stagingVelArray, 4);
    const stagingMiscBuffer = new StorageInstancedBufferAttribute(stagingMiscArray, 4);

    const uSpawnCount = uniform(0, 'uint');
    const uSpawnIndex = uniform(0, 'uint');

    const updateCompute = Fn(() => {
        const stageIndex = instanceIndex;

        const sSpawnNode = storage(spawnBuffer, 'vec4', spawnBuffer.count);
        const sVelNode = storage(velBuffer, 'vec4', velBuffer.count);
        const sMiscNode = storage(miscBuffer, 'vec4', miscBuffer.count);

        const inSpawnNode = storage(stagingSpawnBuffer, 'vec4', stagingSpawnBuffer.count).element(stageIndex);
        const inVelNode = storage(stagingVelBuffer, 'vec4', stagingVelBuffer.count).element(stageIndex);
        const inMiscNode = storage(stagingMiscBuffer, 'vec4', stagingMiscBuffer.count).element(stageIndex);

        const spawnCount = uSpawnCount;
        const spawnIdx = uSpawnIndex;

        If(stageIndex.lessThan(spawnCount), () => {
            const targetIdx = modUint(spawnIdx.add(stageIndex), MAX_SEEDS);

            // Write to main buffer
            sSpawnNode.element(targetIdx).assign(inSpawnNode);
            sVelNode.element(targetIdx).assign(inVelNode);
            sMiscNode.element(targetIdx).assign(inMiscNode);
        });
    });

    const computeNode = updateCompute().compute(MAX_SPAWNS_PER_FRAME);

    const userData: DandelionSeedUserData = {
        isDandelionSeedSystem: true,
        computeNode,
        uSpawnCount,
        uSpawnIndex,
        stagingSpawnArray,
        stagingVelArray,
        stagingMiscArray,
        stagingSpawnBuffer,
        stagingVelBuffer,
        stagingMiscBuffer,
        maxSpawnsPerFrame: MAX_SPAWNS_PER_FRAME
    };

    _seedMesh.userData = userData;

    return _seedMesh;
}

let _currentStageOffset = 0;
let _spawnHeadStart = -1;

export function spawnDandelionExplosion(
    center: THREE.Vector3,
    count: number = 24
) {
    if (!_seedMesh) return;

    const ud = _seedMesh.userData as DandelionSeedUserData;
    if (!ud.isDandelionSeedSystem) return;

    if (_currentStageOffset === 0) {
        _spawnHeadStart = _head;
    }

    const limit = Math.min(count, ud.maxSpawnsPerFrame - _currentStageOffset);
    if (limit <= 0) return;

    const now = ((uTime as any).value !== undefined) ? (uTime as any).value : performance.now() / 1000;

    for(let i=0; i<limit; i++) {
        const offset = (_currentStageOffset + i) * 4;

        // Spread out start position slightly (radius of head)
        // Dandelion head radius approx 0.2
        const r = 0.2 * Math.cbrt(Math.random()); // Uniform sphere distribution
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.acos(2 * Math.random() - 1);

        const dx = r * Math.sin(phi) * Math.cos(theta);
        const dy = r * Math.sin(phi) * Math.sin(theta);
        const dz = r * Math.cos(phi);

        ud.stagingSpawnArray[offset + 0] = center.x + dx;
        ud.stagingSpawnArray[offset + 1] = center.y + dy;
        ud.stagingSpawnArray[offset + 2] = center.z + dz;
        ud.stagingSpawnArray[offset + 3] = now;

        // Velocity: Explode outward from center
        // Add some randomness
        const speed = 2.0 + Math.random() * 3.0;

        // ⚡ OPTIMIZATION: Use scratch vector to avoid allocation in loop
        _scratchVec3.set(dx, dy, dz).normalize();

        ud.stagingVelArray[offset + 0] = _scratchVec3.x * speed;
        ud.stagingVelArray[offset + 1] = _scratchVec3.y * speed;
        ud.stagingVelArray[offset + 2] = _scratchVec3.z * speed;
        ud.stagingVelArray[offset + 3] = 4.0 + Math.random() * 4.0; // Life span (4-8s)

        // Misc: Rotation Axis & Phase
        ud.stagingMiscArray[offset + 0] = Math.random() - 0.5;
        ud.stagingMiscArray[offset + 1] = Math.random() - 0.5;
        ud.stagingMiscArray[offset + 2] = Math.random() - 0.5;
        ud.stagingMiscArray[offset + 3] = Math.random() * Math.PI * 2;
    }

    ud.stagingSpawnBuffer.needsUpdate = true;
    ud.stagingVelBuffer.needsUpdate = true;
    ud.stagingMiscBuffer.needsUpdate = true;

    _currentStageOffset += limit;
    _head = (_head + limit) % MAX_SEEDS;
}

/**
 * Call this every frame from the main render loop to process pending
 * dandelion seed spawns and run the compute shader.
 */
export function updateDandelionSeeds(renderer: any) {
    if (!_seedMesh) return;

    const ud = _seedMesh.userData as DandelionSeedUserData;
    if (!ud.isDandelionSeedSystem || !renderer || !renderer.compute) return;

    if (_currentStageOffset > 0) {
        ud.uSpawnCount.value = _currentStageOffset;
        ud.uSpawnIndex.value = _spawnHeadStart;

        renderer.compute(ud.computeNode);

        _currentStageOffset = 0;
    } else {
        // If no spawns, still need to ensure spawnCount is 0 so the shader doesn't
        // keep writing stale data
        if (ud.uSpawnCount.value > 0) {
            ud.uSpawnCount.value = 0;
        }
    }
}
