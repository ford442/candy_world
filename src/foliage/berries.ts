import * as THREE from 'three';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import {
    color, float, uniform, vec3, positionLocal, positionWorld,
    sin, dot, time, attribute, Node, UniformNode, ShaderNodeObject
} from 'three/tsl';
import { CandyPresets, uAudioLow, uTime } from './common.ts';
import { spawnImpact } from './impacts.js';
import { uChromaticIntensity } from './chromatic.js';

// Define StorageBufferAttribute locally if it's missing from types or not exported
// In this case, we use `attribute` helper from TSL which returns a Node.
// FIX: Make instanceColor lazy to avoid "attribute not found" warning at module load
let _instanceColorNode: Node | null = null;
function getInstanceColorNode(): Node {
    if (!_instanceColorNode) {
        try {
            _instanceColorNode = attribute('instanceColor', 'vec3');
        } catch (e) {
            // Fallback to white if attribute doesn't exist
            _instanceColorNode = vec3(1.0, 1.0, 1.0);
        }
    }
    return _instanceColorNode;
}

// --- Reusable Scratch Variables ---
const _scratchWorldPos = new THREE.Vector3();
const _scratchMatrix = new THREE.Matrix4();
const _scratchObject3D = new THREE.Object3D();

// ⚡ OPTIMIZATION: Global uniform for seasonal berry scaling
// This replaces per-instance matrix updates on the CPU
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
    berryMesh: THREE.InstancedMesh;
    berries: null; // Legacy
    count: number;
    baseGlow: number;
    weatherGlow: number;
    glowDecayRate: number;
    berryColor: number;
    uClusterGlow: ShaderNodeObject<UniformNode<number>>;
}

export interface FallingBerry {
    active: boolean;
    age: number;
    velocity: THREE.Vector3;
    position: THREE.Vector3;
}

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
 * @param {number|Node} colorInput - Base color (Hex or Node like instanceColor)
 * @param {UniformNode} uGlowIntensity - Control uniform for external updates (weather/seasons)
 * @returns {MeshStandardNodeMaterial}
 */
function createHeartbeatMaterial(colorInput: number | ShaderNodeObject<Node>, uGlowIntensity: ShaderNodeObject<UniformNode<number>>): MeshStandardNodeMaterial {
    let material: MeshStandardNodeMaterial;
    const isNode = (typeof colorInput !== 'number');

    // 1. Base Gummy Material (Translucent, SSS)
    if (!isNode) {
        // Instanced Color path
        material = CandyPresets.Gummy(0xFF6600, {
            colorNode: colorInput as ShaderNodeObject<Node>,
            transmission: 0.6,
            thickness: 0.8,
            roughness: 0.2,
            ior: 1.4,
            subsurfaceStrength: 1.0,
            subsurfaceColor: 0xFF6600 // Fallback SSS color
        });
    } else {
        material = CandyPresets.Gummy(colorInput as number, {
            transmission: 0.6,
            thickness: 0.8,
            roughness: 0.2,
            ior: 1.4,
            subsurfaceStrength: 1.0, // Very juicy
            subsurfaceColor: colorInput as number
        });
    }

    // 2. Heartbeat Logic (Vertex Displacement)
    // Calculate a unique phase based on world position so berries don't pulse in unison
    // We use a small coefficient so nearby berries are somewhat synced but not identical
    const phase = dot(positionWorld, vec3(0.5)).mul(5.0);

    // Heartbeat shape: sharper attack than a pure sine wave
    // sin(t)^4 gives a nice thump-thump
    const beatSpeed = float(8.0); // Fast beat
    const heartbeat = sin(uTime.mul(beatSpeed).add(phase)).pow(4.0);

    // Expansion factor: Base 1.0 + Audio Kick * Pulse
    // uAudioLow is 0..1 based on Kick Drum analysis
    const kickForce = uAudioLow.mul(0.25); // Max 25% expansion

    // ⚡ OPTIMIZATION: Multiply by global season scale here
    const scaleFactor = float(1.0).add(heartbeat.mul(kickForce)).mul(uBerrySeasonScale);

    // Apply to vertex position (inflate from center)
    material.positionNode = positionLocal.mul(scaleFactor);

    // 3. Reactive Glow (Emissive)
    // Base Glow (Weather/DayNight) + Kick Flash
    const baseColor = isNode ? (colorInput as ShaderNodeObject<Node>) : color(colorInput as number);
    const flashColor = color(0xFFFFFF); // Flash white/bright on strong beats

    // Mix flash based on heartbeat strength
    const glowColor = (baseColor as any).mix(flashColor, heartbeat.mul(uAudioLow).mul(0.5));

    // Final Intensity
    const totalIntensity = uGlowIntensity.add(heartbeat.mul(uAudioLow));

    material.emissiveNode = glowColor.mul(totalIntensity);

    return material;
}

/**
 * Create a cluster of berries/fruits with TSL "Juice"
 */
