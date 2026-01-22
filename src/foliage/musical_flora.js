import * as THREE from 'three';
import { 
    createClayMaterial, 
    createCandyMaterial, 
    registerReactiveMaterial, 
    attachReactivity,
    foliageMaterials,
    uTime,
    uGlitchIntensity
} from './common.js';
import {
    color, float, uniform, vec3, positionLocal, sin, cos, mix, uv
} from 'three/tsl';
import { applyGlitch } from './glitch.js';
import { arpeggioFernBatcher } from './arpeggio-batcher.ts';
import { dandelionBatcher } from './dandelion-batcher.ts';
import { portamentoPineBatcher } from './portamento-batcher.ts';

// --- Category 1: Melodic Flora ---

export function createArpeggioFern(options = {}) {
    const { color = 0x00FF88, scale = 1.0 } = options;
    const group = new THREE.Group();

    // ⚡ OPTIMIZATION: Logic Object only (visuals are batched)
    // Hit Volume for interaction
    const hitGeo = new THREE.CylinderGeometry(0.5 * scale, 0.5 * scale, 2.0 * scale);
    const hitMat = new THREE.MeshBasicMaterial({ visible: false });
    const hitMesh = new THREE.Mesh(hitGeo, hitMat);
    hitMesh.position.y = 1.0 * scale;
    group.add(hitMesh);

    group.userData.animationType = 'arpeggioUnfurl';
    group.userData.type = 'fern';

    // Register with Batcher
    // We pass the group so the batcher can read position/rotation later if needed (initially set here)
    // Note: The position/rotation of 'group' must be set by the caller (generation.ts)
    // BUT generation.ts sets it AFTER creation.
    // So we can't register immediately with correct transform!

    // Solution: Register a "deferred init" or update batcher when placed.
    // Since generation.ts sets position immediately after creation:
    // obj.position.set(x, y, z);

    // We'll use a onBeforeRender hack or similar? No.
    // We'll expose a `finalize()` method? No standard API.

    // ⚡ HACK: We register a "Placement Callback" or we assume generation sets position and we hook it?
    // Actually, `arpeggioFernBatcher.register` reads position.
    // If position is 0,0,0 at registration, the fern is at 0,0,0.
    // We need to defer registration until it's placed.

    // We can add a method `obj.onPlacement` that `safeAddFoliage` calls?
    // `safeAddFoliage` doesn't call that.

    // Alternative: We create a proxy that registers itself on the first frame of animation/update?
    group.userData.needsRegistration = true;
    group.userData.batchOptions = options;

    // Callback for generation system to invoke after setting position
    group.userData.onPlacement = () => {
        arpeggioFernBatcher.register(group, options);
    };

    // Attach basic reactivity metadata
    attachReactivity(group);

    const interactive = makeInteractive(group);

    // Override interaction handlers to support InstancedMesh updates
    const originalEnter = group.userData.onGazeEnter;
    const originalLeave = group.userData.onGazeLeave;

    group.userData.onGazeEnter = () => {
        if (originalEnter) originalEnter(); // Handles logic state (isHovered)
        // Physical pop handled by updating batcher matrix
        const batchIdx = group.userData.batchIndex;
        if (batchIdx !== undefined) {
             // We need to scale the group (Logic) then update Batcher
             // makeInteractive already scaled the group in originalEnter!
             arpeggioFernBatcher.updateInstance(batchIdx, group);
        }
    };

    group.userData.onGazeLeave = () => {
        if (originalLeave) originalLeave();
        const batchIdx = group.userData.batchIndex;
        if (batchIdx !== undefined) {
             arpeggioFernBatcher.updateInstance(batchIdx, group);
        }
    };

    return interactive;
}

export function createPortamentoPine(options = {}) {
    const { height = 4.0 } = options;
    const group = new THREE.Group();

    // ⚡ OPTIMIZATION: Logic Object only (visuals are batched)
    // Hit Volume for interaction
    // Base height of geometry is 4.0.
    const scaleFactor = height / 4.0;

    // Scale logic object so physics/interaction matches visual size
    group.scale.setScalar(scaleFactor);

    // Hitbox (Cylinder approx)
    const hitGeo = new THREE.CylinderGeometry(0.5, 0.5, 4.0);
    const hitMat = new THREE.MeshBasicMaterial({ visible: false });
    const hitMesh = new THREE.Mesh(hitGeo, hitMat);
    hitMesh.position.y = 2.0; // Center at 2.0 (half of 4.0)
    group.add(hitMesh);

    group.userData.animationType = 'batchedPortamento'; // Batched logic
    group.userData.type = 'tree';

    // Register with Batcher
    group.userData.onPlacement = () => {
        portamentoPineBatcher.register(group, options);
    };

    const interactive = makeInteractive(group);

    // Sync interactions to batched instance
    const originalEnter = group.userData.onGazeEnter;
    const originalLeave = group.userData.onGazeLeave;

    group.userData.onGazeEnter = () => {
        if (originalEnter) originalEnter();
        const batchIdx = group.userData.batchIndex;
        if (batchIdx !== undefined) {
             portamentoPineBatcher.updateInstance(batchIdx, group);
        }
    };

    group.userData.onGazeLeave = () => {
        if (originalLeave) originalLeave();
        const batchIdx = group.userData.batchIndex;
        if (batchIdx !== undefined) {
             portamentoPineBatcher.updateInstance(batchIdx, group);
        }
    };

    return interactive;
}

