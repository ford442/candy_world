import * as THREE from 'three';
import { StorageInstancedBufferAttribute } from 'three/webgpu';
import {
    color, float, uniform, vec3, positionLocal, positionWorld,
    sin, dot, time, Node, UniformNode, ShaderNodeObject, attribute,
    storage, instanceIndex, Fn, If, vec4
} from 'three/tsl';
import { CandyPresets, uAudioLow, uTime } from './index.ts';
import { spawnImpact } from './impacts.ts';
import { uChromaticIntensity } from './chromatic.ts';
import { foliageGroup } from '../world/state.ts';
import { CommonGeometries, getSphereGeometry } from '../utils/geometry-dedup.ts';

// OPTIMIZED: BerryBatcher replaces thousands of individual InstancedMeshes
// with a single large InstancedMesh for improved draw call performance.

// --- Reusable Scratch Variables ---
const _scratchWorldPos = new THREE.Vector3();
const _scratchMatrix = new THREE.Matrix4();
const _scratchObject3D = new THREE.Object3D();
const _scratchLocalPos = new THREE.Vector3();
const _scratchLocalQuat = new THREE.Quaternion();
const _scratchLocalScale = new THREE.Vector3();
const _scratchColor = new THREE.Color();

// ⚡ OPTIMIZATION: Global uniform for seasonal berry scaling
export const uBerrySeasonScale = uniform(float(1.0));

// Interfaces
export interface BerryClusterOptions {
    count?: number;
    color?: number;
    baseGlow?: number;
    size?: number;
    shape?: 'sphere' | 'pear';
}

export interface BerryClusterUserData {
    initialTransforms: {
        positions: number[];
        quaternions: number[];
        scales: number[];
    };
    isBerry: boolean;
    batchIndex: number; // Start index in global batch
    count: number;
    baseGlow: number;
    weatherGlow: number;
    glowDecayRate: number;
    berryColor: number;
    // uClusterGlow removed, replaced by attribute
    lastMatrixWorld?: THREE.Matrix4; // ⚡ OPTIMIZATION: Cache for static check
}

export interface FallingBerry {
    active: boolean;
    age: number;
    velocity: THREE.Vector3;
    position: THREE.Vector3;
}

// --- Berry Batcher ---
const MAX_BERRIES = 2500; // Reduced from 10000 for WebGPU uniform buffer limits

export class BerryBatcher {
    private static instance: BerryBatcher;
    public mesh: THREE.InstancedMesh;
    public glowAttribute: THREE.InstancedBufferAttribute;
    public count: number = 0;
    public clusters: Set<THREE.Group> = new Set();

    // Scratch for update
    private _dummy = new THREE.Object3D();

    private constructor() {
        // Geometry: Sphere (shared via registry - deduplicated)
        // Using slightly higher poly sphere for better refraction
        const geometry = getSphereGeometry(0.1, 16, 16);

        // Material: Heartbeat Gummy (Shared)
        // Uses attributes for glow instead of uniforms
        const material = createHeartbeatMaterial();

        this.mesh = new THREE.InstancedMesh(geometry, material, MAX_BERRIES);
        this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        this.mesh.castShadow = true;
        this.mesh.receiveShadow = true;
        this.mesh.frustumCulled = false; // Clusters might be spread out, we manage visibility via logic

        // Custom Attribute: Glow Intensity
        const glowArray = new Float32Array(MAX_BERRIES);
        this.glowAttribute = new THREE.InstancedBufferAttribute(glowArray, 1);
        this.glowAttribute.setUsage(THREE.DynamicDrawUsage);
        geometry.setAttribute('aGlow', this.glowAttribute);

        // Add to world
        if (foliageGroup) {
            foliageGroup.add(this.mesh);
        } else {
            console.warn('[BerryBatcher] foliageGroup not found, berries will not be visible');
        }

        // Initialize instance colors buffer to white/orange default (will be overwritten)
        if (this.mesh.instanceColor) {
             for(let i=0; i<MAX_BERRIES; i++) {
                 this.mesh.setColorAt(i, _scratchColor.setHex(0xFF6600));
             }
        }
    }

