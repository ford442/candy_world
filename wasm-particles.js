import * as THREE from 'three';

/**
 * WasmParticleSystem
 * Bridges JavaScript/Three.js with AssemblyScript/WASM for high-performance physics on CPU.
 */
export class WasmParticleSystem {
    constructor(count, scene) {
        this.count = count;
        this.scene = scene;
        this.isReady = false;

        // 8 floats per particle: x, y, z, life, vx, vy, vz, speed
        this.floatsPerParticle = 8;
        this.byteSize = count * this.floatsPerParticle * 4;

        this.initWasm();
    }

    async initWasm() {
        try {
            // Load the WASM module
            const response = await fetch('./assets/optimized.wasm');
            const buffer = await response.arrayBuffer();

            // Create memory - AssemblyScript needs to import 'env' usually, but for simple stuff minimal is ok
            const memory = new WebAssembly.Memory({ initial: 10 }); // 1 page = 64KB

            const imports = {
                env: {
                    memory: memory,
                    abort: (msg, file, line, col) => console.error(`WASM Abort: ${msg} ${file}:${line}:${col}`),
                    seed: () => Math.random()
                },
                Math: Math // Give WASM access to JS Math if needed (depends on ASC build)
            };

            const module = await WebAssembly.instantiate(buffer, imports);
            this.wasm = module.instance.exports;
            this.memory = this.wasm.memory || memory;

            // Allocate memory pointer in WASM heap
            // For simplicity, we just use offset 0 or whatever strict malloc was provided,
            // but since we compiled with standard ASC, we might not have a full allocator.
            // We'll treat memory starting at offset 1024 as ours.
            this.ptr = 1024;

            // Need to grow memory if not enough
            const pagesNeeded = Math.ceil((this.ptr + this.byteSize) / 65536);
            if (this.memory.buffer.byteLength < pagesNeeded * 65536) {
                this.memory.grow(pagesNeeded - (this.memory.buffer.byteLength / 65536));
            }

            // Initial init of particles in JS (or could do in WASM)
            this.initParticles();

            // Create Mesh
            this.createMesh();

            this.isReady = true;
            console.log("WASM Particle System Initialized");
        } catch (e) {
            console.error("Failed to init WASM:", e);
        }
    }

    initParticles() {
        const f32 = new Float32Array(this.memory.buffer, this.ptr, this.count * this.floatsPerParticle);
        for (let i = 0; i < this.count; i++) {
            const idx = i * this.floatsPerParticle;
            f32[idx] = (Math.random() - 0.5) * 10;     // x
            f32[idx + 1] = 10 + Math.random() * 10;    // y
            f32[idx + 2] = (Math.random() - 0.5) * 10; // z
            f32[idx + 3] = Math.random();              // life

            f32[idx + 4] = (Math.random() - 0.5) * 2;  // vx
            f32[idx + 5] = Math.random() * 2;          // vy
            f32[idx + 6] = (Math.random() - 0.5) * 2;  // vz
            f32[idx + 7] = 1.0 + Math.random();        // speed
        }
    }

    createMesh() {
        const geometry = new THREE.BufferGeometry();

        // We will update this buffer every frame from WASM memory
        this.positions = new Float32Array(this.count * 3);
        // Colors/Life could be another attribute
        this.life = new Float32Array(this.count);

        geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
        geometry.setAttribute('alpha', new THREE.BufferAttribute(this.life, 1));

        const material = new THREE.PointsMaterial({
            color: 0x00FFFF, // Cyan for WASM
            size: 0.2,
            transparent: true,
            opacity: 0.8,
            blending: THREE.AdditiveBlending,
            depthWrite: false
        });

        // Hook up opacity to alpha attribute if possible, or just standard
        // Standard PointsMaterial doesn't use custom attributes easily without onBeforeCompile.
        // Let's use TSL or just simple opacity.
        // For simplicity, just standard material for now.

        this.mesh = new THREE.Points(geometry, material);
        this.mesh.position.set(20, 0, 0); // Offset to side
        this.scene.add(this.mesh);
    }

    update(deltaTime) {
        if (!this.isReady) return;

        // Call WASM Update
        this.wasm.updateParticles(this.ptr, this.count, deltaTime);

        // Copy data back to Three.js attributes
        // (Ideally we'd use the WASM buffer directly as the attribute buffer, but threading/safety...)
        // We act as the bridge.
        const wasmFloats = new Float32Array(this.memory.buffer, this.ptr, this.count * this.floatsPerParticle);

        for (let i = 0; i < this.count; i++) {
            const wIdx = i * this.floatsPerParticle;
            const pIdx = i * 3;

            this.positions[pIdx] = wasmFloats[wIdx];
            this.positions[pIdx+1] = wasmFloats[wIdx+1];
            this.positions[pIdx+2] = wasmFloats[wIdx+2];
            // Life is at wIdx + 3
        }

        this.mesh.geometry.attributes.position.needsUpdate = true;
    }
}
