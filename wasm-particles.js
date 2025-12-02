import * as THREE from 'three'; // Ensure Vite treats this as a URL to the asset import wasmUrl from './build/optimized.wasm?url';

export class WasmParticleSystem { constructor(count, scene) { this.count = count; this.scene = scene; this.isReady = false;

    // 8 floats per particle: x, y, z, life, vx, vy, vz, speed
    this.floatsPerParticle = 8;
    this.byteSize = count * this.floatsPerParticle * 4;

    this.initWasm();
}

async initWasm() {
    try {
        // 1. Define minimal WASI imports (AssemblyScript might use these for some stdlib features)
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

        // 2. Define environment imports (AssemblyScript needs Math.random often)
        const envImports = {
            emscripten_notify_memory_growth: (idx) => {
                this.updateViews();
            },
            abort: () => console.error("WASM Aborted"),
            // AssemblyScript Math.random() often maps to this
            "Math.random": () => Math.random(), 
            seed: () => Date.now()
        };

        // 3. Load the WASM
        const response = await fetch(wasmUrl);
        const buffer = await response.arrayBuffer();

        // 4. Instantiate
        const { instance } = await WebAssembly.instantiate(buffer, {
            env: envImports,
            wasi_snapshot_preview1: wasiImports 
        });

        this.wasm = instance.exports;
        this.memory = this.wasm.memory;
        
        // 5. Get Function Pointers - FIX: Use 'updateParticles' (AssemblyScript default)
        // We check both just in case compilation settings change
        this.updateFn = this.wasm.updateParticles || this.wasm._updateParticles;
        
        if (!this.updateFn) {
            console.error("❌ CRITICAL: 'updateParticles' function not found in WASM exports!", Object.keys(this.wasm));
            return;
        }
        
        // Allocate memory in WASM heap
        // Use __heap_base if exported, or a safe offset
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
        console.log("✅ WASM Particle System Initialized");

    } catch (e) {
        console.error("Failed to init WASM:", e);
    }
}

updateViews() {
    // Refresh views if memory grows (optional for this simple case)
}

initParticles() {
    const f32 = new Float32Array(this.memory.buffer, this.ptr, this.count * this.floatsPerParticle);
    for (let i = 0; i < this.count; i++) {
        const idx = i * this.floatsPerParticle;
        f32[idx] = (Math.random() - 0.5) * 50;     
        f32[idx + 1] = Math.random() * 20;         
        f32[idx + 2] = (Math.random() - 0.5) * 50; 
        f32[idx + 3] = Math.random();              
        f32[idx + 4] = (Math.random() - 0.5) * 2;  
        f32[idx + 5] = Math.random() * 5;          
        f32[idx + 6] = (Math.random() - 0.5) * 2;  
        f32[idx + 7] = 1.0 + Math.random();        
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
    if (!this.isReady) return;

    this.updateFn(this.ptr, this.count, deltaTime);

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