    static getInstance(): BerryBatcher {
        if (!BerryBatcher.instance) {
            BerryBatcher.instance = new BerryBatcher();
        }
        return BerryBatcher.instance;
    }

    register(group: THREE.Group, options: BerryClusterOptions): void {
        const count = options.count || 5;
        if (this.count + count > MAX_BERRIES) {
            console.warn('[BerryBatcher] Max berries reached, skipping cluster');
            return;
        }

        const startIndex = this.count;
        this.count += count;

        group.userData.batchIndex = startIndex;
        group.userData.count = count;

        // Initial setup
        const colorHex = options.color || 0xFF6600;
        const baseGlow = options.baseGlow || 0.2;

        _scratchColor.setHex(colorHex);

        // Store local transforms in group userData for reconstruction
        const initialTransforms: BerryClusterUserData['initialTransforms'] = {
            positions: [],
            quaternions: [],
            scales: []
        };

        for (let i = 0; i < count; i++) {
            const idx = startIndex + i;

            // Generate Local Transform
            const phi = Math.acos(2 * (i / count) - 1);
            const theta = Math.PI * (1 + Math.sqrt(5)) * i;
            const radius = 0.12; // Cluster spread

            const px = radius * Math.sin(phi) * Math.cos(theta);
            const py = radius * Math.sin(phi) * Math.sin(theta) * 0.6;
            const pz = radius * Math.cos(phi);
            const sizeVar = 0.8 + Math.random() * 0.4;
            const size = (options.size || 0.08) / 0.1; // Normalize to geo radius 0.1

            _scratchObject3D.position.set(px, py, pz);
            _scratchObject3D.rotation.set(Math.random()*Math.PI, Math.random()*Math.PI, Math.random()*Math.PI);
            _scratchObject3D.scale.setScalar(sizeVar * size);
            _scratchMatrix.compose(_scratchObject3D.position, _scratchObject3D.quaternion, _scratchObject3D.scale);
            // Save for later
            initialTransforms.positions.push(px, py, pz);
            initialTransforms.quaternions.push(_scratchObject3D.quaternion.x, _scratchObject3D.quaternion.y, _scratchObject3D.quaternion.z, _scratchObject3D.quaternion.w);
            initialTransforms.scales.push(sizeVar * size);

            // Set Color
            this.mesh.setColorAt(idx, _scratchColor);

            // Set Glow
            this.glowAttribute.setX(idx, baseGlow);
        }

        group.userData.initialTransforms = initialTransforms;
        // ⚡ OPTIMIZATION: Cache initial matrix world (clone)
        group.userData.lastMatrixWorld = group.matrixWorld.clone();

        this.mesh.instanceColor!.needsUpdate = true;
        this.glowAttribute.needsUpdate = true;

        this.clusters.add(group);

        // Update mesh count
        this.mesh.count = this.count;
    }

