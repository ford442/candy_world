import * as THREE from 'three';
// Use Vite's ?init pattern to bundle the WASM correctly
import wasmInit from './build/optimized.wasm?init';

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
            // Use Vite's ?init loader which handles WASM bundling correctly
            console.log('Initializing WASM particles via Vite loader...');
            
            // Create memory for the WASM module
            // 5000 particles * 8 floats * 4 bytes = 160KB, plus offset, need at least 3 pages (192KB)
            const memory = new WebAssembly.Memory({ initial: 4, maximum: 256 });
            
            // AssemblyScript requires these env imports
            // Vite's ?init returns a WebAssembly.Instance
            const instance = await wasmInit({
                env: {
                    memory: memory,
                    seed: () => Math.random(),
                    abort: (msg, file, line, col) => console.error(`WASM abort at ${line}:${col}`)
                }
            });
            
            // Access exports from the instance
            this.wasm = instance.exports || instance;
            
            // Use the memory we passed in (also exported by the module)
            this.memory = memory;
            
            // Debug Exports
            const exportNames = Object.keys(this.wasm).filter(key => typeof this.wasm[key] === 'function');
            console.log("✅ WASM Particles Loaded. Function Exports:", exportNames);

            // Smart Function Detection
            this.updateFn = this.wasm.updateParticles || this.wasm._updateParticles;

            if (!this.updateFn) {
                console.error("❌ CRITICAL: 'updateParticles' function not found in WASM exports!");
                console.error("Available Exports:", exportNames);
                console.error("Did you compile 'assembly/index.ts' correctly?");
                return;
            }

            // Memory Setup
            // Use a safe fixed offset (no __heap_base export in simple AS modules)
            this.ptr = 1024;

            // Ensure we have enough memory for particle buffer
            const requiredBytes = this.ptr + this.byteSize;
            const currentBytes = this.memory.buffer.byteLength;
            if (currentBytes < requiredBytes) {
                const pagesNeeded = Math.ceil((requiredBytes - currentBytes) / 65536) + 1;
                try {
                    this.memory.grow(pagesNeeded);
                    console.log(`📦 Grew WASM memory by ${pagesNeeded} pages`);
                } catch(e) {
                    console.error("WASM Memory grow failed:", e);
                }
            }

            console.log(`📦 WASM Memory: ${this.memory.buffer.byteLength} bytes, particle buffer at offset ${this.ptr}`);
            
            this.initParticles();
            this.createMesh();
            this.isReady = true;

        } catch (e) {
            console.error("Failed to init WASM particles:", e);
        }
    }

    initParticles() {
        if (!this.memory) return;
        const f32 = new Float32Array(this.memory.buffer, this.ptr, this.count * this.floatsPerParticle);
        for (let i = 0; i < this.count; i++) {
            const idx = i * this.floatsPerParticle;
            f32[idx] = (Math.random() - 0.5) * 50;     // x
            f32[idx + 1] = Math.random() * 20;         // y
            f32[idx + 2] = (Math.random() - 0.5) * 50; // z
            f32[idx + 3] = Math.random();              // life
            f32[idx + 4] = (Math.random() - 0.5) * 2;  // vx
            f32[idx + 5] = Math.random() * 5;          // vy
            f32[idx + 6] = (Math.random() - 0.5) * 2;  // vz
            f32[idx + 7] = 1.0 + Math.random();        // speed
        }
    }

    createMesh() {
        const geometry = new THREE.BufferGeometry();
        this.positions = new Float32Array(this.count * 3);
        geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));

        const material = new THREE.PointsMaterial({
            color: 0x00FFFF,
            size: 0.2,
            transparent: true,
            opacity: 0.8,
            blending: THREE.AdditiveBlending,
            depthWrite: false
        });

        this.mesh = new THREE.Points(geometry, material);
        this.scene.add(this.mesh);
    }

    update(deltaTime) {
        if (!this.isReady || !this.updateFn || !this.memory) return;
        
        try {
            // Call the WASM update function
            this.updateFn(this.ptr, this.count, deltaTime);

            // Sync with Three.js
            const wasmFloats = new Float32Array(this.memory.buffer, this.ptr, this.count * this.floatsPerParticle);
            for (let i = 0; i < this.count; i++) {
                const wIdx = i * this.floatsPerParticle;
                const pIdx = i * 3;
                this.positions[pIdx] = wasmFloats[wIdx];
                this.positions[pIdx+1] = wasmFloats[wIdx+1];
                this.positions[pIdx+2] = wasmFloats[wIdx+2];
            }
            this.mesh.geometry.attributes.position.needsUpdate = true;
        } catch (e) {
            console.error('WASM particle update error:', e);
            this.isReady = false; // Stop further updates on error
        }
    }
}
