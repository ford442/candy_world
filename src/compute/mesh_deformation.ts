/**
 * @file mesh_deformation.ts
 * @description CPU-based mesh deformation system for animated geometry
 * 
 * Provides wave, jiggle, and wobble deformation effects that can be
 * applied to Three.js geometries. Supports audio-reactive behavior.
 * 
 * @example
 * ```ts
 * import { MeshDeformationCompute } from './mesh_deformation';
 * 
 * const mesh = new THREE.Mesh(geometry, material);
 * const deformer = new MeshDeformationCompute(geometry, 'wave');
 * deformer.setStrength(1.5);
 * 
 * // In animation loop:
 * deformer.update(elapsedTime, { kick: audioState.kickTrigger });
 * ```
 */

import * as THREE from 'three';
import { uniform } from 'three/tsl';

/**
 * Deformation effect types
 */
export const DeformationType = {
    /** Wave-like ripples across the surface */
    WAVE: 'wave',
    /** Jiggle/bounce effect (good for mushrooms) */
    JIGGLE: 'jiggle',
    /** Gentle wobble (good for trees) */
    WOBBLE: 'wobble'
} as const;

export type DeformationTypeValue = typeof DeformationType[keyof typeof DeformationType];

/**
 * Configuration for mesh deformation
 */
export interface DeformationConfig {
    /** Type of deformation effect */
    readonly type?: DeformationTypeValue;
    /** Effect strength multiplier (default: 1.0) */
    readonly strength?: number;
    /** Wave/wobble frequency (default: 1.0) */
    readonly frequency?: number;
    /** Enable audio reactivity (default: true) */
    readonly audioReactive?: boolean;
}

/**
 * Audio state for deformation updates
 */
export interface DeformationAudioState {
    /** Kick drum intensity (0-1) */
    readonly kick?: number;
    /** Overall audio level (0-1) */
    readonly level?: number;
}

/**
 * CPU-based mesh deformation system.
 * Modifies geometry vertices directly for wave, jiggle, and wobble effects.
 */
export class MeshDeformationCompute {
    /** The geometry being deformed */
    public readonly geometry: THREE.BufferGeometry;
    
    /** Type of deformation */
    public readonly type: DeformationTypeValue;
    
    /** Original vertex positions (for resetting) */
    private readonly originalPositions: Float32Array;
    
    /** Time uniform for shader integration */
    public readonly uTime = uniform(0.0);
    
    /** Strength uniform */
    public readonly uStrength = uniform(1.0);
    
    /** Frequency uniform */
    public readonly uFrequency = uniform(1.0);
    
    /** Audio pulse uniform */
    public readonly uAudioPulse = uniform(0.0);
    
    /** Whether audio reactivity is enabled */
    private audioReactive: boolean;

    /**
     * Creates a new mesh deformation system.
     * 
     * @param geometry - The BufferGeometry to deform
     * @param type - Type of deformation effect
     * @param config - Additional configuration
     */
    constructor(
        geometry: THREE.BufferGeometry,
        type: DeformationTypeValue = DeformationType.WAVE,
        config: DeformationConfig = {}
    ) {
        this.geometry = geometry;
        this.type = type;

        // Store original positions for resetting
        const posAttr = geometry.attributes.position;
        if (!posAttr) {
            throw new Error('Geometry must have position attribute');
        }
        this.originalPositions = (posAttr.array as Float32Array).slice();

        const {
            strength = 1.0,
            frequency = 1.0,
            audioReactive = true
        } = config;

        this.uStrength.value = strength;
        this.uFrequency.value = frequency;
        this.audioReactive = audioReactive;
    }

    /**
     * Set the deformation strength.
     * @param strength - Effect strength multiplier
     */
    public setStrength(strength: number): void {
        this.uStrength.value = strength;
    }

    /**
     * Set the deformation frequency.
     * @param frequency - Wave/wobble frequency
     */
    public setFrequency(frequency: number): void {
        this.uFrequency.value = frequency;
    }

    /**
     * Enable or disable audio reactivity.
     * @param enabled - Whether to react to audio
     */
    public setAudioReactive(enabled: boolean): void {
        this.audioReactive = enabled;
    }