    update(time: number, audioData: any) {
        // Iterate all registered clusters
        // If the cluster parent (tree) moves, we need to update world matrices
        // Since we don't track dirty state easily, we update visible clusters

        let meshNeedsUpdate = false;
        let glowNeedsUpdate = false;

        for (const group of this.clusters) {
            // Check if group is still in scene (has parent)
            if (!group.parent) {
                // Hide instances (Anti-Zombie Logic)
                const start = group.userData.batchIndex;
                const count = group.userData.count;
                _scratchMatrix.makeScale(0, 0, 0);
                for(let i=0; i<count; i++) {
                    // ⚡ OPTIMIZATION: Write directly to instanceMatrix array instead of updateMatrix + setMatrixAt
                    _scratchMatrix.toArray(this.mesh.instanceMatrix.array, (start + i) * 16);
                }
                meshNeedsUpdate = true;

                // Remove from tracking
                this.clusters.delete(group);
                continue;
            }

            // Calculate Glow Target
            const groove = audioData?.grooveAmount || 0;
            const baseGlow = group.userData.baseGlow || 0.2;
            const weatherGlow = group.userData.weatherGlow || 0;
            const targetIntensity = baseGlow + weatherGlow + (groove * 0.2);

            // Update Transforms & Glow
            const start = group.userData.batchIndex;
            const count = group.userData.count;
            const transforms = group.userData.initialTransforms;

            // Decay weather glow
            if (group.userData.weatherGlow > 0) {
                group.userData.weatherGlow -= (group.userData.glowDecayRate || 0.01);
                if (group.userData.weatherGlow < 0) group.userData.weatherGlow = 0;
            }

            // ⚡ OPTIMIZATION: Only update matrix if parent moved
            const parentMatrix = group.matrixWorld;
            let skipMatrixUpdate = false;

            if (group.userData.lastMatrixWorld) {
                if (group.userData.lastMatrixWorld.equals(parentMatrix)) {
                    skipMatrixUpdate = true;
                } else {
                    group.userData.lastMatrixWorld.copy(parentMatrix);
                }
            } else {
                 group.userData.lastMatrixWorld = parentMatrix.clone();
            }

            // Always update glow (audio/weather dependent)
            // But matrix update is heavy, so skip if possible

            for (let i = 0; i < count; i++) {
                const idx = start + i;

                if (!skipMatrixUpdate) {
                    // ⚡ OPTIMIZATION: Eliminate CPU overhead and garbage collection spikes from Matrix4 composition by writing directly to instanceMatrix.array
                    _scratchLocalPos.set(transforms.positions[i*3], transforms.positions[i*3+1], transforms.positions[i*3+2]);
                    _scratchLocalQuat.set(transforms.quaternions[i*4], transforms.quaternions[i*4+1], transforms.quaternions[i*4+2], transforms.quaternions[i*4+3]);
                    _scratchLocalScale.setScalar(transforms.scales[i]);

                    _scratchMatrix.compose(_scratchLocalPos, _scratchLocalQuat, _scratchLocalScale);

                    // World = Parent * Local
                    _scratchMatrix.multiplyMatrices(parentMatrix, _scratchMatrix);

                    _scratchMatrix.toArray(this.mesh.instanceMatrix.array, idx * 16);
                }

                // Update Glow
                this.glowAttribute.setX(idx, targetIntensity);
            }

            if (!skipMatrixUpdate) meshNeedsUpdate = true;
            glowNeedsUpdate = true;
        }

        if (meshNeedsUpdate) this.mesh.instanceMatrix.needsUpdate = true;
        if (glowNeedsUpdate) this.glowAttribute.needsUpdate = true;
    }

    getBerryWorldPosition(group: THREE.Group, index: number, target: THREE.Vector3): THREE.Vector3 {
        // Compute world position for a specific berry in a cluster (0..count-1)
        const transforms = group.userData.initialTransforms;
        if (!transforms) return target;

        _scratchObject3D.position.set(transforms.positions[index*3], transforms.positions[index*3+1], transforms.positions[index*3+2]);
        _scratchMatrix.compose(_scratchObject3D.position, _scratchObject3D.quaternion, _scratchObject3D.scale);
        _scratchMatrix.multiplyMatrices(group.matrixWorld, _scratchMatrix);

        return target.setFromMatrixPosition(_scratchMatrix);
    }
}

export const berryBatcher = BerryBatcher.getInstance();


/**
 * Update global berry scale based on season phase
 * @param {string} phase - Current season phase
 * @param {number} phaseProgress - Progress through the phase (0-1)
 */
export function updateGlobalBerryScale(phase: string, phaseProgress: number): void {
    let targetScaleFactor = 1.0;
    switch (phase) {
        case 'sunset':
            targetScaleFactor = 1.0 + phaseProgress * 0.3; // Plump up
            break;
        case 'dusk':
            targetScaleFactor = 1.3 - phaseProgress * 0.1;
            break;
        case 'deepNight':
            targetScaleFactor = 1.2 - phaseProgress * 0.4; // Shrivel slightly
            break;
        case 'preDawn':
            targetScaleFactor = 0.8 + phaseProgress * 0.2;
            break;
        default:
            targetScaleFactor = 1.0;
    }
    uBerrySeasonScale.value = targetScaleFactor;
}

/**
 * Creates a "Heartbeat Gummy" TSL Material
 * Modified to use attributes instead of uniforms for batching
 */