// --- Category 2: Rhythmic Structures ---

export function createCymbalDandelion(options = {}) {
    const { scale = 1.0 } = options;
    const group = new THREE.Group();

    // ⚡ OPTIMIZATION: Logic Object only (visuals are batched)
    // Hit Volume for interaction
    // Stem Height 1.5, Head at 1.5
    const hitGeo = new THREE.CylinderGeometry(0.2 * scale, 0.2 * scale, 1.8 * scale);
    const hitMat = new THREE.MeshBasicMaterial({ visible: false });
    const hitMesh = new THREE.Mesh(hitGeo, hitMat);
    hitMesh.position.y = 0.9 * scale;
    group.add(hitMesh);

    group.userData.animationType = 'batchedCymbal'; // Use batched type to avoid CPU animation
    group.userData.type = 'flower';

    // Callback for generation system to invoke after setting position
    group.userData.onPlacement = () => {
        dandelionBatcher.register(group, options);
    };

    const reactiveGroup = attachReactivity(group);
    return makeInteractive(reactiveGroup);
}

export function createSnareTrap(options = {}) {
    const { color = 0xFF4500, scale = 1.0 } = options;
    const group = new THREE.Group();

    // Base
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.5, 0.2), createClayMaterial(0x2E2E2E));
    group.add(base);

    // Jaws
    const jawMat = createCandyMaterial(color, 0.5);
    registerReactiveMaterial(jawMat);
    const toothMat = createClayMaterial(0xFFFFFF);

    const leftJaw = new THREE.Group();
    const rightJaw = new THREE.Group();
    
    // Jaw Shape (Half Torus ish)
    const jawGeo = new THREE.TorusGeometry(0.5 * scale, 0.1 * scale, 8, 16, Math.PI);
    
    const meshL = new THREE.Mesh(jawGeo, jawMat);
    meshL.rotation.x = Math.PI / 2;
    leftJaw.add(meshL);

    const meshR = new THREE.Mesh(jawGeo, jawMat);
    meshR.rotation.x = Math.PI / 2;
    rightJaw.add(meshR);

    // Teeth
    for(let i=0; i<5; i++) {
        const t = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.2), toothMat);
        t.position.set((i-2)*0.2, 0, 0.1);
        t.rotation.x = -1.0;
        leftJaw.add(t);
        
        const t2 = t.clone();
        t2.rotation.x = 1.0;
        t2.position.z = -0.1;
        rightJaw.add(t2);
    }

    leftJaw.position.set(0, 0.2, -0.2);
    rightJaw.position.set(0, 0.2, 0.2);
    
    // Default open state
    leftJaw.rotation.x = -0.5;
    rightJaw.rotation.x = 0.5 + Math.PI; // Face opposite

    group.add(leftJaw);
    group.add(rightJaw);

    group.userData.leftJaw = leftJaw;
    group.userData.rightJaw = rightJaw;
    group.userData.animationType = 'snareSnap';
    group.userData.type = 'trap'; // Reacts to snare
    
    const reactiveGroup = attachReactivity(group);
    return makeInteractive(reactiveGroup);
}

// --- Musical Flora Manager (Instancing support) ---

import { batchAnimationCalc, uploadPositions } from '../utils/wasm-loader.js';

/**
 * MANAGER CLASS
 * Handles batch updates for thousands of instanced objects efficiently.
 */
export class MusicalFloraManager {
    constructor() {
        this.systems = new Map(); // Stores registered mesh systems
        this.dummy = new THREE.Object3D();
        this._position = new THREE.Vector3();
        this._quaternion = new THREE.Quaternion();
        this._scale = new THREE.Vector3();
        
        // Performance: Reusable arrays
        this.instanceColors = null; 
    }

    /**
     * Register an InstancedMesh to be animated by WASM
     * @param {string} id - Unique ID (e.g., 'mushrooms')
     * @param {THREE.InstancedMesh} mesh - The mesh
     * @param {Array} initialData - Array of {x, y, z, scale} objects
     */
    register(id, mesh, initialData) {
        if (!mesh || !initialData || initialData.length === 0) return;

        console.log(`[MusicalFlora] Registering system: ${id} (${initialData.length} items)`);

        // Upload initial positions to WASM so it knows where they are
        // Note: If you have multiple systems, we currently share one WASM position buffer.
        // For a complex game, you'd offset them. For now, we'll just upload the active one or
        // you can call uploadPositions() right before animate() for that system.
        uploadPositions(initialData);

        this.systems.set(id, {
            mesh,
            data: initialData,
            count: initialData.length
        });
    }

    /**
     * Main update loop - Call this in your tick/render loop
     */
    update(time, deltaTime, audioState) {
        const kick = audioState?.kickTrigger || 0;
        const intensity = audioState?.energy || 0;

        for (const [id, system] of this.systems) {
            this.animateSystem(system, time, intensity, kick);
        }
    }