export function createBerryCluster(options: BerryClusterOptions = {}): THREE.Group {
    const count = options.count || 5;
    const colorHex = options.color || 0xFF6600;
    const baseGlow = options.baseGlow || 0.2;
    const size = options.size || 0.08;
    const shape = options.shape || 'sphere';

    const group = new THREE.Group();

    // Setup Geometry
    let geometry: THREE.BufferGeometry;
    if (shape === 'pear') {
        geometry = new THREE.SphereGeometry(size, 16, 16); // Increased polycount for smooth deformation
        geometry.scale(0.8, 1.3, 0.8);
    } else {
        geometry = new THREE.SphereGeometry(size, 24, 24); // Smooth for refraction
    }

    // Setup TSL Material with Cluster-Specific Uniform
    // We create one uniform per cluster to allow individual weather/season control
    const uClusterGlow = uniform(float(baseGlow));
    const material = createHeartbeatMaterial(colorHex, uClusterGlow);

    // ⚡ OPTIMIZATION: Use InstancedMesh instead of individual Meshes
    // Reduced draw calls from N to 1 per cluster.
    const mesh = new THREE.InstancedMesh(geometry, material, count);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.castShadow = true;
    mesh.receiveShadow = true;

    // Store transform data for later updates (seasons, etc)
    const initialTransforms: BerryClusterUserData['initialTransforms'] = {
        positions: [],
        quaternions: [],
        scales: []
    };

    for (let i = 0; i < count; i++) {
        const phi = Math.acos(2 * (i / count) - 1);
        const theta = Math.PI * (1 + Math.sqrt(5)) * i;
        const radius = 0.12;

        const px = radius * Math.sin(phi) * Math.cos(theta);
        const py = radius * Math.sin(phi) * Math.sin(theta) * 0.6;
        const pz = radius * Math.cos(phi);

        const sizeVar = 0.8 + Math.random() * 0.4;

        _scratchObject3D.position.set(px, py, pz);
        _scratchObject3D.scale.setScalar(sizeVar);
        _scratchObject3D.rotation.set(
            Math.random() * Math.PI,
            Math.random() * Math.PI,
            Math.random() * Math.PI
        );
        _scratchObject3D.updateMatrix();

        mesh.setMatrixAt(i, _scratchObject3D.matrix);

        // Store initial data
        initialTransforms.positions.push(px, py, pz);
        initialTransforms.quaternions.push(
            _scratchObject3D.quaternion.x,
            _scratchObject3D.quaternion.y,
            _scratchObject3D.quaternion.z,
            _scratchObject3D.quaternion.w
        );
        initialTransforms.scales.push(sizeVar);
    }

    mesh.userData.initialTransforms = initialTransforms;
    mesh.userData.isBerry = true; // Tag for raycasting (if needed)

    group.add(mesh);

    // Store data for systems
    group.userData.berryMesh = mesh; // New way to access
    group.userData.berries = null;   // Explicitly nullify to catch legacy usage errors

    // Store metadata
    group.userData.count = count;
    group.userData.baseGlow = baseGlow;
    group.userData.weatherGlow = 0;
    group.userData.glowDecayRate = 0.01;
    group.userData.berryColor = colorHex;

    // 🎨 Palette: Interaction
    group.userData.interactionText = "🍓 Shake";
    group.userData.onInteract = () => {
        shakeBerriesLoose(group, 1.5); // Strong shake!
    };

    // Store the control uniform so we can update it later
    group.userData.uClusterGlow = uClusterGlow;

    return group;
}

/**
 * Update berry glow based on weather and audio
 * Optimized: Updates a single uniform value instead of looping over materials
 */
