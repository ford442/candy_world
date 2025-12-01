// filepath: g:\github\candy_world\compute-shaders.js
import * as THREE from 'three';
import { storage, uniform, vec3, vec4, float, uint, instanceIndex, cos, sin, time, length as lengthNode } from 'three/tsl';
import { StorageBufferNode, StorageInstancedBufferAttribute } from 'three/webgpu';

/**
 * Compute Shader Infrastructure for Candy World
 * Provides GPU-accelerated procedural generation and particle simulation
 */

// --- Particle System Compute Shader ---
export class ComputeParticleSystem {
    constructor(count, renderer) {
        this.count = count;
        this.renderer = renderer;

        // Storage buffers for particle data
        this.positionBuffer = new Float32Array(count * 4); // xyz + life
        this.velocityBuffer = new Float32Array(count * 4); // xyz + speed
        this.colorBuffer = new Float32Array(count * 4); // rgba

        // Initialize particles
        this.initParticles();

        // Create storage buffer nodes
        this.positionStorage = storage(new StorageInstancedBufferAttribute(this.positionBuffer, 4), 'vec4', this.count);
        this.velocityStorage = storage(new StorageInstancedBufferAttribute(this.velocityBuffer, 4), 'vec4', this.count);
        this.colorStorage = storage(new StorageInstancedBufferAttribute(this.colorBuffer, 4), 'vec4', this.count);

        // Uniforms
        this.uTime = uniform(0.0);
        this.uDeltaTime = uniform(0.016);
        this.uGravity = uniform(vec3(0, -0.5, 0));
        this.uSpawnCenter = uniform(vec3(0, 0, 0));
        this.uAudioPulse = uniform(0.0);

        this.setupComputeShader();
    }

    initParticles() {
        for (let i = 0; i < this.count; i++) {
            const i4 = i * 4;
            // Random positions
            this.positionBuffer[i4] = (Math.random() - 0.5) * 10;
            this.positionBuffer[i4 + 1] = Math.random() * 5;
            this.positionBuffer[i4 + 2] = (Math.random() - 0.5) * 10;
            this.positionBuffer[i4 + 3] = Math.random(); // life (0-1)

            // Random velocities
            this.velocityBuffer[i4] = (Math.random() - 0.5) * 2;
            this.velocityBuffer[i4 + 1] = Math.random() * 3;
            this.velocityBuffer[i4 + 2] = (Math.random() - 0.5) * 2;
            this.velocityBuffer[i4 + 3] = 1.0 + Math.random(); // speed multiplier

            // Random colors (pastel)
            this.colorBuffer[i4] = 0.7 + Math.random() * 0.3;
            this.colorBuffer[i4 + 1] = 0.7 + Math.random() * 0.3;
            this.colorBuffer[i4 + 2] = 0.7 + Math.random() * 0.3;
            this.colorBuffer[i4 + 3] = 1.0; // alpha
        }
    }

    setupComputeShader() {
        // TSL Compute Shader Logic
        // This updates particle positions based on velocity, gravity, and lifecycle
        const idx = instanceIndex;

        // Read current state
        const position = this.positionStorage.element(idx);
        const velocity = this.velocityStorage.element(idx);
        const color = this.colorStorage.element(idx);

        // Update logic (will be implemented in compute node)
        // For now, create compute function structure
        this.computeNode = () => {
            // Update velocity with gravity
            const newVelocityY = velocity.y.add(this.uGravity.y.mul(this.uDeltaTime));
            const newVelocity = vec4(velocity.x, newVelocityY, velocity.z, velocity.w);

            // Update position
            const newX = position.x.add(newVelocity.x.mul(this.uDeltaTime).mul(newVelocity.w));
            const newY = position.y.add(newVelocity.y.mul(this.uDeltaTime).mul(newVelocity.w));
            const newZ = position.z.add(newVelocity.z.mul(this.uDeltaTime).mul(newVelocity.w));

            // Update life
            const newLife = position.w.sub(this.uDeltaTime.mul(0.1));

            // Reset if dead
            const isDead = newLife.lessThan(0.0);
            const respawnX = this.uSpawnCenter.x.add((Math.random() - 0.5) * 5);
            const respawnY = this.uSpawnCenter.y.add(Math.random() * 2);
            const respawnZ = this.uSpawnCenter.z.add((Math.random() - 0.5) * 5);

            // Store updates (this is pseudocode - actual implementation needs compute pass)
            // this.positionStorage.element(idx).assign(vec4(finalX, finalY, finalZ, finalLife));
            // this.velocityStorage.element(idx).assign(newVelocity);
        };
    }

