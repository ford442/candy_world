// src/systems/adapters/WasmParticleSystem.js
import { LegacyParticleSystem } from './LegacyParticleSystem.js';

export class WasmParticleSystem extends LegacyParticleSystem {
    // ⚡ OPTIMIZATION: WasmParticleSystem now just delegates to the TSL-optimized LegacyParticleSystem.
    // TSL completely handles the particle logic on the GPU natively, so we don't need WASM array copies!
    constructor() {
        super();
    }
}
