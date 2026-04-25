import * as THREE from 'three';
import {
    createClayMaterial,
    uGlitchIntensity,
    uTime,
    uAudioLow
} from '../foliage/index.ts';
import { applyGlitch } from '../foliage/glitch.ts';
import { uChromaticIntensity } from '../foliage/chromatic.ts';
import { spawnImpact } from '../foliage/impacts.ts';
import { unlockSystem } from '../systems/unlocks.ts';
import { positionLocal, uv, float, sin, cos, vec3, uniform, attribute, vec4, vec2, step, mix, smoothstep } from 'three/tsl';

const MAX_MINES = 50;
const _scratchMatrix = new THREE.Matrix4();
const MINE_RADIUS = 0.5;
const TRIGGER_RADIUS = 2.0;
const COOLDOWN = 1.0;

// ⚡ OPTIMIZATION: Shared scratch variables to avoid GC in animation loops
const _scratchDummy = new THREE.Object3D();

// Type Definition for Pool Object
interface Mine {
    active: boolean;
    visible: boolean;
    position: THREE.Vector3;
    rotation: THREE.Euler; // Store rotation state
    scale: number;        // Store scale state
    time: number;
}

class JitterMineSystem {
    mesh: THREE.InstancedMesh;
    mines: Mine[];
    cooldownTimer: number;
    trauma: number;

    // TSL GPU specific buffers
    spawnBuffer: THREE.InstancedBufferAttribute; // x,y,z: position, w: spawnTime
    stateBuffer: THREE.InstancedBufferAttribute; // x: active(1) or hidden(0), y,z,w: random rotation axis
    computeNode: null = null; // Removed, using vertex shader instead

    constructor() {
        this.mines = [];
        this.cooldownTimer = 0;
        this.trauma = 0;

        const geometry = new THREE.IcosahedronGeometry(MINE_RADIUS, 0);

        // Initialize attributes
        const initialSpawns = new Float32Array(MAX_MINES * 4);
        const initialStates = new Float32Array(MAX_MINES * 4);

        for (let i = 0; i < MAX_MINES; i++) {
            initialSpawns[i * 4 + 1] = -9999.0; // Hide initially by moving down
            initialStates[i * 4] = 0.0; // inactive

            // Random rotation axis
            const rx = Math.random() - 0.5;
            const ry = Math.random() - 0.5;
            const rz = Math.random() - 0.5;
            const len = Math.sqrt(rx*rx + ry*ry + rz*rz);
            initialStates[i * 4 + 1] = rx / len;
            initialStates[i * 4 + 2] = ry / len;
            initialStates[i * 4 + 3] = rz / len;
        }

        this.spawnBuffer = new THREE.InstancedBufferAttribute(initialSpawns, 4);
        this.spawnBuffer.setUsage(THREE.DynamicDrawUsage);
        geometry.setAttribute('aSpawn', this.spawnBuffer);

        this.stateBuffer = new THREE.InstancedBufferAttribute(initialStates, 4);
        this.stateBuffer.setUsage(THREE.DynamicDrawUsage);
        geometry.setAttribute('aState', this.stateBuffer);

        // Create Glitchy Material
        const baseGlitch = applyGlitch(uv(), positionLocal, float(0.2).add(sin(uTime.mul(10.0)).mul(0.1)));

        const material = createClayMaterial(0xFF00FF, {
            roughness: 0.2,
            metalness: 0.8,
            emissive: 0xFF00FF,
            emissiveIntensity: 0.8,
            bumpStrength: 0.5,
            noiseScale: 20.0
        });

        // 2. Vertex Shader logic (Stateless GPU Animation)
        const aSpawn = attribute('aSpawn', 'vec4');
        const aState = attribute('aState', 'vec4');

        const spawnPos = aSpawn.xyz;
        const spawnTime = aSpawn.w;
        const isActive = aState.x;
        const rotAxis = vec3(aState.y, aState.z, aState.w);

        const age = uTime.sub(spawnTime);

        // Pulse scale
        const pulse = float(1.0).add(sin(age.mul(10.0)).mul(0.1));
        const finalScale = pulse.mul(isActive);

        // 🎨 PALETTE: Audio-Reactive Squash & Stretch (Heartbeat/Jelly feel)
        // High impact on kick drum (uAudioLow)
        const beatSquash = smoothstep(0.2, 0.8, uAudioLow).pow(float(1.5)).mul(0.4); // Max 40% squash

        // Squash Y axis down, bulge X/Z axes out
        const scaleY = float(1.0).sub(beatSquash);
        const scaleXZ = float(1.0).add(beatSquash.mul(0.5));
        const audioScale = vec3(scaleXZ, scaleY, scaleXZ);

        const scaledPos = baseGlitch.position.mul(audioScale).mul(finalScale);

        // Rotate around random axis
        const angle = age.mul(2.0); // Rotation speed
        const c = cos(angle);
        const s = sin(angle);
        const t = float(1.0).sub(c);

        const x = rotAxis.x;
        const y = rotAxis.y;
        const z = rotAxis.z;

        // Custom Rodrigues' rotation formula
        const rx = scaledPos.x.mul(t.mul(x).mul(x).add(c))
            .add(scaledPos.y.mul(t.mul(x).mul(y).sub(s.mul(z))))
            .add(scaledPos.z.mul(t.mul(x).mul(z).add(s.mul(y))));

        const ry = scaledPos.x.mul(t.mul(x).mul(y).add(s.mul(z)))
            .add(scaledPos.y.mul(t.mul(y).mul(y).add(c)))
            .add(scaledPos.z.mul(t.mul(y).mul(z).sub(s.mul(x))));

        const rz = scaledPos.x.mul(t.mul(x).mul(z).sub(s.mul(y)))
            .add(scaledPos.y.mul(t.mul(y).mul(z).add(s.mul(x))))
            .add(scaledPos.z.mul(t.mul(z).mul(z).add(c)));

        const rotatedPos = vec3(rx, ry, rz);

        // Position in world
        material.positionNode = rotatedPos.add(spawnPos);

        this.mesh = new THREE.InstancedMesh(geometry, material, MAX_MINES);
        this.mesh.count = MAX_MINES;
        this.mesh.castShadow = true;
        this.mesh.receiveShadow = true;

        for (let i = 0; i < MAX_MINES; i++) {
            this.mines.push({
                active: false,
                visible: false,
                position: new THREE.Vector3(),
                rotation: new THREE.Euler(),
                scale: 0,
                time: 0
            });
            // ⚡ OPTIMIZATION: Instance matrix acts purely as an identity transform.
            // Translation, rotation, and scaling are handled entirely by the TSL material node.
            _scratchDummy.position.set(0,0,0);
            _scratchDummy.scale.setScalar(1);
            _scratchDummy.rotation.set(0,0,0);
            _scratchMatrix.compose(_scratchDummy.position, _scratchDummy.quaternion, _scratchDummy.scale);
            // ⚡ OPTIMIZATION: Write directly to instanceMatrix array instead of updateMatrix + setMatrixAt
            _scratchMatrix.toArray(this.mesh.instanceMatrix.array, (i) * 16);
        }
    }