function createHeartbeatMaterial(): THREE.Material {
    const opts = {
        transmission: 0.6,
        thickness: 0.8,
        roughness: 0.2,
        ior: 1.4,
        subsurfaceStrength: 1.0,
        subsurfaceColor: 0xFF6600 // Default, overridden by color
    };

    // Base color from instanceColor
    const material = CandyPresets.Gummy(0xFF6600, opts);
    // Force use of instanceColor
    material.colorNode = attribute('instanceColor', 'vec3') || color(0xFF6600);

    // 2. Heartbeat Logic (Vertex Displacement)
    const phase = dot(positionWorld, vec3(0.5)).mul(5.0);
    const beatSpeed = float(8.0);
    const heartbeat = sin(uTime.mul(beatSpeed).add(phase)).pow(4.0);
    const kickForce = uAudioLow.mul(0.25);
    const scaleFactor = float(1.0).add(heartbeat.mul(kickForce)).mul(uBerrySeasonScale);
    material.positionNode = positionLocal.mul(scaleFactor);

    // 3. Reactive Glow (Emissive)
    const aGlow = attribute('aGlow', 'float'); // FROM BATCHER
    const baseColor = attribute('instanceColor', 'vec3') || color(0xFF6600);
    const flashColor = color(0xFFFFFF);

    // Mix flash based on heartbeat strength
    const glowColor = baseColor.mix(flashColor, heartbeat.mul(uAudioLow).mul(0.5));

    // Final Intensity
    const totalIntensity = aGlow.add(heartbeat.mul(uAudioLow));

    material.emissiveNode = glowColor.mul(totalIntensity);

    return material;
}

/**
 * Create a cluster of berries/fruits with TSL "Juice"
 */
export function createBerryCluster(options: BerryClusterOptions = {}): THREE.Group {
    const group = new THREE.Group();

    // Register with Batcher
    berryBatcher.register(group, options);

    // Store metadata
    group.userData.isBerry = true;
    group.userData.baseGlow = options.baseGlow || 0.2;
    group.userData.weatherGlow = 0;
    group.userData.glowDecayRate = 0.01;
    group.userData.berryColor = options.color || 0xFF6600;

    // 🎨 Palette: Interaction
    group.userData.interactionText = "🍓 Shake";
    group.userData.onInteract = () => {
        shakeBerriesLoose(group, 1.5);
    };

    return group;
}

/**
 * Update berry glow based on weather and audio
 * Deprecated: Handled by BerryBatcher.update()
 */
export function updateBerryGlow(berryCluster: THREE.Group, weatherIntensity: number, audioData: any): void {
    // No-op, logic moved to BerryBatcher.update
}

export function chargeBerries(berryCluster: THREE.Group, chargeAmount: number): void {
    if (!berryCluster.userData) return;
    berryCluster.userData.weatherGlow = Math.min(
        2.0,
        (berryCluster.userData.weatherGlow || 0) + chargeAmount
    );
}

// Deprecated: No longer used as we use global uniform
export function updateBerrySeasons(berryCluster: THREE.Group, phase: string, phaseProgress: number): void {
    // No-op: handled via uBerrySeasonScale global uniform
}

// --- Falling Berry Particle System ---
let fallingBerryPool: FallingBerry[] = [];
const MAX_FALLING_BERRIES = 50;
let fallingBerryMesh: THREE.InstancedMesh | null = null;
const _scratchColorFalling = new THREE.Color();

// WebGPU Compute Nodes & Buffers
let computeNode: any = null;
let stateBuffer: StorageInstancedBufferAttribute;
let velocityBuffer: StorageInstancedBufferAttribute;
let uDeltaTime = uniform(float(0.016));

