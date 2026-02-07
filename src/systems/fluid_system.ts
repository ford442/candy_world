import * as THREE from 'three';
import {
    fluidInit, fluidStep, fluidAddDensity, fluidAddVelocity, getFluidDensityView
} from '../utils/wasm-loader.js';
import { VisualState } from '../audio/audio-system.ts';

export class FluidSystem {
    private size: number = 128;
    public texture: THREE.DataTexture;
    private densityView: Float32Array | null = null;
    private initialized: boolean = false;

    constructor() {
        // Create initial texture (black)
        // RedFormat means 1 float per pixel
        const data = new Float32Array(this.size * this.size);
        this.texture = new THREE.DataTexture(
            data, this.size, this.size, THREE.RedFormat, THREE.FloatType
        );
        this.texture.magFilter = THREE.LinearFilter;
        this.texture.minFilter = THREE.LinearFilter;
        this.texture.needsUpdate = true;
    }

    init() {
        try {
            fluidInit(this.size);
            this.densityView = getFluidDensityView(this.size);
            if (this.densityView) {
                this.initialized = true;
                console.log('[FluidSystem] Initialized C++ Fluid Solver');
            }
        } catch (e) {
            console.warn('[FluidSystem] Failed to init WASM fluid:', e);
        }
    }

    update(delta: number, audio: VisualState) {
        // Try to lazy init if WASM became ready
        if (!this.initialized) {
            this.densityView = getFluidDensityView(this.size);
            if (this.densityView) {
                this.initialized = true;
                console.log('[FluidSystem] Late Init Success');
            } else {
                return;
            }
        }

        const dt = Math.min(delta, 0.1);

        // --- Input Injection ---

        // 1. Kick Drum: Upward blast from bottom center
        if (audio.kick > 0.1) {
             const cx = this.size / 2;
             const cy = 5; // Bottom
             const spread = 5;

             for(let i=0; i<3; i++) {
                 const ox = (Math.random() - 0.5) * spread;
                 const oy = (Math.random() - 0.5) * spread;

                 // Add Density
                 this.addDensity(cx + ox, cy + oy, 50 * audio.kick * dt);

                 // Add Velocity (Upward)
                 this.addVelocity(cx + ox, cy + oy, (Math.random()-0.5)*2, 10 * audio.kick);
             }
        }

        // 2. High Freq: Random sparkles/drips
        if (audio.high > 0.2) {
             const x = Math.floor(Math.random() * this.size);
             const y = Math.floor(Math.random() * this.size);
             this.addDensity(x, y, 20 * audio.high * dt);
             this.addVelocity(x, y, (Math.random()-0.5)*5, (Math.random()-0.5)*5);
        }

        // --- Simulation Step ---
        // visc, diff
        fluidStep(dt, 0.00001, 0.00001);

        // --- Update Texture ---
        // Copy WASM memory to Texture buffer
        // Note: densityView is a view into the WASM heap.
        // texture.image.data is a separate Float32Array in JS heap.
        // We must copy.
        if (this.densityView) {
            this.texture.image.data.set(this.densityView);
            this.texture.needsUpdate = true;
        }
    }

    addDensity(x: number, y: number, amount: number) {
        fluidAddDensity(Math.floor(x), Math.floor(y), amount);
    }

    addVelocity(x: number, y: number, amountX: number, amountY: number) {
        fluidAddVelocity(Math.floor(x), Math.floor(y), amountX, amountY);
    }
}

// Global instance
export const fluidSystem = new FluidSystem();