    spawnMine(position: THREE.Vector3) {
        if (!unlockSystem.isUnlocked('jitter_mines')) {
            return;
        }

        if (this.cooldownTimer > 0) return;

        // Find free slot
        let index = this.mines.findIndex(m => !m.active);

        // If pool full, recycle oldest
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

        // Update Instance Attributes
        const spawnArray = this.spawnBuffer.array as Float32Array;
        spawnArray[index * 4] = position.x;
        spawnArray[index * 4 + 1] = position.y;
        spawnArray[index * 4 + 2] = position.z;
        // uTime is global from common.ts. We pass current time
        spawnArray[index * 4 + 3] = ((uTime as any).value !== undefined) ? (uTime as any).value : performance.now() / 1000;
        this.spawnBuffer.needsUpdate = true;

        const stateArray = this.stateBuffer.array as Float32Array;
        stateArray[index * 4] = 1.0; // active
        this.stateBuffer.needsUpdate = true;

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

        for (let i = 0; i < MAX_MINES; i++) {
            const mine = this.mines[i];

            if (!mine.active) continue;

            // Update CPU-side time tracking (used for recycling oldest if full)
            mine.time += delta;

            // Proximity Check
            const distSq = mine.position.distanceToSquared(playerPos);
            if (distSq < TRIGGER_RADIUS * TRIGGER_RADIUS) {
                this.explode(i);
            }
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

        mine.active = false;
        mine.visible = false;

        // Hide on GPU
        const stateArray = this.stateBuffer.array as Float32Array;
        stateArray[index * 4] = 0.0; // inactive (scale 0)
        this.stateBuffer.needsUpdate = true;

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

// Lazy init to avoid TSL initialization order issues
let _jitterMineSystem: JitterMineSystem | null = null;

export const jitterMineSystem = new Proxy({} as JitterMineSystem, {
    get: (target, prop) => {
        if (!_jitterMineSystem) {
            _jitterMineSystem = new JitterMineSystem();
        }
        return (_jitterMineSystem as any)[prop];
    },
    set: (target, prop, value) => {
        if (!_jitterMineSystem) {
            _jitterMineSystem = new JitterMineSystem();
        }
        (_jitterMineSystem as any)[prop] = value;
        return true;
    }
});