    animateSystem(system, time, intensity, kick) {
        const { mesh, count, data } = system;

        // 1. Run Physics/Animation in WASM
        // Returns [yOffset, rotX, rotZ, 0, yOffset, rotX, ...]
        const results = batchAnimationCalc(time, intensity, kick, count);
        
        if (!results) return;

        // 2. Apply results to InstancedMesh
        for (let i = 0; i < count; i++) {
            const base = data[i];
            const idx = i * 4;

            // WASM outputs
            const animY = results[idx];      // Bounce
            const animRotX = results[idx+1]; // Wobble
            const animRotZ = results[idx+2]; // Sway

            // Position (Original + Animation)
            this._position.set(base.x, base.y + animY, base.z);

            // Rotation (Combine base + Animation)
            // Assuming base rotation is 0 for simplicity, or store it in 'data'
            this._quaternion.setFromEuler(new THREE.Euler(
                animRotX, 
                0, // Keep Y rotation fixed or add slow spin
                animRotZ
            ));

            // Scale (React to kick)
            const scalePulse = 1.0 + (kick * 0.2 * intensity);
            const stretch = 1.0 + (animY * 0.5); // Stretch when bouncing up
            
            const s = base.scale || 1.0;
            this._scale.set(
                s * scalePulse, 
                s * stretch, 
                s * scalePulse
            );

            // Compose Matrix
            this.dummy.position.copy(this._position);
            this.dummy.quaternion.copy(this._quaternion);
            this.dummy.scale.copy(this._scale);
            this.dummy.updateMatrix();

            mesh.setMatrixAt(i, this.dummy.matrix);
        }

        mesh.instanceMatrix.needsUpdate = true;
    }
}

// Global instance
export const musicalFlora = new MusicalFloraManager();

/**
 * Adds "Sense" behaviors to a plant Group.
 * Defines reactions for Proximity (Walk near), Gaze (Look at), and Interact (Click).
 */
export function makeInteractive(group) {
    // 1. Setup State
    if (!group.userData.originalScale) group.userData.originalScale = group.scale.clone();
    group.userData.isHovered = false;

    // --- REACTION: PROXIMITY (Walk Near) ---
    // The plant "wakes up" - slight glow or rotation
    group.userData.onProximityEnter = (dist) => {
        // Example: Enable a dim emission so it stands out slightly
        group.traverse(child => {
            if (child.isMesh && child.material) {
                if (child.material.emissive) {
                    child.userData.baseEmissive = child.material.emissive.getHex();
                    // Set a very low base glow to show it's "alive"
                    child.material.emissive.setHex(0x111111);
                }
            }
        });
    };

    group.userData.onProximityLeave = () => {
        // Reset everything
        group.scale.copy(group.userData.originalScale);
        group.traverse(child => {
            if (child.isMesh && child.material && child.material.emissive) {
                // Restore original color (likely black/no emission)
                if (child.userData.baseEmissive !== undefined) {
                    child.material.emissive.setHex(child.userData.baseEmissive);
                }
            }
        });
    };

    // --- REACTION: GAZE (Point Cursor) ---
    // The plant "pops" - gets bigger and brighter
    group.userData.onGazeEnter = () => {
        group.userData.isHovered = true;

        // 1. Physical reaction: Pop up size
        const targetScale = group.userData.originalScale.clone().multiplyScalar(1.2);
        group.scale.copy(targetScale);

        // 2. Visual reaction: Brighten up
        group.traverse(child => {
            if (child.isMesh && child.material && child.material.emissive) {
                child.material.emissiveIntensity = 0.5; // Glow brighter
                child.material.emissive.setHex(0x444444); // White-ish glow
            }
        });
    };

    group.userData.onGazeLeave = () => {
        group.userData.isHovered = false;

        // Reset to "Proximity" state (not "Off", because we are still nearby)
        group.scale.copy(group.userData.originalScale);
         group.traverse(child => {
            if (child.isMesh && child.material && child.material.emissive) {
                child.material.emissiveIntensity = 0.0; // Stop glowing bright
                child.material.emissive.setHex(0x111111); // Return to dim proximity glow
            }
        });
    };

    // --- REACTION: INTERACT (Click) ---
    // The plant performs an action (Spin, Jump, etc)
    group.userData.onInteract = () => {
        console.log("Interacted with:", group.userData.type || "Object");

        // Example: 360 Spin
        const startRot = group.rotation.y;
        const startTime = performance.now();

        // Simple animation loop for the spin (or use a tween library if available)
        const animateSpin = () => {
            const now = performance.now();
            const progress = Math.min((now - startTime) / 500, 1); // 500ms duration

            // Easing (EaseOutQuad)
            const ease = 1 - (1 - progress) * (1 - progress);

            group.rotation.y = startRot + (ease * Math.PI * 2);

            if (progress < 1) {
                requestAnimationFrame(animateSpin);
            } else {
                group.rotation.y = startRot; // Reset exactly
            }
        };
        animateSpin();
    };

    return group;
}
