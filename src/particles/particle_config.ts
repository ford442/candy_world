/**
 * @file particle_config.ts
 * @description TypeScript interfaces and types for the Candy World particle systems
 */

import * as THREE from 'three';

/**
 * Particle system type identifiers
 */
export const ParticleSystemType = {
    SHIMMER: 'shimmer',
    BUBBLE: 'bubble',
    POLLEN: 'pollen',
    CONFETTI: 'confetti',
    PULSE_RING: 'pulse_ring',
    COMPUTE: 'compute'
} as const;

export type ParticleSystemTypeValue = typeof ParticleSystemType[keyof typeof ParticleSystemType];

/**
 * 3D bounds for particle systems
 */
export interface ParticleBounds {
    readonly x: number;
    readonly y: number;
    readonly z: number;
}

/**
 * Configuration for shimmer (sparkle) particles
 */
export interface ShimmerParticleConfig {
    /** Number of particles (default: 500) */
    readonly count?: number;
    /** Bounding box dimensions for particle spread */
    readonly bounds?: Readonly<ParticleBounds>;
    /** Minimum particle size (default: 0.1) */
    readonly minSize?: number;
    /** Maximum particle size (default: 0.3) */
    readonly maxSize?: number;
    /** Vertical float amplitude (default: 2.0) */
    readonly floatAmplitude?: number;
    /** Animation speed multiplier (default: 1.0) */
    readonly speed?: number;
}

/**
 * Configuration for bubble stream particles
 */
export interface BubbleStreamConfig {
    /** Source position for bubble emission */
    readonly position: Readonly<THREE.Vector3>;
    /** Number of bubbles (default: 100) */
    readonly count?: number;
    /** Maximum bubble size (default: 0.5) */
    readonly maxSize?: number;
    /** Rise speed multiplier (default: 1.0) */
    readonly riseSpeed?: number;
    /** Height before particle resets (default: 15) */
    readonly resetHeight?: number;
}

/**
 * Configuration for pollen cloud particles
 */
export interface PollenCloudConfig {
    /** Center position of the pollen cloud */
    readonly position: Readonly<THREE.Vector3>;
    /** Number of pollen particles (default: 200) */
    readonly count?: number;
    /** Pollen color (hex number, default: 0xFFD700 gold) */
    readonly pollenColor?: number;
    /** Cloud radius (default: 2.0) */
    readonly radius?: number;
    /** Swirl speed multiplier (default: 1.0) */
    readonly swirlSpeed?: number;
}

/**
 * Configuration for leaf confetti particles
 */
export interface LeafConfettiConfig {
    /** Center position for confetti spawn */
    readonly position: Readonly<THREE.Vector3>;
    /** Number of leaf particles (default: 150) */
    readonly count?: number;
    /** Leaf color (hex number, default: 0xFF69B4 pink) */
    readonly leafColor?: number;
    /** Spread radius (default: 5.0) */
    readonly spreadRadius?: number;
    /** Fall speed multiplier (default: 1.0) */
    readonly fallSpeed?: number;
}

/**
 * Configuration for audio-reactive pulse ring
 */
export interface PulseRingConfig {
    /** Center position of the ring */
    readonly position: Readonly<THREE.Vector3>;
    /** Number of points in ring (default: 60) */
    readonly pointCount?: number;
    /** Base ring radius (default: 5.0) */
    readonly radius?: number;
    /** Maximum expansion distance (default: 3.0) */
    readonly maxExpansion?: number;
}

/**
 * Configuration for GPU compute particle system
 */
export interface ComputeParticleConfig {
    /** Total particle count (default: 10000) */
    readonly count?: number;
    /** Initial spawn center */
    readonly spawnCenter?: Readonly<THREE.Vector3>;
    /** Gravity vector */
    readonly gravity?: Readonly<THREE.Vector3>;
    /** Particle life decay rate (default: 0.3) */
    readonly decayRate?: number;
    /** Base particle size (default: 0.2) */
    readonly particleSize?: number;
}

/**
 * Audio state for particle system updates
 */
export interface ParticleAudioState {
    /** Kick drum intensity (0-1) */
    readonly kick?: number;
    /** Overall audio level (0-1) */
    readonly level?: number;
    /** Beat phase (0-1) */
    readonly beatPhase?: number;
    /** Current audio color (hex) */
    readonly color?: number;
}

/**
 * Interface for all particle systems
 */
export interface IParticleSystem {
    /** The type identifier of this particle system */
    readonly type: ParticleSystemTypeValue;
    
    /** The Three.js object representing this particle system */
    readonly mesh: THREE.Points;
    
    /**
     * Update the particle system
     * @param deltaTime - Time since last frame in seconds
     * @param audioState - Optional audio state for reactive systems
     */
    update?(deltaTime: number, audioState?: ParticleAudioState): void;
    
    /**
     * Dispose of resources
     */
    dispose(): void;
}

/**
 * Factory method signature for creating particle systems
 */
export type ParticleSystemFactory<T extends IParticleSystem, C> = (config: C) => T;

/**
 * Collection of active particle systems
 */
export interface ParticleSystemCollection {
    shimmer?: IParticleSystem[];
    bubble?: IParticleSystem[];
    pollen?: IParticleSystem[];
    confetti?: IParticleSystem[];
    pulseRing?: IParticleSystem[];
    compute?: IParticleSystem[];
}