    /**
     * Updates the mesh deformation.
     * Call this every frame with the current time.
     * 
     * @param time - Current elapsed time in seconds
     * @param audioState - Optional audio state for reactive behavior
     */
    public update(time: number, audioState: DeformationAudioState = {}): void {
        this.uTime.value = time;
        
        const audioPulse = this.audioReactive ? (audioState.kick ?? 0) : 0;
        this.uAudioPulse.value = audioPulse;

        const positions = this.geometry.attributes.position.array as Float32Array;
        const strength = this.uStrength.value;
        const frequency = this.uFrequency.value;

        for (let i = 0; i < positions.length; i += 3) {
            const x = this.originalPositions[i];
            const y = this.originalPositions[i + 1];
            const z = this.originalPositions[i + 2];

            switch (this.type) {
                case DeformationType.WAVE:
                    this.applyWave(positions, i, x, y, z, time, strength, frequency, audioPulse);
                    break;
                    
                case DeformationType.JIGGLE:
                    this.applyJiggle(positions, i, x, y, z, time, strength, audioPulse);
                    break;
                    
                case DeformationType.WOBBLE:
                    this.applyWobble(positions, i, x, y, z, time, strength, audioPulse);
                    break;
            }
        }

        // Mark position attribute as needing update
        this.geometry.attributes.position.needsUpdate = true;
        this.geometry.computeVertexNormals();
    }

    /**
     * Apply wave deformation to a vertex.
     */
    private applyWave(
        positions: Float32Array,
        i: number,
        x: number,
        y: number,
        z: number,
        time: number,
        strength: number,
        frequency: number,
        audioPulse: number
    ): void {
        const wave = Math.sin(x * frequency + time * 2) * 
                     Math.cos(z * frequency + time * 2);
        positions[i + 1] = y + wave * strength * (1 + audioPulse * 0.5);
    }

    /**
     * Apply jiggle deformation to a vertex (good for mushrooms).
     */
    private applyJiggle(
        positions: Float32Array,
        i: number,
        x: number,
        y: number,
        z: number,
        time: number,
        strength: number,
        audioPulse: number
    ): void {
        const offset = Math.sin(time * 5 + y * 2) * strength * 0.1;
        positions[i] = x + offset * (1 + audioPulse);
        positions[i + 2] = z + offset * Math.cos(time * 5 + y * 2) * (1 + audioPulse);
    }

    /**
     * Apply wobble deformation to a vertex (good for trees).
     */
    private applyWobble(
        positions: Float32Array,
        i: number,
        x: number,
        y: number,
        z: number,
        time: number,
        strength: number,
        audioPulse: number
    ): void {
        // Wobble increases with height (y)
        const wobble = Math.sin(time * 2 + y * 0.5) * strength * 0.05;
        positions[i] = x + wobble * (y / 5) * (1 + audioPulse * 0.3);
    }

    /**
     * Reset geometry to original state.
     */
    public reset(): void {
        const positions = this.geometry.attributes.position.array as Float32Array;
        positions.set(this.originalPositions);
        this.geometry.attributes.position.needsUpdate = true;
        this.geometry.computeVertexNormals();
    }

    /**
     * Dispose of resources.
     */
    public dispose(): void {
        // Original positions array will be garbage collected
        // Geometry is not owned by this class, so don't dispose it
    }
}

/**
 * Factory function to create a wave deformation system.
 * 
 * @param geometry - Target geometry
 * @param config - Configuration options
 * @returns A MeshDeformationCompute configured for wave effects
 */
export function createWaveDeformation(
    geometry: THREE.BufferGeometry,
    config: Omit<DeformationConfig, 'type'> = {}
): MeshDeformationCompute {
    return new MeshDeformationCompute(geometry, DeformationType.WAVE, config);
}

/**
 * Factory function to create a jiggle deformation system.
 * 
 * @param geometry - Target geometry
 * @param config - Configuration options
 * @returns A MeshDeformationCompute configured for jiggle effects
 */
export function createJiggleDeformation(
    geometry: THREE.BufferGeometry,
    config: Omit<DeformationConfig, 'type'> = {}
): MeshDeformationCompute {
    return new MeshDeformationCompute(geometry, DeformationType.JIGGLE, config);
}

/**
 * Factory function to create a wobble deformation system.
 * 
 * @param geometry - Target geometry
 * @param config - Configuration options
 * @returns A MeshDeformationCompute configured for wobble effects
 */
export function createWobbleDeformation(
    geometry: THREE.BufferGeometry,
    config: Omit<DeformationConfig, 'type'> = {}
): MeshDeformationCompute {
    return new MeshDeformationCompute(geometry, DeformationType.WOBBLE, config);
}