    update(deltaTime, audioState = {}) {
        this.uDeltaTime.value = deltaTime;
        this.uTime.value += deltaTime;
        this.uAudioPulse.value = audioState.kick || 0;

        // CPU fallback for now (will be replaced by actual compute shader)
        this.updateCPU(deltaTime, audioState);
    }

    updateCPU(deltaTime, audioState) {
        const gravity = -0.5;
        const audioPulse = audioState.kick || 0;

        for (let i = 0; i < this.count; i++) {
            const i4 = i * 4;

            // Update velocity with gravity
            this.velocityBuffer[i4 + 1] += gravity * deltaTime;

            // Update position
            const speed = this.velocityBuffer[i4 + 3];
            this.positionBuffer[i4] += this.velocityBuffer[i4] * deltaTime * speed;
            this.positionBuffer[i4 + 1] += this.velocityBuffer[i4 + 1] * deltaTime * speed;
            this.positionBuffer[i4 + 2] += this.velocityBuffer[i4 + 2] * deltaTime * speed;

            // Update life
            this.positionBuffer[i4 + 3] -= deltaTime * 0.2 * (1 + audioPulse * 0.5);

            // Reset if dead
            if (this.positionBuffer[i4 + 3] <= 0) {
                const spawnX = this.uSpawnCenter.value.x || 0;
                const spawnY = this.uSpawnCenter.value.y || 5;
                const spawnZ = this.uSpawnCenter.value.z || 0;

                this.positionBuffer[i4] = spawnX + (Math.random() - 0.5) * 5;
                this.positionBuffer[i4 + 1] = spawnY + Math.random() * 2;
                this.positionBuffer[i4 + 2] = spawnZ + (Math.random() - 0.5) * 5;
                this.positionBuffer[i4 + 3] = 1.0;

                this.velocityBuffer[i4] = (Math.random() - 0.5) * 2;
                this.velocityBuffer[i4 + 1] = Math.random() * 3 + 1;
                this.velocityBuffer[i4 + 2] = (Math.random() - 0.5) * 2;
            }

            // Update color alpha based on life
            this.colorBuffer[i4 + 3] = this.positionBuffer[i4 + 3];
        }
    }

    createMesh() {
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(this.positionBuffer, 4));
        geometry.setAttribute('color', new THREE.BufferAttribute(this.colorBuffer, 4));

        const material = new THREE.PointsMaterial({
            size: 0.3,
            vertexColors: true,
            transparent: true,
            opacity: 0.8,
            blending: THREE.AdditiveBlending,
            depthWrite: false
        });

        const mesh = new THREE.Points(geometry, material);
        return mesh;
    }
}

// --- Procedural Noise Generator ---
export class ProceduralNoiseCompute {
    constructor(width, height) {
        this.width = width;
        this.height = height;
        this.data = new Float32Array(width * height * 4); // RGBA

        this.uTime = uniform(0.0);
        this.uScale = uniform(1.0);
        this.uOctaves = uniform(4);
    }

    // Simple noise function (Perlin-like)
    noise2D(x, y) {
        const X = Math.floor(x) & 255;
        const Y = Math.floor(y) & 255;

        x -= Math.floor(x);
        y -= Math.floor(y);

        const u = x * x * (3 - 2 * x);
        const v = y * y * (3 - 2 * y);

        // Simplified hash
        const a = this.hash(X, Y);
        const b = this.hash(X + 1, Y);
        const c = this.hash(X, Y + 1);
        const d = this.hash(X + 1, Y + 1);

        return this.lerp(v,
            this.lerp(u, a, b),
            this.lerp(u, c, d)
        );
    }

