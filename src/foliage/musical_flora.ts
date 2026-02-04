import * as THREE from 'three';
import { 
    createClayMaterial, 
    createCandyMaterial, 
    registerReactiveMaterial, 
    attachReactivity
} from './common.ts';

// @ts-ignore
import { batchAnimationCalc, uploadPositions } from '../utils/wasm-loader.js';
import { arpeggioFernBatcher } from './arpeggio-batcher.ts';
import { dandelionBatcher } from './dandelion-batcher.ts';
import { portamentoPineBatcher } from './portamento-batcher.ts';

// Interfaces for options
export interface ArpeggioFernOptions {
    color?: number;
    scale?: number;
}

export interface PortamentoPineOptions {
    height?: number;
}

export interface CymbalDandelionOptions {
    scale?: number;
}

export interface SnareTrapOptions {
    color?: number;
    scale?: number;
}

export interface RetriggerMushroomOptions {
    color?: number;
    scale?: number;
    retriggerSpeed?: number;
}

// Interfaces for internal structures
interface SystemData {
    mesh: THREE.InstancedMesh;
    data: any[];
    count: number;
}

// --- Category 1: Melodic Flora ---

export function createArpeggioFern(options: ArpeggioFernOptions = {}) {
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
    group.userData.interactionText = "Play Arpeggio";

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

export function createPortamentoPine(options: PortamentoPineOptions = {}) {
    const { height = 4.0 } = options;
    const group = new THREE.Group();

    // ⚡ OPTIMIZATION: Logic Object only (visuals are batched)

    // Use pr-281's batched, scaled logic object (keeps visuals instanced) but preserve
    // HEAD's audio/reactivity behaviour so interactions still sound and affect bend state.
    const scaleFactor = height / 4.0;

    // Scale logic object so physics/interaction matches visual size
    group.scale.setScalar(scaleFactor);

    // Hitbox (Cylinder approx)
    const hitGeo = new THREE.CylinderGeometry(0.5 * scaleFactor, 0.5 * scaleFactor, 4.0 * scaleFactor);
    const hitMat = new THREE.MeshBasicMaterial({ visible: false });
    const hitMesh = new THREE.Mesh(hitGeo, hitMat);
    hitMesh.position.y = 2.0 * scaleFactor; // Center at half-height
    group.add(hitMesh);

    group.userData.animationType = 'batchedPortamento'; // Batched logic (matches batcher)
    group.userData.type = 'tree';
    group.userData.interactionText = 'Bend Tree';

    // Reactivity State (kept from HEAD so audio triggers still update logic)
    group.userData.reactivityState = { currentBend: 0, velocity: 0 };

    group.userData.reactToNote = (noteInfo: any) => {
        if (noteInfo.channel === 2 || noteInfo.channel === 3) {
            group.userData.reactivityState.velocity += 15.0 * (noteInfo.velocity || 0.5);
            if ((window as any).AudioSystem && typeof (window as any).AudioSystem.playSound === 'function') {
                const pitch = noteInfo.note ? 1.0 : 0.8 + Math.random() * 0.4;
                (window as any).AudioSystem.playSound('creak', { position: group.position, pitch, volume: 0.3 });
            }
            // Inform the batcher of reactive bend (batcher provides helper)
            const idx = group.userData.batchIndex;
            if (idx !== undefined && portamentoPineBatcher && typeof portamentoPineBatcher.setBendForIndex === 'function') {
                portamentoPineBatcher.setBendForIndex(idx, group.userData.reactivityState.velocity);
            }
        }
    };

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
        if (batchIdx !== undefined) portamentoPineBatcher.updateInstance(batchIdx, group);
    };

    group.userData.onGazeLeave = () => {
        if (originalLeave) originalLeave();
        const batchIdx = group.userData.batchIndex;
        if (batchIdx !== undefined) portamentoPineBatcher.updateInstance(batchIdx, group);
    };

    return interactive;
}

// --- Category 2: Rhythmic Structures ---

export function createCymbalDandelion(options: CymbalDandelionOptions = {}) {
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
    group.userData.interactionText = "Shake Flower";

    // Callback for generation system to invoke after setting position
    group.userData.onPlacement = () => {
        dandelionBatcher.register(group, options);
    };

    const reactiveGroup = attachReactivity(group);
    return makeInteractive(reactiveGroup);
}

export function createSnareTrap(options: SnareTrapOptions = {}) {
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
    group.userData.interactionText = "Trigger Trap";
    
    const reactiveGroup = attachReactivity(group);
    return makeInteractive(reactiveGroup);
}

// --- Category 3: Audio Effect Flora ---

/**
 * Creates a Retrigger Mushroom - a glitchy, audio-reactive mushroom that creates
 * stutter/retrigger effects when interacted with.
 * 
 * Visual: A compact mushroom with a pixelated, glitchy cap that shimmers with
 * retrigger patterns. The cap has concentric ring segments that pulse independently.
 * 
 * Audio Behavior: When activated (by player proximity or kick trigger), it applies
 * a stutter/retrigger effect to the visual representation and triggers a callback
 * that can be used to affect audio playback.
 * 
 * @param {Object} options - Configuration options
 * @param {number} options.color - Cap color (default: 0x00FFFF cyan)
 * @param {number} options.scale - Overall scale (default: 1.0)
 * @param {number} options.retriggerSpeed - Speed of retrigger effect (default: 4)
 * @returns {THREE.Group} The retrigger mushroom group
 */