export function initFallingBerries(scene: THREE.Scene): void {
    // ⚡ OPTIMIZATION: Use shared geometry via registry (deduplicated)
    const berryGeo = getSphereGeometry(0.06, 16, 16);

    // 1. Storage Buffers for GPU Compute
    // State: xyz = position, w = life
    const stateArray = new Float32Array(MAX_FALLING_BERRIES * 4);
    // Velocity: xyz = velocity, w = scale
    const velArray = new Float32Array(MAX_FALLING_BERRIES * 4);

    for (let i = 0; i < MAX_FALLING_BERRIES; i++) {
        stateArray[i * 4 + 3] = 0; // dead
        velArray[i * 4 + 3] = 0;   // scale 0
    }

    stateBuffer = new StorageInstancedBufferAttribute(stateArray, 4);
    velocityBuffer = new StorageInstancedBufferAttribute(velArray, 4);

    // 2. Material (TSL + Storage Node)
    const uFallingGlow = uniform(float(0.8));
    const opts = {
        transmission: 0.6, roughness: 0.2, ior: 1.4, subsurfaceStrength: 1.0, subsurfaceColor: 0xFF6600
    };
    const material = CandyPresets.Gummy(0xFF6600, opts);

    const sStateNode = storage(stateBuffer, 'vec4', stateBuffer.count);
    const sVelNode = storage(velocityBuffer, 'vec4', velocityBuffer.count);

    const particleState = sStateNode.element(instanceIndex);
    const particleVel = sVelNode.element(instanceIndex);

    const pos = particleState.xyz;
    const scale = particleVel.w;

    material.colorNode = attribute('instanceColor', 'vec3');

    // Simple pulse
    const phase = dot(pos, vec3(0.5)).mul(5.0);
    const heartbeat = sin(uTime.mul(8.0).add(phase)).pow(4.0);
    material.emissiveNode = attribute('instanceColor', 'vec3').mul(uFallingGlow.add(heartbeat.mul(0.3)));

    // Override vertex position calculation
    material.positionNode = positionLocal.mul(scale).add(pos);

    // 3. Compute Shader Logic
    const updateCompute = Fn(() => {
        const idx = instanceIndex;
        const pState = sStateNode.element(idx);
        const pVel = sVelNode.element(idx);

        const currentPos = pState.xyz;
        const life = pState.w;
        const currentVel = pVel.xyz;
        const currentScale = pVel.w;

        If(life.greaterThan(0.0), () => {
            // Physics
            const newVelY = currentVel.y.sub(float(9.8).mul(uDeltaTime));
            const newVel = vec3(currentVel.x, newVelY, currentVel.z);
            const newPos = currentPos.add(newVel.mul(uDeltaTime));

            // Life decay
            const maxAge = float(3.0);
            const newLife = life.sub(uDeltaTime.div(maxAge));

            // Scale logic
            const newScale = newLife; // scale down as it dies

            If(newPos.y.lessThan(0.0).or(newLife.lessThan(0.0)), () => {
                // Kill particle
                pState.assign(vec4(newPos, 0.0));
                pVel.assign(vec4(newVel, 0.0));
            }).Else(() => {
                pState.assign(vec4(newPos, newLife));
                pVel.assign(vec4(newVel, newScale));
            });
        });
    });

    computeNode = updateCompute().compute(MAX_FALLING_BERRIES);

    fallingBerryMesh = new THREE.InstancedMesh(berryGeo, material, MAX_FALLING_BERRIES);
    // Initialize standard instanceMatrix with Identity to prevent rendering issues
    // since we do transformations in TSL
    const m = new THREE.Matrix4();
    m.identity();
    for (let i = 0; i < MAX_FALLING_BERRIES; i++) {
        // ⚡ OPTIMIZATION: Write directly to instanceMatrix array instead of updateMatrix + setMatrixAt
        m.toArray(fallingBerryMesh.instanceMatrix.array, i * 16);
    }
    fallingBerryMesh.instanceMatrix.needsUpdate = true;

    fallingBerryMesh.castShadow = true;
    fallingBerryMesh.receiveShadow = true;
    fallingBerryMesh.name = 'fallingBerries';
    fallingBerryMesh.userData.isFallingBerrySystem = true;

    // CPU Proxy for collisions
    fallingBerryPool = [];
    for (let i = 0; i < MAX_FALLING_BERRIES; i++) {
        fallingBerryMesh.setColorAt(i, _scratchColor.setHex(0xFF6600));

        fallingBerryPool.push({
            active: false,
            age: 0,
            velocity: new THREE.Vector3(),
            position: new THREE.Vector3()
        });
    }
    fallingBerryMesh.instanceColor!.needsUpdate = true;

    scene.add(fallingBerryMesh);
}

