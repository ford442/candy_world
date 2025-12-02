import * as THREE from 'three';
import { storage, uniform, vec3, vec4, float, uint, instanceIndex, cos, sin, time, If, Fn, attribute } from 'three/tsl';
import { StorageInstancedBufferAttribute, PointsNodeMaterial } from 'three/webgpu';

/**
 * Compute Shader Infrastructure for Candy World
 * Fully GPU-accelerated particle system
 */

export class ComputeParticleSystem {
    constructor(count, renderer) {
        this.count = count;
        this.renderer = renderer;

        // Storage buffers for particle data
        this.positionBuffer = new Float32Array(count * 4); // xyz + life
        this.velocityBuffer = new Float32Array(count * 4); // xyz + speed
        this.colorBuffer = new Float32Array(count * 4); // rgba

        this.initParticles();

        // FIX: Create attributes explicitly so we can pass them to Geometry
        this.posAttr = new StorageInstancedBufferAttribute(this.positionBuffer, 4);
        this.velAttr = new StorageInstancedBufferAttribute(this.velocityBuffer, 4);
        this.colAttr = new StorageInstancedBufferAttribute(this.colorBuffer, 4);

        // Create storage buffer nodes for Compute
        this.positionStorage = storage(this.posAttr, 'vec4', this.count);
        this.velocityStorage = storage(this.velAttr, 'vec4', this.count);
        this.colorStorage = storage(this.colAttr, 'vec4', this.count);

        // Uniforms
        this.uTime = uniform(0.0);
        this.uDeltaTime = uniform(0.016);
        this.uGravity = uniform(new THREE.Vector3(0, -2.0, 0)); // Stronger gravity
        this.uSpawnCenter = uniform(new THREE.Vector3(0, 5, 0));
        this.uAudioPulse = uniform(0.0);

        this.setupComputeShader();
    }

    initParticles() {
        for (let i = 0; i < this.count; i++) {
            const i4 = i * 4;
            // Spread out initially
            this.positionBuffer[i4] = (Math.random() - 0.5) * 50;
            this.positionBuffer[i4 + 1] = Math.random() * 20;
            this.positionBuffer[i4 + 2] = (Math.random() - 0.5) * 50;
            this.positionBuffer[i4 + 3] = Math.random(); // life

            this.velocityBuffer[i4] = (Math.random() - 0.5) * 2;
            this.velocityBuffer[i4 + 1] = Math.random() * 5;
            this.velocityBuffer[i4 + 2] = (Math.random() - 0.5) * 2;
            this.velocityBuffer[i4 + 3] = 1.0; // speed

            this.colorBuffer[i4] = Math.random(); // Hue
            this.colorBuffer[i4 + 1] = 0.8; // Sat
            this.colorBuffer[i4 + 2] = 0.8; // Light
            this.colorBuffer[i4 + 3] = 1.0; // Alpha
        }
    }

    setupComputeShader() {
        // TSL Compute Logic
        const computeLogic = Fn(() => {
            const idx = instanceIndex;

            // Fetch current
            const posData = this.positionStorage.element(idx);
            const velData = this.velocityStorage.element(idx);

            // We read the current values
            const position = posData.toVar();
            const velocity = velData.toVar();

            // Physics
            const dt = this.uDeltaTime;
            const gravity = this.uGravity.mul(dt);

            // Update Velocity
            velocity.y.addAssign(gravity.y);

            // Audio Boost
            const speed = velocity.w.mul(this.uAudioPulse.mul(2.0).add(1.0));

            // Update Position
            position.x.addAssign(velocity.x.mul(dt).mul(speed));
            position.y.addAssign(velocity.y.mul(dt).mul(speed));
            position.z.addAssign(velocity.z.mul(dt).mul(speed));

            // Age Life
            position.w.subAssign(dt.mul(0.3)); // Decay rate

            // Respawn Logic
            If(position.w.lessThan(0.0), () => {
                // Reset Life
                position.w.assign(1.0);

                // Respawn at center + random spread (simulated by using index as seed)
                const seed = float(idx).mul(0.123);
                const offsetX = sin(seed.mul(12.9898)).mul(10.0);
                const offsetZ = cos(seed.mul(78.233)).mul(10.0);

                position.x.assign(this.uSpawnCenter.x.add(offsetX));
                position.y.assign(this.uSpawnCenter.y);
                position.z.assign(this.uSpawnCenter.z.add(offsetZ));

                // Reset Velocity
                velocity.y.assign(float(5.0).add(cos(seed).mul(2.0))); // Upward burst
                velocity.x.assign(sin(seed).mul(2.0));
                velocity.z.assign(cos(seed).mul(2.0));
            });

            // Write back
            posData.assign(position);
            velData.assign(velocity);
        });

        // Store the compute node to be executed
        this.computeNode = computeLogic().compute(this.count);
    }

    update(deltaTime, audioState = {}) {
        this.uDeltaTime.value = deltaTime;
        this.uTime.value += deltaTime;
        this.uAudioPulse.value = audioState.kick || 0;

        // Execute Compute Shader
        this.renderer.compute(this.computeNode);
    }

    createMesh() {
        const geometry = new THREE.BufferGeometry();
        // FIX: Use the actual attributes, not the storage nodes
        geometry.setAttribute('position', this.posAttr);
        geometry.setAttribute('color', this.colAttr);
        geometry.drawRange.count = this.count;

        const material = new PointsNodeMaterial({
            size: 0.2,
            color: 0xFFFFFF,
            transparent: true,
            opacity: 0.8,
            blending: THREE.AdditiveBlending,
            depthWrite: false
        });

        // FIX: Access data via standard attribute lookup since we bound it to geometry
        const particlePos = attribute('position', 'vec4'); 
        const life = particlePos.w;

        material.positionNode = particlePos.xyz;
        material.sizeNode = float(0.2).mul(life); // Shrink as they die
        material.colorNode = vec4(1.0, 0.5, 0.2, life); // Simple fade

        return new THREE.Points(geometry, material);
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