    hash(x, y) {
        const n = x * 374761393 + y * 668265263;
        return ((n ^ (n >> 13)) & 0x7fffffff) / 0x7fffffff;
    }

    lerp(t, a, b) {
        return a + t * (b - a);
    }

    // Multi-octave noise
    fbm(x, y, octaves) {
        let value = 0;
        let amplitude = 0.5;
        let frequency = 1.0;

        for (let i = 0; i < octaves; i++) {
            value += amplitude * this.noise2D(x * frequency, y * frequency);
            frequency *= 2.0;
            amplitude *= 0.5;
        }

        return value;
    }

    generate() {
        const scale = this.uScale.value || 1.0;
        const octaves = this.uOctaves.value || 4;

        for (let y = 0; y < this.height; y++) {
            for (let x = 0; x < this.width; x++) {
                const i = (y * this.width + x) * 4;

                const nx = x / this.width * scale;
                const ny = y / this.height * scale;

                const noise = this.fbm(nx, ny, octaves);

                // Create candy swirl pattern
                const swirl = Math.sin(nx * 10 + noise * 3) * 0.5 + 0.5;
                const r = noise * 0.5 + swirl * 0.5;
                const g = noise * 0.7 + (1 - swirl) * 0.3;
                const b = noise * 0.3 + swirl * 0.7;

                this.data[i] = r;
                this.data[i + 1] = g;
                this.data[i + 2] = b;
                this.data[i + 3] = 1.0;
            }
        }
    }

    createTexture() {
        this.generate();

        const texture = new THREE.DataTexture(
            this.data,
            this.width,
            this.height,
            THREE.RGBAFormat,
            THREE.FloatType
        );
        texture.needsUpdate = true;
        texture.wrapS = THREE.RepeatWrapping;
        texture.wrapT = THREE.RepeatWrapping;

        return texture;
    }
}

// --- Mesh Deformation System ---
export class MeshDeformationCompute {
    constructor(geometry, type = 'wave') {
        this.geometry = geometry;
        this.type = type;
        this.originalPositions = geometry.attributes.position.array.slice();

        this.uTime = uniform(0.0);
        this.uStrength = uniform(1.0);
        this.uFrequency = uniform(1.0);
        this.uAudioPulse = uniform(0.0);
    }

    update(time, audioState = {}) {
        this.uTime.value = time;
        this.uAudioPulse.value = audioState.kick || 0;

        const positions = this.geometry.attributes.position.array;
        const strength = this.uStrength.value;
        const frequency = this.uFrequency.value;
        const audioPulse = audioState.kick || 0;

        for (let i = 0; i < positions.length; i += 3) {
            const x = this.originalPositions[i];
            const y = this.originalPositions[i + 1];
            const z = this.originalPositions[i + 2];

            if (this.type === 'wave') {
                // Wave deformation
                const wave = Math.sin(x * frequency + time * 2) * Math.cos(z * frequency + time * 2);
                positions[i + 1] = y + wave * strength * (1 + audioPulse * 0.5);
            } else if (this.type === 'jiggle') {
                // Jiggle deformation (mushrooms)
                const offset = Math.sin(time * 5 + y * 2) * strength * 0.1;
                positions[i] = x + offset * (1 + audioPulse);
                positions[i + 2] = z + offset * Math.cos(time * 5 + y * 2) * (1 + audioPulse);
            } else if (this.type === 'wobble') {
                // Wobble deformation (trees)
                const wobble = Math.sin(time * 2 + y * 0.5) * strength * 0.05;
                positions[i] = x + wobble * (y / 5) * (1 + audioPulse * 0.3);
            }
        }

        this.geometry.attributes.position.needsUpdate = true;
        this.geometry.computeVertexNormals();
    }
}
