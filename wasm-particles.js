import * as THREE from 'three';

export class WasmParticleSystem {
    constructor(count, scene) {
        this.count = count;
        this.scene = scene;
        this.isReady = false;
        this.usingFallback = false;

        // 8 floats per particle: x, y, z, life, vx, vy, vz, speed
        this.floatsPerParticle = 8;
        this.byteSize = count * this.floatsPerParticle * 4;

        // Arrays for fallback or sync
        this.positions = new Float32Array(this.count * 3);
        
        this.initWasm();
    }

    async initWasm() {
        try {
            // 1. Mock WASI imports
            const wasiImports = {
                fd_write: () => 0,
                fd_close: () => 0,
                fd_seek: () => 0,
                proc_exit: (code) => console.log('WASM exit:', code),
                random_get: (bufPtr, bufLen) => {
                    if (this.memory) {
                        const mem = new Uint8Array(this.memory.buffer);
                        for (let i = 0; i < bufLen; i++) {
                            mem[bufPtr + i] = Math.floor(Math.random() * 256);
                        }
                    }
                    return 0;
                }
            };

            // 2. Load WASM
            const wasmPath = 'build/optimized.wasm'; 
            console.log(`Fetching WASM from: ${wasmPath}`);
            
            const response = await fetch(wasmPath);
            if (!response.ok) throw new Error(`Status ${response.status}`);
            const buffer = await response.arrayBuffer();

            // 3. Instantiate
            const { instance } = await WebAssembly.instantiate(buffer, {
                env: {
                    emscripten_notify_memory_growth: (idx) => this.updateViews(),
                    abort: () => console.error("WASM Aborted"),
                    seed: () => Math.random() 
                },
                wasi_snapshot_preview1: wasiImports
            });

            this.wasm = instance.exports;
            
            // 4. Function Detection
            this.updateFn = this.wasm._updateParticles || this.wasm.updateParticles;
            this.initFn = this.wasm._initParticles || this.wasm.initParticles;
            this.checkCollisionFn = this.wasm._checkCollision || this.wasm.checkCollision;
            this.seedFn = this.wasm._seedRandom || this.wasm.seedRandom;

            if (!this.updateFn) {
                console.warn("⚠️ WASM loaded but 'updateParticles' export missing. Using JS fallback.");
                this.usingFallback = true;
                this.initParticlesJS();
                this.createMesh();
                this.isReady = true;
                return;
            }

            // 5. Memory Setup
            this.memory = this.wasm.memory;
            const heapBase = this.wasm.__heap_base?.value || 1024;
            this.ptr = heapBase;

            const pagesNeeded = Math.ceil((this.ptr + this.byteSize) / 65536);
            if (this.memory.buffer.byteLength < (this.ptr + this.byteSize)) {
                this.memory.grow(pagesNeeded);
            }
            
            // 6. Initialize in WASM
            if (this.seedFn) this.seedFn(Date.now());
            if (this.initFn) this.initFn(this.ptr, this.count);

            this.createMesh();
            this.isReady = true;
            console.log("✅ WASM Particle System initialized");

        } catch (e) {
            console.warn("⚠️ WASM Init failed (" + e.message + "). Switching to JS fallback.");
            this.usingFallback = true;
            this.initParticlesJS();
            this.createMesh();
            this.isReady = true;
        }
    }

    updateViews() {
        // Optional: Handle memory resizing logic here
    }

    // Fallback JS Physics Implementation
    initParticlesJS() {
        // Create a local buffer if we are in fallback mode
        if (!this.fallbackBuffer) {
            this.fallbackBuffer = new Float32Array(this.count * this.floatsPerParticle);
        }
        
        const f32 = this.fallbackBuffer;
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

    updateJS(dt) {
        if (!this.fallbackBuffer) return;
        const f32 = this.fallbackBuffer;
        
        for (let i = 0; i < this.count; i++) {
            let offset = i * this.floatsPerParticle;
            
            let px = f32[offset];
            let py = f32[offset + 1];
            let pz = f32[offset + 2];
            let life = f32[offset + 3];
            let vx = f32[offset + 4];
            let vy = f32[offset + 5];
            let vz = f32[offset + 6];
            let speed = f32[offset + 7];

            // Update
            vy -= 2.0 * dt; // Gravity
            px += vx * dt * speed;
            py += vy * dt * speed;
            pz += vz * dt * speed;
            life -= dt * 0.2;

            // Reset if dead
            if (life <= 0.0) {
                py = 10.0;
                life = 1.0;
                vy = 2.0;
                px = (Math.random() - 0.5) * 5.0;
                pz = (Math.random() - 0.5) * 5.0;
                vx = (Math.random() - 0.5) * 2.0;
                vz = (Math.random() - 0.5) * 2.0;
            }

            // Write back
            f32[offset] = px;
            f32[offset + 1] = py;
            f32[offset + 2] = pz;
            f32[offset + 3] = life;
            f32[offset + 4] = vx;
            f32[offset + 5] = vy;
            f32[offset + 6] = vz;
            
            // Sync to rendering buffer
            const pIdx = i * 3;
            this.positions[pIdx] = px;
            this.positions[pIdx + 1] = py;
            this.positions[pIdx + 2] = pz;
        }
    }

    createMesh() {
        const geometry = new THREE.BufferGeometry();
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

    checkCollision(playerX, playerZ, radius) {
        // Fallback or WASM collision logic could go here
        // For visual particles, collision is often skipped or simplified
    }

    update(deltaTime) {
        if (!this.isReady) return;

        if (this.usingFallback) {
            this.updateJS(deltaTime);
            this.mesh.geometry.attributes.position.needsUpdate = true;
            return;
        }

        // WASM Update Path
        if (this.updateFn && this.memory) {
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
}
