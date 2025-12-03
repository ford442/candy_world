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
            // 1. Mock WASI imports (Required for Emscripten binaries)
            const wasiImports = {
                fd_write: () => 0,
                fd_close: () => 0,
                fd_seek: () => 0,
                proc_exit: (code) => console.log('WASM exit:', code),
                random_get: (bufPtr, bufLen) => {
                    const mem = new Uint8Array(this.memory.buffer);
                    for (let i = 0; i < bufLen; i++) {
                        mem[bufPtr + i] = Math.floor(Math.random() * 256);
                    }
                    return 0;
                }
            };

            // 2. Load WASM
            // FIX: We hardcode the path here to match deploy.py output.
            // We append a timestamp to bust the cache and ensure we get the latest binary.
            const wasmPath = `build/optimized.wasm?v=${Date.now()}`;
            console.log(`Fetching WASM from: ${wasmPath}`);
            
            const response = await fetch(wasmPath);
            
            // Debug: Log content type to catch cases where we get HTML (404) instead of WASM
            const contentType = response.headers.get('content-type');
            if (!response.ok || (contentType && contentType.includes('text/html'))) {
                throw new Error(`Failed to fetch WASM: ${response.status} ${response.statusText} (Type: ${contentType})`);
            }
            
            const buffer = await response.arrayBuffer();

            // 3. Instantiate
            const memory = new WebAssembly.Memory({ initial: 100 }); // Pre-allocate enough pages
            const { instance } = await WebAssembly.instantiate(buffer, {
                env: {
                    memory: memory, // Import memory if using --importMemory
                    emscripten_notify_memory_growth: (idx) => this.updateViews(),
                    abort: () => console.error("WASM Aborted"),
                    seed: () => Math.random() // Legacy support for AssemblyScript
                },
                wasi_snapshot_preview1: wasiImports
            });

            this.wasm = instance.exports;
            
            // 4. Debug Exports
            const exports = Object.keys(this.wasm);
            console.log("✅ WASM Loaded. Exports:", exports);

            // 5. Smart Function Detection
            this.updateFn = this.wasm._updateParticles || this.wasm.updateParticles;

            if (!this.updateFn) {
                console.error("❌ CRITICAL: 'updateParticles' function not found in WASM exports!");
                console.error("Available Exports:", exports);
                console.error("Did you compile 'assembly/index.ts' correctly?");
                return;
            }

            // 6. Memory Setup
            this.memory = memory; // Use our imported memory
            // Use heap_base if available, otherwise default to 1024 (start of heap after static data)
            const heapBase = this.wasm.__heap_base?.value || 1024;
            this.ptr = heapBase;

            // Grow memory if needed
            const pagesNeeded = Math.ceil((this.ptr + this.byteSize) / 65536);
            if (this.memory.buffer.byteLength < (this.ptr + this.byteSize)) {
                try {
                    this.memory.grow(pagesNeeded);
                } catch(e) {
                    console.error("WASM Memory grow failed", e);
                }
            }
            
            this.initParticles();
            this.createMesh();
            this.isReady = true;

        } catch (e) {
            console.error("Failed to init WASM:", e);
        }
    }

    updateViews() {
        // Optional: Re-acquire typed arrays if memory grows
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
        if (!this.isReady || !this.updateFn) return;

        // Call the resolved function
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
    }
}
