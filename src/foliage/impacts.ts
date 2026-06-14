import * as THREE from 'three';
import { MeshStandardNodeMaterial, StorageInstancedBufferAttribute } from 'three/webgpu';
import {
    float, sin, cos, step, positionLocal, storage, Fn, If, instanceIndex, uniform,
    exp, rotate, normalize, vec4, vec3, smoothstep, mix, floor
} from 'three/tsl';

// WGSL-compatible modulo: x - y * floor(x / y)
// Note: Converts inputs to float first since WGSL floor() only works on floats
const modFloat = (x: any, y: any) => {
    const xf = float(x);
    const yf = float(y);
    return xf.sub(yf.mul(xf.div(yf).floor()));
};


const hash = Fn(([n]) => {
    return modFloat(sin(n).mul(43758.5453), 1.0);
});

import { uTime, uAudioHigh, uAudioLow } from './index.ts';

const MAX_PARTICLES = 1000; // Reduced from 4000 for WebGPU uniform buffer limits
let _impactMesh: THREE.InstancedMesh | null = null;
let _head = 0;

export type ImpactType =
  | 'jump'
  | 'land'
  | 'dash'
  | 'berry'
  | 'snare'
  | 'mist'
  | 'rain'
  | 'spore'
  | 'trail'
  | 'muzzle'
  | 'splash'
  | 'magic'
  | 'explosion';

interface ImpactConfigItem {
    count: number;
}



const IMPACT_TYPE_MAP: Record<ImpactType, number> = {
    jump: 0, land: 1, dash: 2, berry: 3, snare: 4,
    mist: 5, rain: 6, spore: 7, trail: 8, muzzle: 9,
    splash: 10, magic: 11, explosion: 12
};

const IMPACT_CONFIG: Record<ImpactType, ImpactConfigItem> = {
    jump: { count: 20 },
    land: { count: 40 },
    dash: { count: 30 },
    berry: { count: 15 },
    snare: { count: 25 },
    mist: { count: 20 },
    rain: { count: 30 },
    spore: { count: 10 },
    trail: { count: 1 },
    muzzle: { count: 5 }, // Fast burst
    splash: { count: 20 },
    magic: { count: 15 },
    explosion: { count: 50 }
};

export interface ImpactSystemUserData {
    head: number;
    isImpactSystem: boolean;
    bufferSize: number;
    computeNode: any;
    uSpawnCount: any;
    uSpawnIndex: any;

    stagingSpawnArray: Float32Array;
    stagingVelArray: Float32Array;
    stagingColorArray: Float32Array;
    stagingMiscArray: Float32Array;
    stagingSpawnBuffer: StorageInstancedBufferAttribute;
    stagingVelBuffer: StorageInstancedBufferAttribute;
    stagingColorBuffer: StorageInstancedBufferAttribute;
    stagingMiscBuffer: StorageInstancedBufferAttribute;
    maxSpawnsPerFrame: number;
}

// Global uniform to store max speed across multiple calls
let uMaxSpeed = 0;

