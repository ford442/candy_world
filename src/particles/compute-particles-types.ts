/**
 * @file compute-particles-types.ts
 * @description Type definitions for the compute particle system
 */

import * as THREE from 'three';

export type ComputeParticleType =
    | 'fireflies'
    | 'pollen'
    | 'berries'
    | 'rain'
    | 'sparks'
    | 'gem_sparks'
    /** One-shot radial shrapnel for impacts and abilities (emitter API preset). */
    | 'spark_burst'
    /** One-shot buoyant candy billow for debris and pickups (emitter API preset). */
    | 'candy_puff';

/** Attractor/repulsor uploaded to the compute kernel. Max 4 per system. */
export interface ParticleAttractor {
    position: THREE.Vector3;
    /** Positive attracts, negative repels. Units/s^2 at the attractor centre. */
    strength: number;
    /** Influence radius; force falls off linearly to zero at the edge. */
    radius: number;
}

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
    /** Dead particles stay dead until `spawn()` re-seeds them (burst emitters). */
    oneShot?: boolean;
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

export interface SparkBurstConfig extends Omit<ComputeParticleConfig, 'type'> {
    /** Tint of the hottest part of the burst. */
    coreColor?: number;
}

export interface CandyPuffConfig extends Omit<ComputeParticleConfig, 'type'> {
    /** Base candy tint of the billow. */
    puffColor?: number;
}

export interface GemSparkConfig extends Omit<ComputeParticleConfig, 'type'> {
    /** Base twinkle frequency multiplier (visual tuning). */
    twinkleRate?: number;
    /** Drift speed scale for noise-driven motion. */
    driftSpeed?: number;
}

export interface ComputeSystemCollection {
    fireflies?: any; // ComputeParticleSystem
    pollen?: any; // ComputeParticleSystem
    berries?: any; // ComputeParticleSystem
    rain?: any; // ComputeParticleSystem
    sparks?: any; // ComputeParticleSystem
    gem_sparks?: any; // ComputeParticleSystem
    spark_burst?: any; // ComputeParticleSystem
    candy_puff?: any; // ComputeParticleSystem
}

export interface ComputeParticleSystem {
    particlesMesh: any;
    computeNode: any;
    update(renderer: THREE.Renderer, deltaTime: number, playerPosition: THREE.Vector3, audioData: ParticleAudioData): void;
    dispose(): void;
    updateInstances(count: number): void;
}
