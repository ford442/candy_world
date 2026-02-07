import { LegacyParticleSystem } from './LegacyParticleSystem.js';

/**
 * WASM-accelerated particle system
 * Extends LegacyParticleSystem with WASM batch updates
 */
export class WasmParticleSystem extends LegacyParticleSystem {
  wasmUpdateRainBatch: ((...args: any[]) => void) | null;
  wasmUpdateMistBatch: ((...args: any[]) => void) | null;
  
  rainPtr: number | null;
  rainPosPtr: number | null;
  rainVelPtr: number | null;
  rainOffPtr: number | null;
  rainCount: number;
  
  mistPtr: number | null;
  mistCount: number;

  constructor();

  /**
   * Update using WASM if available, fall back to JS
   */
  update(
    time: number,
    bassIntensity: number,
    melodyVol: number,
    weatherState: string,
    weatherType: string,
    intensity: number
  ): void;

  /**
   * Update rain using WASM
   */
  updateRainWasm(
    instance: any,
    time: number,
    bassIntensity: number,
    weatherState: string,
    weatherType: string,
    intensity: number
  ): void;

  /**
   * Update mist using WASM
   */
  updateMistWasm(
    instance: any,
    time: number,
    melodyVol: number,
    weatherState: string,
    weatherType: string
  ): void;
}