export function createRetriggerMushroom(options: RetriggerMushroomOptions = {}) {
    const { 
        color: capColor = 0x00FFFF, 
        scale = 1.0,
        retriggerSpeed = 4  // Number of retriggers per beat
    } = options;
    const group = new THREE.Group();

    // Stem - short and chunky for stability
    const stemHeight = 0.4 * scale;
    const stemGeo = new THREE.CylinderGeometry(0.12 * scale, 0.15 * scale, stemHeight, 8);
    stemGeo.translate(0, stemHeight / 2, 0);
    const stemMat = createClayMaterial(0x8B4513);
    const stem = new THREE.Mesh(stemGeo, stemMat);
    stem.castShadow = true;
    group.add(stem);

    // Cap - segmented ring design for retrigger visual effect
    const capRadius = 0.35 * scale;
    const capHeight = 0.15 * scale;
    
    // Main cap dome
    const capGeo = new THREE.SphereGeometry(capRadius, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2);
    capGeo.translate(0, stemHeight, 0);
    
    const capMat = createCandyMaterial(capColor, 0.3);
    registerReactiveMaterial(capMat);
    const cap = new THREE.Mesh(capGeo, capMat);
    cap.castShadow = true;
    group.add(cap);

    // Concentric ring segments (for stutter visual effect)
    const ringCount = 4;
    const rings: THREE.Mesh[] = [];
    for (let i = 0; i < ringCount; i++) {
        const innerR = (capRadius * 0.2) + (capRadius * 0.2 * i);
        const outerR = innerR + (capRadius * 0.15);
        const ringGeo = new THREE.RingGeometry(innerR, outerR, 16);
        ringGeo.rotateX(-Math.PI / 2);
        ringGeo.translate(0, stemHeight + 0.01 + (i * 0.005), 0);
        
        // Alternate colors for visual interest
        const ringColor = i % 2 === 0 ? capColor : 0xFFFFFF;
        const ringMat = createCandyMaterial(ringColor, 0.5);
        registerReactiveMaterial(ringMat);
        
        const ring = new THREE.Mesh(ringGeo, ringMat);
        ring.userData.ringIndex = i;
        ring.userData.baseY = stemHeight + 0.01 + (i * 0.005);
        rings.push(ring);
        group.add(ring);
    }

    // Glitch particles around the mushroom
    const particleCount = 20;
    const particleGeo = new THREE.BufferGeometry();
    const positions = new Float32Array(particleCount * 3);
    const colors = new Float32Array(particleCount * 3);
    
    for (let i = 0; i < particleCount; i++) {
        const angle = (i / particleCount) * Math.PI * 2;
        const radius = capRadius * (0.8 + Math.random() * 0.4);
        positions[i * 3] = Math.cos(angle) * radius;
        positions[i * 3 + 1] = stemHeight + (Math.random() - 0.5) * 0.3;
        positions[i * 3 + 2] = Math.sin(angle) * radius;
        
        // Cyan to white color
        const brightness = 0.5 + Math.random() * 0.5;
        colors[i * 3] = brightness * 0.5;
        colors[i * 3 + 1] = brightness;
        colors[i * 3 + 2] = brightness;
    }
    
    particleGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    particleGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    
    const particleMat = new THREE.PointsMaterial({
        size: 0.05 * scale,
        vertexColors: true,
        transparent: true,
        opacity: 0.6,
        blending: THREE.AdditiveBlending,
        depthWrite: false
    });
    
    const particles = new THREE.Points(particleGeo, particleMat);
    particles.visible = false; // Only visible during retrigger
    group.add(particles);

    // Glow light
    const light = new THREE.PointLight(capColor, 0, 3.0);
    light.position.y = stemHeight;
    group.add(light);

    // Store references for animation
    group.userData.cap = cap;
    group.userData.capMaterial = capMat;
    group.userData.rings = rings;
    group.userData.particles = particles;
    group.userData.light = light;
    group.userData.stemHeight = stemHeight;
    group.userData.retriggerSpeed = retriggerSpeed;
    
    // Retrigger state
    group.userData.retriggerActive = false;
    group.userData.retriggerPhase = 0;
    group.userData.retriggerIntensity = 0;
    
    // Animation type for the animation system
    group.userData.animationType = 'retriggerPulse';
    group.userData.animationOffset = Math.random() * 10;
    group.userData.type = 'retriggerMushroom';
    group.userData.interactionText = "Trigger Retrigger";

    // Interaction callback - called when player interacts
    group.userData.onRetrigger = null; // Can be set externally to trigger audio effects

    const reactiveGroup = attachReactivity(group);
    return makeInteractive(reactiveGroup);
}

// --- Musical Flora Manager (Instancing support) ---

/**
 * MANAGER CLASS
 * Handles batch updates for thousands of instanced objects efficiently.
 */
export class MusicalFloraManager {
    systems: Map<string, SystemData>;
    dummy: THREE.Object3D;
    _position: THREE.Vector3;
    _quaternion: THREE.Quaternion;
    _scale: THREE.Vector3;
    instanceColors: Float32Array | null;

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
    register(id: string, mesh: THREE.InstancedMesh, initialData: any[]) {
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
    update(time: number, deltaTime: number, audioState: any) {
        const kick = audioState?.kickTrigger || 0;
        const intensity = audioState?.energy || 0;

        for (const [id, system] of this.systems) {
            this.animateSystem(system, time, intensity, kick);
        }
    }

    animateSystem(system: SystemData, time: number, intensity: number, kick: number) {
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
export function makeInteractive(group: THREE.Group) {
    // 1. Setup State
    if (!group.userData.originalScale) group.userData.originalScale = group.scale.clone();
    group.userData.isHovered = false;

    // --- REACTION: PROXIMITY (Walk Near) ---
    // The plant "wakes up" - slight glow or rotation
    group.userData.onProximityEnter = (dist: number) => {
        // Example: Enable a dim emission so it stands out slightly
        group.traverse((child: any) => {
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
        group.traverse((child: any) => {
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
        group.traverse((child: any) => {
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
         group.traverse((child: any) => {
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
