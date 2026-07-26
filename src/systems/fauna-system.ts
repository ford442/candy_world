import * as THREE from 'three';
import { getWasmInstance, wasmInitBoids, wasmUpdateBoids, wasmGetBoidsCount } from '../utils/wasm-loader.ts';
import { FaunaBatcher } from '../foliage/fauna-batcher.ts';

export class FaunaSystem {
    private static instance: FaunaSystem;
    private initialized = false;
    private boidsCount = 0;
    private memory: WebAssembly.Memory | null = null;
    private faunaBatcher: FaunaBatcher | null = null;

    private constructor() {}

    public static getInstance(): FaunaSystem {
        if (!FaunaSystem.instance) {
            FaunaSystem.instance = new FaunaSystem();
        }
        return FaunaSystem.instance;
    }

    public init(scene: THREE.Scene) {
        if (this.initialized) return;

        const wasm = getWasmInstance();
        if (!wasm) {
            console.warn('[FaunaSystem] WASM not ready, skipping init');
            return;
        }

        try {
            // Initialize boids in WASM
            if (wasmInitBoids) wasmInitBoids(); else throw new Error('WASM initBoids missing');
            this.boidsCount = wasmGetBoidsCount ? wasmGetBoidsCount() : 0;

            // Get memory instance - this requires checking for `.buffer` correctly
            // as per project knowledgebase
            this.memory = wasm.memory;

            // Create batcher
            this.faunaBatcher = new FaunaBatcher(this.boidsCount);
            scene.add(this.faunaBatcher);

            this.initialized = true;
            console.log(`[FaunaSystem] Initialized ${this.boidsCount} boids`);
        } catch (e) {
            console.error('[FaunaSystem] Initialization failed:', e);
        }
    }

    public update(delta: number) {
        if (!this.initialized || !this.faunaBatcher || !this.memory) return;

        const wasm = getWasmInstance();
        if (!wasm) return;

        // Run WASM simulation
        if (!wasmUpdateBoids) return;
        const ptr = wasmUpdateBoids(delta);

        // Read buffer
        // Note: project memory states to access buffer safely: (emscriptenMemory as any).buffer || emscriptenMemory
        // But for AssemblyScript output, it's typically just `memory.buffer`
        const memoryBuffer = this.memory.buffer;

        // 7 floats per boid: x, y, z, vx, vy, vz, type
        const floatArray = new Float32Array(memoryBuffer, ptr, this.boidsCount * 7);

        // Update the batcher with new positions/rotations
        this.faunaBatcher.updateFromWasm(floatArray, this.boidsCount);
    }
}
