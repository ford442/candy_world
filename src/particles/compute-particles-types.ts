/**
 * @file compute-particles-types.ts
 * @description Type definitions for the compute particle system
 */

import * as THREE from 'three';

export type ComputeParticleType = 'fireflies' | 'pollen' | 'berries' | 'rain' | 'sparks';

export interface ComputeParticleConfig {
    /** Particle system type */
    type: ComputeParticleType;
    /** Number of particles (default: 10000) */
    count?: number;
    /** Spawn area bounds */
    bounds?: { x: number; y: number; z: number };
    /** Spawn center position */
    center?: THREE.Vector3;
    /** Particle size range */
    sizeRange?: { min: number; max: number };
    /** Life range in seconds */
    lifeRange?: { min: number; max: number };
    /** Custom uniforms */
    customUniforms?: Record<string, any>;
}

export interface ParticleBuffers {
    position: any; // StorageBufferAttribute
    velocity: any; // StorageBufferAttribute
    life: any; // StorageBufferAttribute
    size: any; // StorageBufferAttribute
    color: any; // StorageBufferAttribute
    seed: any; // StorageBufferAttribute
}

export interface ParticleAudioData {
    low: number;      // Bass energy (0-1)
    mid: number;      // Mid energy (0-1)
    high: number;     // Treble energy (0-1)
    beat: boolean;    // Beat trigger
    groove: number;   // Groove amount (0-1)
    windX?: number;   // Wind X direction
    windZ?: number;   // Wind Z direction
    windSpeed?: number; // Wind speed
}

// Factory config interfaces
export interface FireflyConfig extends Omit<ComputeParticleConfig, 'type'> {
    glowColor?: number;
    blinkSpeed?: number;
}

export interface PollenConfig extends Omit<ComputeParticleConfig, 'type'> {
    windReactivity?: number;
    pollenColor?: number;
}

export interface BerryConfig extends Omit<ComputeParticleConfig, 'type'> {
    bounce?: number;
    gravity?: number;
}

export interface RainConfig extends Omit<ComputeParticleConfig, 'type'> {
    rainIntensity?: number;
    splashOnGround?: boolean;
}

export interface SparkConfig extends Omit<ComputeParticleConfig, 'type'> {
    sparkColor?: number;
    decayRate?: number;
}

export interface ComputeSystemCollection {
    fireflies?: any; // ComputeParticleSystem
    pollen?: any; // ComputeParticleSystem
    berries?: any; // ComputeParticleSystem
    rain?: any; // ComputeParticleSystem
    sparks?: any; // ComputeParticleSystem
}
