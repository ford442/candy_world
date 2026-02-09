import * as THREE from 'three';
import {
    createClayMaterial,
    uGlitchIntensity,
    uTime
} from '../foliage/common.ts';
import { uChromaticIntensity } from '../foliage/chromatic.js';
import { spawnImpact } from '../foliage/impacts.ts';
import { unlockSystem } from '../systems/unlocks.ts';
import { applyGlitch } from '../foliage/glitch.js';
import { positionLocal, uv, float, sin, vec3 } from 'three/tsl';

const MAX_MINES = 50;
const MINE_RADIUS = 0.5;
const TRIGGER_RADIUS = 2.0;
const COOLDOWN = 1.0;

class JitterMineSystem {
    mesh: THREE.InstancedMesh;
    mines: { active: boolean; position: THREE.Vector3; time: number }[];
    dummy: THREE.Object3D;
    cooldownTimer: number;
    trauma: number;

    constructor() {
        this.mines = [];
        this.dummy = new THREE.Object3D();
        this.cooldownTimer = 0;
        this.trauma = 0;

        // Create Geometry (Icosahedron for unstable look)
        const geometry = new THREE.IcosahedronGeometry(MINE_RADIUS, 0);

        // Create Glitchy Material
        // We use TSL to make it look unstable
        // A permanent low-level glitch effect
        const baseGlitch = applyGlitch(uv(), positionLocal, float(0.2).add(sin(uTime.mul(10.0)).mul(0.1)));

        const material = createClayMaterial(0xFF00FF, {
            roughness: 0.2,
            metalness: 0.8,
            emissive: 0xFF00FF,
            emissiveIntensity: 0.8,
            deformationNode: baseGlitch.position,
            bumpStrength: 0.5,
            noiseScale: 20.0
        });

        this.mesh = new THREE.InstancedMesh(geometry, material, MAX_MINES);
        this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        this.mesh.count = 0;
        this.mesh.castShadow = true;
        this.mesh.receiveShadow = true;

        // Initialize pool
        for (let i = 0; i < MAX_MINES; i++) {
            this.mines.push({
                active: false,
                position: new THREE.Vector3(),
                time: 0
            });
        }
    }

    spawnMine(position: THREE.Vector3) {
        if (!unlockSystem.isUnlocked('jitter_mines')) {
            // Optional: Show "Locked" toast?
            return;
        }

        if (this.cooldownTimer > 0) return;

        // Find free slot
        const index = this.mines.findIndex(m => !m.active);
        if (index === -1) {
            // Pool full, maybe recycle oldest?
            // For now, just ignore
            console.warn("JitterMine pool full!");
            return;
        }

        const mine = this.mines[index];
        mine.active = true;
        mine.position.copy(position);
        mine.time = 0;

        // Update Instance
        this.dummy.position.copy(position);
        this.dummy.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, 0);
        this.dummy.scale.setScalar(1.0);
        this.dummy.updateMatrix();
        this.mesh.setMatrixAt(index, this.dummy.matrix);

        // Ensure count covers this index (simple approach: set count to max active index + 1, or just update all valid)
        // Since we might have holes, we should probably keep count at max used index + 1 or just manage visibility by scaling to 0?
        // Better: Swap with last active?
        // Simplest for now: Just set matrix. Three.js renders 0..count.
        // If we have holes, we need to handle them.
        // Strategy: Always render count = MAX_MINES, but hide inactive ones by scaling to 0.
        // Initialize all to scale 0 in constructor?
        // Let's do scale 0 for inactive.

        // Actually, let's just use count = MAX_MINES and set scale 0 for unused.
        this.mesh.count = MAX_MINES;
        this.mesh.instanceMatrix.needsUpdate = true;

        this.cooldownTimer = COOLDOWN;

        // Play sound (if available globally)
        if ((window as any).AudioSystem && (window as any).AudioSystem.playSound) {
             (window as any).AudioSystem.playSound('place', { position: position, pitch: 0.8 });
        }
    }

    update(delta: number, playerPos: THREE.Vector3) {
        if (this.cooldownTimer > 0) {
            this.cooldownTimer -= delta;
        }

        let needsUpdate = false;

        for (let i = 0; i < MAX_MINES; i++) {
            const mine = this.mines[i];
            if (!mine.active) {
                // Ensure hidden
                this.mesh.getMatrixAt(i, this.dummy.matrix);
                // Check if scale is already 0 to avoid unnecessary updates
                const elements = this.dummy.matrix.elements;
                // Scale 0 check (approx)
                if (Math.abs(elements[0]) > 0.001) {
                    this.dummy.scale.set(0,0,0);
                    this.dummy.updateMatrix();
                    this.mesh.setMatrixAt(i, this.dummy.matrix);
                    needsUpdate = true;
                }
                continue;
            }

            mine.time += delta;

            // Vibrate visuals (handled by TSL mostly, but we can add rotation jitter here)
            // Just simple rotation for CPU side
            this.mesh.getMatrixAt(i, this.dummy.matrix);
            this.dummy.matrix.decompose(this.dummy.position, this.dummy.rotation, this.dummy.scale);

            this.dummy.rotation.x += delta * 2.0;
            this.dummy.rotation.y += delta * 1.5;

            // Pulse scale
            const pulse = 1.0 + Math.sin(mine.time * 10.0) * 0.1;
            this.dummy.scale.setScalar(pulse);

            this.dummy.updateMatrix();
            this.mesh.setMatrixAt(i, this.dummy.matrix);
            needsUpdate = true;

            // Proximity Check
            const distSq = mine.position.distanceToSquared(playerPos);
            if (distSq < TRIGGER_RADIUS * TRIGGER_RADIUS) {
                this.explode(i);
                needsUpdate = true;
            }
        }

        if (needsUpdate) {
            this.mesh.instanceMatrix.needsUpdate = true;
        }

        // Handle Trauma Decay and Application
        if (this.trauma > 0) {
            this.trauma -= delta * 2.0; // Decay over ~0.5s
            if (this.trauma < 0) this.trauma = 0;

            // Apply to globals (override/boost audio effects)
            // Note: Gameplay update runs after Audio update in main.js, so this wins for the frame.
            if (uChromaticIntensity) {
                (uChromaticIntensity as any).value = Math.max((uChromaticIntensity as any).value, this.trauma);
            }
            if (uGlitchIntensity) {
                (uGlitchIntensity as any).value = Math.max((uGlitchIntensity as any).value, this.trauma);
            }
        }
    }

    explode(index: number) {
        const mine = this.mines[index];
        if (!mine.active) return;

        mine.active = false; // Will be hidden next update

        // Visuals
        spawnImpact(mine.position, 'explosion', { color: 0xFF00FF });

        // Glitch Effect
        // Trigger screen trauma
        this.trauma = 1.0;

        // Sound
        if ((window as any).AudioSystem && (window as any).AudioSystem.playSound) {
             (window as any).AudioSystem.playSound('explosion', { position: mine.position, pitch: 0.5 + Math.random() * 0.5 });
        }
    }
}

export const jitterMineSystem = new JitterMineSystem();
