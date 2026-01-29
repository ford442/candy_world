/**
 * @file material_types.ts
 * @description TypeScript interfaces and types for the Candy World material system
 */

import * as THREE from 'three';
import type { ShaderNodeObject, Node } from 'three/tsl';

/**
 * Material type identifiers for the factory
 */
export const MaterialType = {
    CANDY: 'candy',
    GLOWING: 'glowing',
    PETAL: 'petal',
    IRIDESCENT: 'iridescent',
    JELLY: 'jelly',
    FROSTED: 'frosted',
    SWIRLED: 'swirled',
    AUDIO_REACTIVE: 'audio_reactive',
    GROUND: 'ground'
} as const;

export type MaterialTypeValue = typeof MaterialType[keyof typeof MaterialType];

/**
 * Base configuration for all candy materials
 */
export interface CandyMaterialConfig {
    /** Base color of the material (hex number) */
    readonly baseColor?: number;
    /** Surface roughness (0-1, lower = shinier) */
    readonly roughness?: number;
    /** Fake subsurface scattering strength (0-1) */
    readonly translucency?: number;
    /** Iridescence effect strength (0-1) */
    readonly iridescence?: number;
    /** Emissive color (hex number) */
    readonly emissive?: number;
    /** Emissive light intensity */
    readonly emissiveIntensity?: number;
}

/**
 * Configuration for glowing materials
 */
export interface GlowingMaterialConfig {
    /** Base/glow color (hex number) */
    readonly baseColor?: number;
    /** Maximum glow intensity */
    readonly glowIntensity?: number;
    /** Speed of pulsing animation */
    readonly pulseSpeed?: number;
}

/**
 * Configuration for petal materials
 */
export interface PetalMaterialConfig {
    /** Base petal color (hex number) */
    readonly baseColor?: number;
    /** Translucency/backlight strength (0-1) */
    readonly translucency?: number;
}

/**
 * Configuration for audio-reactive materials
 */
export interface AudioReactiveMaterialConfig {
    /** Base color that reacts to audio (hex number) */
    readonly baseColor?: number;
    /** Maximum intensity multiplier for audio reaction */
    readonly maxIntensity?: number;
    /** Decay rate for audio effect (how fast it returns to normal) */
    readonly decayRate?: number;
}

/**
 * Configuration for ground materials
 */
export interface GroundMaterialConfig {
    /** Ground base color (hex number) */
    readonly baseColor?: number;
}

/**
 * Audio state passed to reactive materials
 */
export interface AudioState {
    /** Kick drum trigger intensity (0-1) */
    readonly kick?: number;
    /** Active audio color (hex number) */
    readonly color?: number;
    /** Overall audio level (0-1) */
    readonly level?: number;
    /** Beat phase (0-1, cycles with beat) */
    readonly beatPhase?: number;
}

/**
 * Interface for materials that react to audio
 */
export interface IAudioReactiveMaterial {
    /** Update the material with current audio state */
    updateAudio(state: AudioState): void;
}

/**
 * Extended material interface for Candy World materials
 */
export interface CandyMaterial extends THREE.Material {
    /** TSL color node for dynamic coloring */
    colorNode?: ShaderNodeObject<Node>;
    /** TSL emissive node for dynamic glow */
    emissiveNode?: ShaderNodeObject<Node>;
    /** TSL emissive intensity node */
    emissiveIntensityNode?: ShaderNodeObject<Node>;
    /** TSL position node for vertex displacement */
    positionNode?: ShaderNodeObject<Node>;
    /** Material user data */
    userData: {
        readonly type?: MaterialTypeValue;
        readonly isAudioReactive?: boolean;
        [key: string]: unknown;
    };
}

/**
 * Uniform reference holder for audio-reactive uniforms
 */
export interface AudioUniforms {
    /** Audio pulse strength uniform */
    readonly audioPulse: ShaderNodeObject<Node>;
    /** Audio color uniform */
    readonly audioColor: ShaderNodeObject<Node>;
}

/**
 * Result type for material creation functions
 */
export type MaterialCreateResult<T extends THREE.Material = THREE.Material> = T & CandyMaterial;