export function updateBerryGlow(berryCluster: THREE.Group, weatherIntensity: number, audioData: any): void {
    if (!berryCluster.userData.uClusterGlow) return;

    // Decay weather glow
    if (berryCluster.userData.weatherGlow > 0) {
        berryCluster.userData.weatherGlow -= berryCluster.userData.glowDecayRate;
        if (berryCluster.userData.weatherGlow < 0) berryCluster.userData.weatherGlow = 0;
    }

    // Calculate target intensity
    // Note: Audio pulse is now handled in TSL (GPU), so we just handle the base "Ambient" level here.
    const groove = audioData?.grooveAmount || 0;
    const baseGlow = berryCluster.userData.baseGlow;
    const weatherGlow = berryCluster.userData.weatherGlow + weatherIntensity; // Rain makes them glow

    // Add a bit of groove to the baseline intensity (breathing base)
    const targetIntensity = baseGlow + weatherGlow + (groove * 0.2);

    // Update the TSL Uniform
    berryCluster.userData.uClusterGlow.value = targetIntensity;
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
const _scratchColor = new THREE.Color();

export function initFallingBerries(scene: THREE.Scene): void {
    // ⚡ OPTIMIZATION: Use InstancedMesh (Draw Call: 50 -> 1)

    const berryGeo = new THREE.SphereGeometry(0.06, 16, 16);

    // Create a TSL material for falling berries with Instance Color support
    const uFallingGlow = uniform(float(0.8)); // Bright when falling
    const material = createHeartbeatMaterial(getInstanceColorNode(), uFallingGlow);

    fallingBerryMesh = new THREE.InstancedMesh(berryGeo, material, MAX_FALLING_BERRIES);
    fallingBerryMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    fallingBerryMesh.castShadow = true;
    fallingBerryMesh.receiveShadow = true;
    fallingBerryMesh.name = 'fallingBerries';

    // Initialize pool and instances
    const dummy = new THREE.Object3D();
    dummy.scale.setScalar(0); // Hidden by default
    dummy.updateMatrix();

    fallingBerryPool = [];

    for (let i = 0; i < MAX_FALLING_BERRIES; i++) {
        fallingBerryMesh.setMatrixAt(i, dummy.matrix);
        fallingBerryMesh.setColorAt(i, _scratchColor.setHex(0xFF6600));

        // Logic Object (Struct-like)
        fallingBerryPool.push({
            active: false,
            age: 0,
            velocity: new THREE.Vector3(),
            position: new THREE.Vector3()
        });
    }

    scene.add(fallingBerryMesh);
}

export function spawnFallingBerry(position: THREE.Vector3, colorHex: number = 0xFF6600): void {
    if (!fallingBerryMesh) return;

    // ⚡ OPTIMIZATION: Loop prevents closure allocation from .find()
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

    // Update Instance
    _scratchObject3D.position.copy(position);
    _scratchObject3D.scale.setScalar(1.0);
    _scratchObject3D.updateMatrix();

    fallingBerryMesh.setMatrixAt(index, _scratchObject3D.matrix);
    fallingBerryMesh.setColorAt(index, _scratchColor.setHex(colorHex));

    fallingBerryMesh.instanceMatrix.needsUpdate = true;
    if (fallingBerryMesh.instanceColor) fallingBerryMesh.instanceColor.needsUpdate = true;
}

export function updateFallingBerries(delta: number): void {
    if (!fallingBerryMesh) return;

    const gravity = -9.8;
    const maxAge = 3.0;
    let needsUpdate = false;

    // ⚡ OPTIMIZATION: For loop prevents closure allocation
    for (let i = 0; i < MAX_FALLING_BERRIES; i++) {
        const berry = fallingBerryPool[i];
        if (!berry.active) continue;

        berry.age += delta;
        berry.velocity.y += gravity * delta;

        berry.position.x += berry.velocity.x * delta;
        berry.position.y += berry.velocity.y * delta;
        berry.position.z += berry.velocity.z * delta;

        const lifeLeft = 1.0 - (berry.age / maxAge);

        if (berry.position.y < 0 || berry.age > maxAge) {
            berry.active = false;
            // Hide
            _scratchObject3D.scale.setScalar(0);
        } else {
             _scratchObject3D.position.copy(berry.position);
             _scratchObject3D.scale.setScalar(lifeLeft);
        }

        _scratchObject3D.updateMatrix();
        fallingBerryMesh.setMatrixAt(i, _scratchObject3D.matrix);
        needsUpdate = true;
    }

    if (needsUpdate) {
        fallingBerryMesh.instanceMatrix.needsUpdate = true;
    }
}

export function shakeBerriesLoose(cluster: THREE.Group, intensity: number): void {
    // ⚡ OPTIMIZATION: Updated for InstancedMesh
    const mesh = cluster.userData.berryMesh as THREE.InstancedMesh;
    if (!mesh) return;

    const count = mesh.count;

    for (let i = 0; i < count; i++) {
        if (Math.random() < intensity * 0.02) {
            // Compute World Position of the berry
            // WorldPos = ClusterWorldMatrix * BerryLocalMatrix
            mesh.getMatrixAt(i, _scratchMatrix);
            _scratchMatrix.premultiply(cluster.matrixWorld);
            _scratchWorldPos.setFromMatrixPosition(_scratchMatrix);

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
            // 🎨 Palette: Visual "Juice" for collection
            spawnImpact(berry.position, 'berry');

            // Screen Shake / Pop (Visual only)
            if (uChromaticIntensity) {
                // Add a quick chromatic pulse (decay handled in main loop)
                uChromaticIntensity.value += 0.3;
                // Clamp to prevent visual chaos
                if (uChromaticIntensity.value > 1.0) uChromaticIntensity.value = 1.0;
            }

            berry.active = false;

            // Hide instance
            _scratchObject3D.position.copy(berry.position);
            _scratchObject3D.scale.setScalar(0);
            _scratchObject3D.updateMatrix();
            fallingBerryMesh.setMatrixAt(i, _scratchObject3D.matrix);

            needsUpdate = true;
            collected++;
        }
    }

    if (needsUpdate) {
        fallingBerryMesh.instanceMatrix.needsUpdate = true;
    }

    return collected;
}