export function createImpactSystem(): THREE.InstancedMesh {
    if (_impactMesh) return _impactMesh;

    // Candy Crumbs Geometry
    // OPTIMIZATION: Use Icosahedron (low poly) instead of Sphere
    // Fixes WebGPU pointUV issue and allows rotation
    const geometry = new THREE.IcosahedronGeometry(0.1, 0);

    // Custom Attributes for TSL via Storage Instanced Buffers
    const spawnArray = new Float32Array(MAX_PARTICLES * 4);
    const velArray = new Float32Array(MAX_PARTICLES * 4);
    const colorArray = new Float32Array(MAX_PARTICLES * 4);
    const miscArray = new Float32Array(MAX_PARTICLES * 4);

    // Initialize Birth Times to -1000 (Dead)
    for (let i = 0; i < MAX_PARTICLES; i++) {
        spawnArray[i * 4 + 3] = -1000.0;
        // set some default random misc values to avoid zero vectors
        miscArray[i * 4 + 0] = Math.random() - 0.5;
        miscArray[i * 4 + 1] = Math.random() - 0.5;
        miscArray[i * 4 + 2] = Math.random() - 0.5;
    }

    const spawnBuffer = new StorageInstancedBufferAttribute(spawnArray, 4);
    const velBuffer = new StorageInstancedBufferAttribute(velArray, 4);
    const colorBuffer = new StorageInstancedBufferAttribute(colorArray, 4);
    const miscBuffer = new StorageInstancedBufferAttribute(miscArray, 4);

    // JUICE: Custom TSL Material for particles
    const mat = new MeshStandardNodeMaterial({
        color: 0xFFFFFF,
        roughness: 0.4,
        metalness: 0.1,
        transparent: true,
        depthWrite: false, // Particles don't occlude
    });

    // --- TSL LOGIC ---
    // Use storage to retrieve per-instance data
    const aSpawn = storage(spawnBuffer, 'vec4', spawnBuffer.count);
    const aVelocity = storage(velBuffer, 'vec4', velBuffer.count);
    const aColor = storage(colorBuffer, 'vec4', colorBuffer.count);
    const aMisc = storage(miscBuffer, 'vec4', miscBuffer.count);

    // Map to logic variables
    const spawnPos = aSpawn.element(instanceIndex).xyz;
    const birthTime = aSpawn.element(instanceIndex).w;
    
    const velocity = aVelocity.element(instanceIndex).xyz;
    const lifeSpan = aVelocity.element(instanceIndex).w;

    const colorAttr = aColor.element(instanceIndex).rgb;
    const sizeAttr = aColor.element(instanceIndex).w;

    const rotAxis = aMisc.element(instanceIndex).xyz;
    const gravityScale = aMisc.element(instanceIndex).w;

    // Age & Progress
    const age = uTime.sub(birthTime);
    const lifeProgress = age.div(lifeSpan.add(0.0001)); // prevent div by 0
    const isAlive = lifeProgress.greaterThan(0.0).and(lifeProgress.lessThan(1.0));

    // 1. Physics: Explosive Drag + Gravity
    const drag = float(2.0);
    // Integral of v*exp(-drag*t)
    const explosiveDist = velocity.mul(float(1.0).sub(exp(age.mul(drag).negate()))).div(drag);

    const gravity = vec3(0.0, -12.0, 0.0); // Slightly heavier gravity for chunks
    const gravityDrop = gravity.mul(gravityScale).mul(age.mul(age).mul(0.5));

    const particleWorldPos = spawnPos.add(explosiveDist).add(gravityDrop);

    // 2. Rotation (Spin)
    const spinSpeed = float(10.0);
    const rotationAngle = age.mul(spinSpeed);
    const rotatedLocal = rotate(positionLocal, normalize(rotAxis.add(vec3(0.01))), rotationAngle);

    // 3. Scaling (Pop in with Elastic Overshoot, Shrink out)
    // 🎨 PALETTE: Make particles pop in fast, overshoot, and slowly shrink
    const popIn = smoothstep(0.0, 0.15, lifeProgress); // 0 -> 1 very quickly
    const fadeOut = float(1.0).sub(smoothstep(0.15, 1.0, lifeProgress)); // 1 -> 0 slowly

    // Elastic bounce: sin(t * freq) * decay
    // We want the bounce to happen right after popIn
    const bouncePhase = lifeProgress.mul(Math.PI * 8.0);
    const bounceDecay = float(1.0).sub(lifeProgress).pow(4.0);
    const elasticBounce = sin(bouncePhase).mul(bounceDecay).mul(0.4); // Max 40% overshoot

    // Combine base size, pop, fade, and bounce
    const baseScale = popIn.mul(fadeOut);

    // Audio Reactivity (Juice): Pulse size with low frequencies (Kick)
    const audioScale = float(1.0).add(uAudioLow.mul(0.5));
    const finalScale = sizeAttr.mul(baseScale.add(elasticBounce).max(0.0)).mul(audioScale);

    // Apply scale to rotated local vertex
    const scaledLocal = rotatedLocal.mul(finalScale);

    // Final Position Node
    // This OVERRIDES the default vertex position logic, effectively ignoring the 
    // garbage transform that 'instanceMatrix' would normally produce.
    mat.positionNode = particleWorldPos.add(scaledLocal);

    // 4. Color & Juice
    // Audio Shimmer (Highs add shimmer, Lows add brightness pulse)
    const shimmer = sin(age.mul(20.0).add(uAudioHigh.mul(10.0))).mul(0.2).add(1.0);
    const bassGlow = uAudioLow.mul(1.5);
    const totalGlow = shimmer.add(bassGlow);

    // Fade Out
    const opacity = float(1.0).sub(smoothstep(0.7, 1.0, lifeProgress));

    mat.colorNode = colorAttr.mul(totalGlow);
    mat.opacityNode = opacity.mul(isAlive);

    // 5. Mesh Creation
    _impactMesh = new THREE.InstancedMesh(geometry, mat, MAX_PARTICLES);
    _impactMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    _impactMesh.count = MAX_PARTICLES; 
    _impactMesh.castShadow = false;
    _impactMesh.receiveShadow = false;
    _impactMesh.frustumCulled = false;

    // Remove old internal matrices CPU side logic as everything happens in TSL
    _impactMesh.matrixAutoUpdate = false;

    // COMPUTE SHADER LOGIC
    // We use a small staging buffer to pass the generated particles to the GPU
    // compute shader to avoid large uniform drops or CPU->GPU main buffer uploads.
    // This allows multiple different colored/sized impacts in one frame.
    const MAX_SPAWNS_PER_FRAME = 500;
    const stagingSpawnArray = new Float32Array(MAX_SPAWNS_PER_FRAME * 4);
    const stagingVelArray = new Float32Array(MAX_SPAWNS_PER_FRAME * 4);
    const stagingColorArray = new Float32Array(MAX_SPAWNS_PER_FRAME * 4);
    const stagingMiscArray = new Float32Array(MAX_SPAWNS_PER_FRAME * 4);

    const stagingSpawnBuffer = new StorageInstancedBufferAttribute(stagingSpawnArray, 4);
    const stagingVelBuffer = new StorageInstancedBufferAttribute(stagingVelArray, 4);
    const stagingColorBuffer = new StorageInstancedBufferAttribute(stagingColorArray, 4);
    const stagingMiscBuffer = new StorageInstancedBufferAttribute(stagingMiscArray, 4);

    const uSpawnCount = uniform(0);
    const uSpawnIndex = uniform(-1);

    const updateCompute = Fn(() => {
        // Run ONLY for the number of particles spawned this frame
        const stageIndex = instanceIndex;

        const sSpawnNode = storage(spawnBuffer, 'vec4', spawnBuffer.count);
        const sVelNode = storage(velBuffer, 'vec4', velBuffer.count);
        const sColorNode = storage(colorBuffer, 'vec4', colorBuffer.count);
        const sMiscNode = storage(miscBuffer, 'vec4', miscBuffer.count);

        const inSpawnNode = storage(stagingSpawnBuffer, 'vec4', stagingSpawnBuffer.count).element(stageIndex);
        const inColorNode = storage(stagingColorBuffer, 'vec4', stagingColorBuffer.count).element(stageIndex);
        const inMiscNode = storage(stagingMiscBuffer, 'vec4', stagingMiscBuffer.count).element(stageIndex);

        const spawnCount = uSpawnCount.toVar();
        const spawnIdx = uSpawnIndex.toVar();

        If(stageIndex.lessThan(spawnCount), () => {
            // Target index in main buffer
            const targetIdx = modFloat(stageIndex.add(spawnIdx), float(MAX_PARTICLES));

            const baseColor = inColorNode.xyz;
            const typeId = inMiscNode.x; // We pass type as an integer in Misc.x
            const dirX = inMiscNode.y;
            const dirY = inMiscNode.z;
            const dirZ = inMiscNode.w;

            const baseSeed = float(targetIdx).add(uTime);

            const rand1 = hash(baseSeed);
            const rand2 = hash(baseSeed.add(1.0));
            const rand3 = hash(baseSeed.add(2.0));
            const rand4 = hash(baseSeed.add(3.0));

            const theta = rand1.mul(Math.PI * 2.0);
            const phi = rand2.mul(Math.PI);

            const finalVel = vec3(0.0).toVar();
            const finalLife = float(0.0).toVar();
            const finalColor = baseColor.toVar();
            const finalSize = float(0.5).add(rand4).toVar();
            const gScale = float(1.0).toVar();

            If(typeId.equal(0.0), () => { // jump
                const r = rand3.mul(2.0);
                finalVel.x = cos(theta).mul(r);
                finalVel.y = float(3.0).add(rand4.mul(4.0));
                finalVel.z = sin(theta).mul(r);
                finalLife.assign(float(0.5).add(rand2.mul(0.5)));
                finalColor.assign(vec3(1.0, 0.8, 0.2));
            }).ElseIf(typeId.equal(1.0), () => { // land
                const r = float(4.0).add(rand3.mul(3.0));
                finalVel.x = cos(theta).mul(r);
                finalVel.y = float(1.0).add(rand4.mul(2.0));
                finalVel.z = sin(theta).mul(r);
                finalLife.assign(float(0.5).add(rand2.mul(0.5)));
                finalColor.assign(vec3(0.6, 0.5, 0.4));
            }).ElseIf(typeId.equal(2.0), () => { // dash
                const speed = float(4.0).add(rand3.mul(6.0));
                finalVel.x = sin(phi).mul(cos(theta)).mul(speed);
                finalVel.y = cos(phi).mul(speed);
                finalVel.z = sin(phi).mul(sin(theta)).mul(speed);
                finalLife.assign(float(0.5).add(rand2.mul(0.5)));
                finalColor.assign(vec3(0.0, 1.0, 1.0));
            }).ElseIf(typeId.equal(3.0), () => { // berry
                const speed = float(2.0).add(rand3.mul(4.0));
                finalVel.x = sin(phi).mul(cos(theta)).mul(speed);
                finalVel.y = cos(phi).mul(speed);
                finalVel.z = sin(phi).mul(sin(theta)).mul(speed);
                finalLife.assign(float(0.5).add(rand2.mul(0.5)));
                finalColor.assign(mix(vec3(1.0, 0.6, 0.0), vec3(1.0, 0.2, 0.5), step(0.5, rand1)));
            }).ElseIf(typeId.equal(4.0), () => { // snare
                const r = float(2.0).add(rand3.mul(3.0));
                finalVel.x = cos(theta).mul(r);
                finalVel.y = float(2.0).add(rand4.mul(5.0));
                finalVel.z = sin(theta).mul(r);
                finalLife.assign(float(0.5).add(rand2.mul(0.5)));
                finalColor.assign(vec3(1.0, 0.1, 0.1));
            }).ElseIf(typeId.equal(5.0), () => { // mist
                const r = rand3.mul(1.5);
                finalVel.x = cos(theta).mul(r);
                finalVel.y = float(2.0).add(rand4.mul(3.0));
                finalVel.z = sin(theta).mul(r);
                gScale.assign(-0.5);
                finalLife.assign(float(0.5).add(rand2.mul(0.5)));
                finalColor.assign(vec3(0.9, 0.9, 1.0));
            }).ElseIf(typeId.equal(6.0), () => { // rain
                const r = rand3.mul(1.0);
                finalVel.x = cos(theta).mul(r);
                finalVel.y = float(-5.0).sub(rand4.mul(5.0));
                finalVel.z = sin(theta).mul(r);
                gScale.assign(2.0);
                finalLife.assign(float(0.5).add(rand2.mul(0.5)));
                finalColor.assign(vec3(0.2, 0.2, 1.0));
            }).ElseIf(typeId.equal(7.0), () => { // spore
                const r = rand3.mul(2.0);
                finalVel.x = cos(theta).mul(r);
                finalVel.y = float(1.0).add(rand4.mul(2.0));
                finalVel.z = sin(theta).mul(r);
                gScale.assign(-0.2);
                finalLife.assign(float(1.5).add(rand2.mul(1.5)));
                finalSize.assign(float(0.2).add(rand4.mul(0.3)));

                If(rand1.lessThan(0.33), () => {
                    finalColor.assign(vec3(0.0, 1.0, 1.0));
                }).ElseIf(rand1.lessThan(0.66), () => {
                    finalColor.assign(vec3(1.0, 0.0, 1.0));
                }).Else(() => {
                    finalColor.assign(vec3(0.5, 1.0, 0.0));
                });
            }).ElseIf(typeId.equal(8.0), () => { // trail
                finalVel.x = rand1.sub(0.5).mul(0.5);
                finalVel.y = rand2.sub(0.5).mul(0.5);
                finalVel.z = rand3.sub(0.5).mul(0.5);
                gScale.assign(0.0);
                finalLife.assign(float(0.3).add(rand2.mul(0.2)));
                finalSize.assign(float(0.3).add(rand4.mul(0.2)));
            }).ElseIf(typeId.equal(9.0), () => { // muzzle
                If(dirX.notEqual(0.0).or(dirY.notEqual(0.0)).or(dirZ.notEqual(0.0)), () => {
                    const speed = float(10.0).add(rand3.mul(5.0));
                    const spread = 2.0;
                    finalVel.x = dirX.mul(speed).add(rand1.sub(0.5).mul(spread));
                    finalVel.y = dirY.mul(speed).add(rand2.sub(0.5).mul(spread));
                    finalVel.z = dirZ.mul(speed).add(rand3.sub(0.5).mul(spread));
                }).Else(() => {
                    const speed = float(5.0).add(rand3.mul(5.0));
                    finalVel.x = sin(phi).mul(cos(theta)).mul(speed);
                    finalVel.y = cos(phi).mul(speed);
                    finalVel.z = sin(phi).mul(sin(theta)).mul(speed);
                });
                gScale.assign(0.5);
                finalLife.assign(float(0.15).add(rand2.mul(0.15)));
                finalSize.assign(float(0.5).add(rand4.mul(0.5)));
            }).Else(() => {
                finalVel.x = rand1.sub(0.5);
                finalVel.y = rand2.sub(0.5);
                finalVel.z = rand3.sub(0.5);
                finalLife.assign(float(0.5).add(rand2.mul(0.5)));
            });

            // Fallback for custom color passed directly via CPU
            If(baseColor.x.notEqual(-1.0), () => {
                finalColor.assign(baseColor);
            });

            // Copy to main
            sSpawnNode.element(targetIdx).assign(inSpawnNode);
            sVelNode.element(targetIdx).assign(vec4(finalVel, finalLife));
            sColorNode.element(targetIdx).assign(vec4(finalColor, finalSize));
            sMiscNode.element(targetIdx).assign(vec4(hash(baseSeed.add(4.0)).sub(0.5), hash(baseSeed.add(5.0)).sub(0.5), hash(baseSeed.add(6.0)).sub(0.5), gScale));
        });
    });

    const computeNode = updateCompute().compute(MAX_SPAWNS_PER_FRAME);

    _impactMesh.userData = {
        head: 0,
        isImpactSystem: true,
        bufferSize: MAX_PARTICLES,
        computeNode: computeNode,
        uSpawnCount: uSpawnCount,
        uSpawnIndex: uSpawnIndex,

        // Expose staging buffers to CPU
        stagingSpawnArray,
        stagingVelArray,
        stagingColorArray,
        stagingMiscArray,
        stagingSpawnBuffer,
        stagingVelBuffer,
        stagingColorBuffer,
        stagingMiscBuffer,
        maxSpawnsPerFrame: MAX_SPAWNS_PER_FRAME
    } as ImpactSystemUserData;

    return _impactMesh;
}

