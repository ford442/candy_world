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
    const { color = 0xCD7F32, height = 4.0 } = options;
    const group = new THREE.Group();

    // Trunk (Segmented for bending)
    const segments = 6;
    const segHeight = height / segments;
    const trunkMat = createClayMaterial(0x8B4513); // Copper-ish
    const needleMat = createCandyMaterial(0x2E8B57, 0.5);

    let currentParent = group;

    for (let i = 0; i < segments; i++) {
        const pivot = new THREE.Group();
        pivot.position.y = (i === 0) ? 0 : segHeight;
        
        const rBot = 0.4 * (1 - i/segments) + 0.1;
        const rTop = 0.4 * (1 - (i+1)/segments) + 0.1;
        
        const geo = new THREE.CylinderGeometry(rTop, rBot, segHeight, 8);
        geo.translate(0, segHeight/2, 0);
        const mesh = new THREE.Mesh(geo, trunkMat);
        
        // Needles
        if (i > 1) {
            const needleCount = 8;
            for(let n=0; n<needleCount; n++) {
                const needle = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.6, 4), needleMat);
                needle.position.y = segHeight * 0.5;
                needle.rotation.y = (n/needleCount) * Math.PI * 2;
                needle.rotation.z = 1.5;
                needle.position.x = rBot;
                mesh.add(needle);
            }
        }

        pivot.add(mesh);
        currentParent.add(pivot);
        currentParent = pivot;
        
        // Store reference to pivots for animation
        if (!group.userData.segments) group.userData.segments = [];
        group.userData.segments.push(pivot);
    }

    group.userData.animationType = 'portamentoBend';
    group.userData.type = 'tree';
    return makeInteractive(group);
}

// --- Category 2: Rhythmic Structures ---

export function createCymbalDandelion(options = {}) {
    const { scale = 1.0 } = options;
    const group = new THREE.Group();

    // Stem
    const stem = new THREE.Mesh(
        new THREE.CylinderGeometry(0.02 * scale, 0.02 * scale, 1.5 * scale),
        createClayMaterial(0x556B2F)
    );
    stem.position.y = 0.75 * scale;
    group.add(stem);

    // Head (The Cymbal Seeds)
    const head = new THREE.Group();
    head.position.y = 1.5 * scale;
    group.add(head);

    const seedCount = 24;
    const seedGeo = new THREE.CylinderGeometry(0.01, 0.01, 0.4 * scale);
    seedGeo.translate(0, 0.2 * scale, 0);
    const tipGeo = new THREE.SphereGeometry(0.04 * scale);
    const seedMat = createCandyMaterial(0xFFD700, 1.0); // Gold
    registerReactiveMaterial(seedMat);

    for(let i=0; i<seedCount; i++) {
        const seedGroup = new THREE.Group();
        const phi = Math.acos(-1 + (2 * i) / seedCount);
        const theta = Math.sqrt(seedCount * Math.PI) * phi;
        
        seedGroup.rotation.setFromVector3(new THREE.Vector3(
            Math.sin(phi) * Math.cos(theta),
            Math.sin(phi) * Math.sin(theta),
            Math.cos(phi)
        ).normalize().multiplyScalar(1.5)); // Direction
        
        seedGroup.lookAt(seedGroup.position.clone().add(new THREE.Vector3(0,1,0))); // Hacky alignment

        const stalk = new THREE.Mesh(seedGeo, createClayMaterial(0xFFFFFF));
        const tip = new THREE.Mesh(tipGeo, seedMat);
        tip.position.y = 0.4 * scale;
        
        stalk.add(tip);
        head.add(stalk);
        
        // Distribute spherically
        stalk.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0), new THREE.Vector3(
             Math.sin(phi) * Math.cos(theta),
             Math.cos(phi),
             Math.sin(phi) * Math.sin(theta)
        ));
    }

    group.userData.animationType = 'cymbalShake'; // Needs high freq trigger
    group.userData.type = 'flower';
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
