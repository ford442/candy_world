import * as THREE from 'three';
// Use Vite's ?init pattern to bundle the C++ WASM correctly
import wasmInit from './build/physics.wasm?init';

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
            console.log('Initializing C++ WASM particles via Vite loader...');
            
            // Emscripten Standalone WASM exports its memory.
            // We do NOT create memory here. We let the module provide it.
            
            // Note: Emscripten generated WASM often expects 'env' imports even if standalone,
            // but usually for syscalls. For a pure computation module with -s STANDALONE_WASM,
            // it shouldn't need much.
            // However, we pass an empty env or basic mocks just in case.
            const imports = {
                env: {
                    emscripten_notify_memory_growth: (idx) => {
                        console.log('WASM Memory grew at index ' + idx);
                    }
                }
            };

            const instance = await wasmInit(imports);
            
            // Access exports from the instance
            this.wasm = instance.exports || instance;
            
            // Use the memory exported by the C++ module
            this.memory = this.wasm.memory;
            
            // Debug Exports
            const exportNames = Object.keys(this.wasm).filter(key => typeof this.wasm[key] === 'function');
            console.log("✅ C++ WASM Particles Loaded. Function Exports:", exportNames);

            // Function Detection (Emscripten usually prefixes with _)
            this.updateFn = this.wasm._updateParticles || this.wasm.updateParticles;
            this.malloc = this.wasm._malloc || this.wasm.malloc; // If we need to allocate
            this.free = this.wasm._free || this.wasm.free;

            if (!this.updateFn) {
                console.error("❌ CRITICAL: 'updateParticles' function not found in WASM exports!");
                return;
            }

            // Memory Setup
            // Since we are using C++, we should ideally use malloc to get a safe pointer.
            // But if we want to keep it simple and just use an offset, we need to know where the heap starts.
            // Emscripten exports `__heap_base` usually.

            if (this.malloc) {
                this.ptr = this.malloc(this.byteSize);
                console.log(`📦 Allocated ${this.byteSize} bytes via malloc at ${this.ptr}`);
            } else {
                 // Fallback if malloc isn't exported (though we should export it)
                 // Use a safe offset (e.g. after stack).
                 this.ptr = this.wasm.__heap_base ? this.wasm.__heap_base.value : 1024;
                 console.log(`📦 Using manual offset at ${this.ptr}`);
            }

            // Ensure memory is large enough (Emscripten usually handles this if we use malloc, but if we go OOB or manual...)
            if (this.memory.buffer.byteLength < this.ptr + this.byteSize) {
                this.memory.grow(Math.ceil((this.ptr + this.byteSize - this.memory.buffer.byteLength) / 65536));
            }

            console.log(`📦 WASM Memory: ${this.memory.buffer.byteLength} bytes, particle buffer at offset ${this.ptr}`);
            
            this.initParticles();
            this.createMesh();
            this.isReady = true;

        } catch (e) {
            console.error("Failed to init C++ WASM particles:", e);
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
            // Note: If memory grew, the buffer is detached, so we must re-create the view
            const f32 = new Float32Array(this.memory.buffer, this.ptr, this.count * this.floatsPerParticle);

            for (let i = 0; i < this.count; i++) {
                const wIdx = i * this.floatsPerParticle;
                const pIdx = i * 3;
                this.positions[pIdx] = f32[wIdx];
                this.positions[pIdx+1] = f32[wIdx+1];
                this.positions[pIdx+2] = f32[wIdx+2];
            }
            this.mesh.geometry.attributes.position.needsUpdate = true;
        } catch (e) {
            console.error('WASM particle update error:', e);
            this.isReady = false; // Stop further updates on error
        }
    }
}
