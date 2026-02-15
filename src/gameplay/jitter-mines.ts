import * as THREE from 'three';
import {
    createClayMaterial,
    uGlitchIntensity,
    uTime
} from '../foliage/common.ts';
import { applyGlitch } from '../foliage/glitch.ts';
import { uChromaticIntensity } from '../foliage/chromatic.ts';
import { spawnImpact } from '../foliage/impacts.ts';
import { unlockSystem } from '../systems/unlocks.ts';
import { positionLocal, uv, float, sin, vec3 } from 'three/tsl';

const MAX_MINES = 50;
const MINE_RADIUS = 0.5;
const TRIGGER_RADIUS = 2.0;
const COOLDOWN = 1.0;

class JitterMineSystem {
    mesh: THREE.InstancedMesh;
    mines: any[]; // Using any for pool objects to simplify
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
        this.mesh.count = MAX_MINES; // Always render max, just hide inactive
        this.mesh.castShadow = true;
        this.mesh.receiveShadow = true;

        // Initialize pool
        for (let i = 0; i < MAX_MINES; i++) {
            this.mines.push({
                active: false,
                visible: false,
                position: new THREE.Vector3(),
                time: 0
            });
            // Init to scale 0
            this.dummy.scale.set(0,0,0);
            this.dummy.updateMatrix();
            this.mesh.setMatrixAt(i, this.dummy.matrix);
        }
    }

    spawnMine(position: THREE.Vector3) {
        if (!unlockSystem.isUnlocked('jitter_mines')) {
            return;
        }

        if (this.cooldownTimer > 0) return;

        // Find free slot
        let index = this.mines.findIndex(m => !m.active);

        // If pool full, recycle oldest (first one usually if we push/shift, but here index order)
        // Simple recycle: just pick index 0 if all active? Or random?
        if (index === -1) {
             // Find oldest (largest time)
             let maxTime = -1;
             let oldestIndex = 0;
             for(let i=0; i<MAX_MINES; i++) {
                 if (this.mines[i].time > maxTime) {
                     maxTime = this.mines[i].time;
                     oldestIndex = i;
                 }
             }
             index = oldestIndex;
        }

        const mine = this.mines[index];
        mine.active = true;
        mine.visible = true;
        mine.position.copy(position);
        mine.time = 0;

        // Update Instance
        this.dummy.position.copy(position);
        this.dummy.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, 0);
        this.dummy.scale.setScalar(1.0);
        this.dummy.updateMatrix();
        this.mesh.setMatrixAt(index, this.dummy.matrix);
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
                if (mine.visible) {
                    this.dummy.scale.set(0,0,0);
                    this.dummy.updateMatrix();
                    this.mesh.setMatrixAt(i, this.dummy.matrix);
                    mine.visible = false;
                    needsUpdate = true;
                }
                continue;
            }

            // Get current matrix to check scale/rotation
            this.mesh.getMatrixAt(i, this.dummy.matrix);

            mine.time += delta;

            // Vibrate visuals
            this.dummy.matrix.decompose(this.dummy.position, this.dummy.quaternion, this.dummy.scale);

            const euler = new THREE.Euler().setFromQuaternion(this.dummy.quaternion);
            euler.x += delta * 2.0;
            euler.y += delta * 1.5;
            this.dummy.quaternion.setFromEuler(euler);

            // Pulse scale
            const pulse = 1.0 + Math.sin(mine.time * 10.0) * 0.1;
            this.dummy.scale.setScalar(pulse);

            this.dummy.updateMatrix();
            this.mesh.setMatrixAt(i, this.dummy.matrix);
            // FIX: Set needsUpdate for active mines too!
            // Wait, needsUpdate is a flag for the loop to set instanceMatrix.needsUpdate = true at end.
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
        spawnImpact(mine.position, 'explosion', 0xFF00FF);

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