export function spawnFallingBerry(position: THREE.Vector3, colorHex: number = 0xFF6600): void {
    if (!fallingBerryMesh) return;

    let index = -1;
    for (let i = 0; i < MAX_FALLING_BERRIES; i++) {
        if (!fallingBerryPool[i].active) {
            index = i;
            break;
        }
    }

    if (index === -1) return;

    const berry = fallingBerryPool[index];

    berry.position.copy(position);
    berry.velocity.set(
        (Math.random() - 0.5) * 2,
        -2 - Math.random() * 3,
        (Math.random() - 0.5) * 2
    );
    berry.active = true;
    berry.age = 0;

    // Sync to GPU Backing Buffer
    const stateArr = stateBuffer.array as Float32Array;
    const velArr = velocityBuffer.array as Float32Array;

    stateArr[index * 4 + 0] = berry.position.x;
    stateArr[index * 4 + 1] = berry.position.y;
    stateArr[index * 4 + 2] = berry.position.z;
    stateArr[index * 4 + 3] = 1.0; // Life starts at 1.0 (maps to 3.0 seconds inside shader via division)

    velArr[index * 4 + 0] = berry.velocity.x;
    velArr[index * 4 + 1] = berry.velocity.y;
    velArr[index * 4 + 2] = berry.velocity.z;
    velArr[index * 4 + 3] = 1.0; // initial scale

    stateBuffer.needsUpdate = true;
    velocityBuffer.needsUpdate = true;

    fallingBerryMesh.setColorAt(index, _scratchColor.setHex(colorHex));
    if (fallingBerryMesh.instanceColor) fallingBerryMesh.instanceColor.needsUpdate = true;
}

export function updateFallingBerries(delta: number, renderer?: any): void {
    if (!fallingBerryMesh) return;

    if (renderer && renderer.compute && computeNode) {
        uDeltaTime.value = delta;
        renderer.compute(computeNode);
    }

    const gravity = -9.8;
    const maxAge = 3.0;

    // Update CPU Proxy for collisions only
    for (let i = 0; i < MAX_FALLING_BERRIES; i++) {
        const berry = fallingBerryPool[i];
        if (!berry.active) continue;

        berry.age += delta;
        berry.velocity.y += gravity * delta;

        berry.position.x += berry.velocity.x * delta;
        berry.position.y += berry.velocity.y * delta;
        berry.position.z += berry.velocity.z * delta;

        if (berry.position.y < 0 || berry.age > maxAge) {
            berry.active = false;
        }
    }
}

export function shakeBerriesLoose(cluster: THREE.Group, intensity: number): void {
    const count = cluster.userData.count || 0;
    // Use Batcher helper to find positions
    for (let i = 0; i < count; i++) {
        if (Math.random() < intensity * 0.02) {
            berryBatcher.getBerryWorldPosition(cluster, i, _scratchWorldPos);
            spawnFallingBerry(_scratchWorldPos, cluster.userData.berryColor || 0xFF6600);
        }
    }
}

export function collectFallingBerries(playerPos: THREE.Vector3, collectRadius: number = 1.0): number {
    if (!fallingBerryMesh) return 0;

    let collected = 0;
    const radiusSq = collectRadius * collectRadius;
    let needsUpdate = false;

    for (let i = 0; i < MAX_FALLING_BERRIES; i++) {
        const berry = fallingBerryPool[i];
        if (!berry.active) continue;

        const distSq = berry.position.distanceToSquared(playerPos);
        if (distSq < radiusSq) {
            spawnImpact(berry.position, 'berry');

            if (uChromaticIntensity) {
                uChromaticIntensity.value += 0.3;
                if (uChromaticIntensity.value > 1.0) uChromaticIntensity.value = 1.0;
            }

            berry.active = false;

            // Update GPU buffer to kill it
            const stateArr = stateBuffer.array as Float32Array;
            stateArr[i * 4 + 3] = 0.0; // Set life to 0

            const velArr = velocityBuffer.array as Float32Array;
            velArr[i * 4 + 3] = 0.0; // Set scale to 0

            needsUpdate = true;
            collected++;
        }
    }

    if (needsUpdate) {
        stateBuffer.needsUpdate = true;
        velocityBuffer.needsUpdate = true;
    }

    return collected;
}
