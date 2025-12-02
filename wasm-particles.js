import * as THREE from 'three';

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
            // 1. Define minimal WASI imports to satisfy Emscripten
            // Emscripten binaries often expect these for libc support (even if unused)
            const wasiImports = {
                fd_write: () => 0,
                fd_close: () => 0,
                fd_seek: () => 0,
                proc_exit: (code) => console.log('WASM exit:', code),
                random_get: (bufPtr, bufLen) => {
                    // Fill buffer with random bytes if requested
                    const mem = new Uint8Array(this.memory.buffer);
                    for (let i = 0; i < bufLen; i++) {
                        mem[bufPtr + i] = Math.floor(Math.random() * 256);
                    }
                    return 0;
                }
            };

            // 2. Load the WASM
            const response = await fetch('./assets/optimized.wasm');
            const buffer = await response.arrayBuffer();

            // 3. Instantiate with imports
            const { instance } = await WebAssembly.instantiate(buffer, {
                env: {
                    // Emscripten might need these depending on optimization level
                    emscripten_notify_memory_growth: (idx) => {
                        console.log('WASM memory grew');
                        this.updateViews(); // Re-create typed arrays on resize
                    },
                    abort: () => console.error("WASM Aborted"),
                },
                wasi_snapshot_preview1: wasiImports // <--- The missing piece causing your crash
            });

            this.wasm = instance.exports;
            
            // 4. Handle Memory (Emscripten usually exports 'memory')
            this.memory = this.wasm.memory;
            this.updateViews();

            // 5. Get Function Pointers (Emscripten adds '_' prefix)
            this.updateFn = this.wasm._updateParticles; 
            
            // Allocate memory in WASM heap (simple bump allocation or use malloc if exported)
            // Since we compiled with STANDALONE, we might not have full malloc. 
            // We'll place our data at the end of the static data area (often __heap_base).
            const heapBase = this.wasm.__heap_base?.value || 1024;
            this.ptr = heapBase;

            // Grow memory if needed
            const pagesNeeded = Math.ceil((this.ptr + this.byteSize) / 65536);
            if (this.memory.buffer.byteLength < (this.ptr + this.byteSize)) {
                this.memory.grow(pagesNeeded);
                this.updateViews();
            }

            this.initParticles();
            this.createMesh();

            this.isReady = true;
            console.log("WASM Particle System Initialized (Emscripten Mode)");

        } catch (e) {
            console.error("Failed to init WASM:", e);
        }
    }

    // Helper to refresh views when memory grows
    updateViews() {
        // No-op if you re-create views every frame, but good practice
    }

    initParticles() {
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
        // this.mesh.position.set(20, 0, 0); // Remove offset if not needed
        this.scene.add(this.mesh);
    }

    update(deltaTime) {
        if (!this.isReady) return;

        // Call the C++ function (note the underscore!)
        this.updateFn(this.ptr, this.count, deltaTime);

        // Copy data back to Three.js
        // Be careful: memory.buffer might have detached if grown, so access it fresh
        const wasmFloats = new Float32Array(this.memory.buffer, this.ptr, this.count * this.floatsPerParticle);

        for (let i = 0; i < this.count; i++) {
            const wIdx = i * this.floatsPerParticle;
            const pIdx = i * 3;

            this.positions[pIdx] = wasmFloats[wIdx];
            this.positions[pIdx+1] = wasmFloats[wIdx+1];
            this.positions[pIdx+2] = wasmFloats[wIdx+2];
        }

        this.mesh.geometry.attributes.position.needsUpdate = true;
    }
}