// Staging queues for particles since spawnImpact can be called multiple times per frame
let _spawnQueue: any[] = [];

export function spawnImpact(
    pos: THREE.Vector3 | {x:number, y:number, z:number},
    type: ImpactType = 'jump',
    color?: number | {r:number, g:number, b:number} | THREE.Color,
    direction?: THREE.Vector3 | {x:number, y:number, z:number}
) {
    if (!_impactMesh || !_impactMesh.userData.isImpactSystem) return;

    const config = IMPACT_CONFIG[type] || IMPACT_CONFIG.jump;
    const count = config.count;

    // Queue the spawn
    _spawnQueue.push({ pos: {...pos}, type, color, direction, count });
}

export function updateImpacts(renderer: any, time: number) {
    if (!_impactMesh || !_impactMesh.userData.isImpactSystem) return;

    const userData = _impactMesh.userData as ImpactSystemUserData;

    // Reset spawn count initially
    userData.uSpawnCount.value = 0;

    if (_spawnQueue.length > 0 && renderer && renderer.compute) {
        
        let totalSpawns = 0;
        const now = time;

        for (let s = 0; s < _spawnQueue.length; s++) {
            const spawn = _spawnQueue[s];
            const type = spawn.type;
            let count = spawn.count;
            const pos = spawn.pos;
            const color = spawn.color;
            const direction = spawn.direction;

            // Cap to max staging buffer size
            if (totalSpawns + count > userData.maxSpawnsPerFrame) {
                count = userData.maxSpawnsPerFrame - totalSpawns;
                if (count <= 0) break;
            }

            for (let i = 0; i < count; i++) {
                const offset = (totalSpawns + i) * 4;

                // Position & Time
                const ox = (Math.random() - 0.5) * 0.5;
                const oy = (Math.random() - 0.5) * 0.5;
                const oz = (Math.random() - 0.5) * 0.5;

                userData.stagingSpawnArray[offset + 0] = pos.x + ox;
                userData.stagingSpawnArray[offset + 1] = pos.y + oy;
                userData.stagingSpawnArray[offset + 2] = pos.z + oz;
                userData.stagingSpawnArray[offset + 3] = now;

                // Base color parsing
                let r=-1.0, g=-1.0, b=-1.0;
                if (color !== undefined) {
                    if (typeof color === 'number') {
                        r = ((color >> 16) & 255) / 255;
                        g = ((color >> 8) & 255) / 255;
                        b = (color & 255) / 255;
                    } else if ((color as any).isColor) {
                        r = (color as THREE.Color).r;
                        g = (color as THREE.Color).g;
                        b = (color as THREE.Color).b;
                    } else {
                        const c = color as {r:number, g:number, b:number};
                        r = c.r; g = c.g; b = c.b;
                    }
                }

                userData.stagingColorArray[offset + 0] = r;
                userData.stagingColorArray[offset + 1] = g;
                userData.stagingColorArray[offset + 2] = b;
                userData.stagingColorArray[offset + 3] = 1.0;

                // Misc stores typeId and direction
                userData.stagingMiscArray[offset + 0] = IMPACT_TYPE_MAP[type] ?? 13.0;
                userData.stagingMiscArray[offset + 1] = direction ? direction.x : 0.0;
                userData.stagingMiscArray[offset + 2] = direction ? direction.y : 0.0;
                userData.stagingMiscArray[offset + 3] = direction ? direction.z : 0.0;
            }

            totalSpawns += count;
        }

        if (totalSpawns > 0) {
            // Push staging data to GPU
            userData.stagingSpawnBuffer.needsUpdate = true;
            userData.stagingVelBuffer.needsUpdate = true;
            userData.stagingColorBuffer.needsUpdate = true;
            userData.stagingMiscBuffer.needsUpdate = true;

            // Update uniforms
            userData.uSpawnCount.value = totalSpawns;
            userData.uSpawnIndex.value = userData.head;

            // Execute compute
            renderer.compute(userData.computeNode);

            // Advance head
            userData.head = (userData.head + totalSpawns) % userData.bufferSize;
        }

        // Clear queue
        _spawnQueue.length = 0;
    }
}
