import * as THREE from 'three'; import { PointsNodeMaterial } from 'three/webgpu';

export class WasmParticleSystem { constructor(count, scene) { this.count = count; this.scene = scene; this.isReady = false;

    // 8 floats per particle: x, y, z, life, vx, vy, vz, speed
    this.floatsPerParticle = 8;
    this.byteSize = count * this.floatsPerParticle * 4;

    this.initWasm();
}

async initWasm() {
    try {
        const imports = {
            env: {
                abort: () => console.error("WASM Abort"),
                seed: () => Math.random() * Date.now(),
                trace: (msg, n, val) => console.log(`AS Trace: ${msg}`)
            },
            wasi_snapshot_preview1: {
                fd_write: () => 0,
                fd_close: () => 0,
                fd_seek: () => 0,
                proc_exit: (code) => console.log('WASM exit:', code),
                random_get: () => 0
            }
        };

        const wasmPath = 'build/optimized.wasm'; 
        console.log(`Fetching AssemblyScript WASM from: ${wasmPath}`);
        
        const response = await fetch(wasmPath);
        if (!response.ok) throw new Error(`Failed to fetch WASM: ${response.statusText}`);
        const buffer = await response.arrayBuffer();

        const { instance } = await WebAssembly.instantiate(buffer, imports);
        this.wasm = instance.exports;
        this.memory = this.wasm.memory;

        // AssemblyScript memory handling
        const heapBase = this.wasm.__heap_base ? this.wasm.__heap_base.value : 1024;
        this.ptr = heapBase;

        // Grow memory if needed
        const pagesNeeded = Math.ceil((this.ptr + this.byteSize) / 65536);
        if (this.memory.buffer.byteLength < (this.ptr + this.byteSize)) {
            this.memory.grow(pagesNeeded);
        }

        // Function Detection
        this.updateFn = this.wasm.updateParticles;
        this.initFn = this.wasm.initParticles;
        this.checkCollisionFn = this.wasm.checkCollision;

        if (!this.updateFn) {
            console.warn("⚠️ updateParticles not found. Did you compile 'assembly/index.ts'?");
        }

        // Initialize Particles
        if (this.initFn) {
            console.log("⚡ initializing particles via AssemblyScript...");
            this.initFn(this.ptr, this.count);
        } else {
            this.initParticlesJS();
        }

        this.createMesh();
        this.isReady = true;

    } catch (e) {
        console.error("Failed to init WASM:", e);
    }
}

initParticlesJS() {
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

    // Use PointsNodeMaterial for WebGPU compatibility
    const material = new PointsNodeMaterial({
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
    if (this.isReady && this.checkCollisionFn) {
        this.checkCollisionFn(this.ptr, this.count, playerX, playerZ, radius);
    }
}

update(deltaTime) {
    if (!this.isReady || !this.updateFn) return;

    // Call WASM update
    this.updateFn(this.ptr, this.count, deltaTime);

    // Sync view
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
