/**
 * @file materials.ts
 * @description Specialized candy-styled materials using Three.js TSL (Three Shader Language)
 * 
 * Implements 9 specialized materials:
 * - Candy (base with fake SSS)
 * - Glowing (animated emission)
 * - Petal (translucent double-sided)
 * - Iridescent (color-shifting)
 * - Jelly (high translucency)
 * - Frosted (high roughness matte)
 * - Swirled (standard candy)
 * - Audio-reactive (responds to music)
 * - Ground (simple terrain)
 * 
 * @example
 * ```ts
 * import { MaterialFactory, updateAudioReactiveMaterials } from './materials';
 * 
 * const factory = new MaterialFactory();
 * const candyMat = factory.createCandy({ baseColor: 0xFF69B4 });
 * const glowMat = factory.createGlowing({ pulseSpeed: 3.0 });
 * 
 * // In animation loop:
 * updateAudioReactiveMaterials({ kick: audioSystem.kickTrigger });
 * ```
 */

import * as THREE from 'three';
import {
    color,
    vec3,
    float,
    normalView,
    positionView,
    dot,
    pow,
    mix,
    sin,
    time,
    uniform
} from 'three/tsl';
import { MeshStandardNodeMaterial } from 'three/webgpu';

import type {
    CandyMaterialConfig,
    GlowingMaterialConfig,
    PetalMaterialConfig,
    AudioReactiveMaterialConfig,
    GroundMaterialConfig,
    AudioState,
    MaterialCreateResult,
    AudioUniforms
} from './material_types.js';

import { MaterialType } from './material_types.js';

// =============================================================================
// GLOBAL AUDIO UNIFORMS
// =============================================================================

/**
 * Global uniform for audio pulse intensity (0-1)
 * Updated by updateAudioReactiveMaterials()
 */
export const uAudioPulse = uniform(0.0);

/**
 * Global uniform for audio-reactive color
 * Updated by updateAudioReactiveMaterials()
 */
export const uAudioColor = uniform(color(0xFFFFFF));

// =============================================================================
// MATERIAL CREATION FUNCTIONS
// =============================================================================

/**
 * Creates a candy-style material with fake subsurface scattering via rim lighting.
 * This is more performant than real SSS/transmission while maintaining the candy aesthetic.
 * 
 * @param config - Material configuration options
 * @returns A MeshStandardNodeMaterial with TSL-based rim lighting
 * 
 * @example
 * ```ts
 * const pinkCandy = createCandyMaterial({ baseColor: 0xFF69B4, translucency: 0.7 });
 * ```
 */
export function createCandyMaterial(config: CandyMaterialConfig = {}): MaterialCreateResult<MeshStandardNodeMaterial> {
    const {
        baseColor = 0xFF69B4,
        roughness = 0.3,
        translucency = 0.5,
        iridescence = 0.0,
        emissive = 0x000000,
        emissiveIntensity = 0.0
    } = config;

    const material = new MeshStandardNodeMaterial({
        color: baseColor,
        roughness: roughness,
        metalness: 0.0,
        emissive: emissive,
        emissiveIntensity: emissiveIntensity
    }) as MaterialCreateResult<MeshStandardNodeMaterial>;

    // TSL: Cheap Fake Subsurface Scattering (Rim Lighting)
    // Much cheaper than real transmission/SSS while maintaining candy look
    const normal = normalView;
    const viewDir = positionView.negate().normalize();
    const rimDot = dot(normal, viewDir).abs().oneMinus();
    const rim = pow(rimDot, float(3.0)).mul(translucency);

    const rimColor = color(baseColor).mul(rim).mul(2.0);

    // Add iridescent color shift based on view angle
    if (iridescence > 0) {
        const shift = rimDot.mul(6.28); // Full cycle
        const r = sin(shift).mul(0.5).add(0.5);
        const g = sin(shift.add(2.0)).mul(0.5).add(0.5);
        const b = sin(shift.add(4.0)).mul(0.5).add(0.5);
        material.colorNode = mix(color(baseColor), vec3(r, g, b), float(iridescence).mul(rim));
    }

    material.emissiveNode = rimColor.add(color(emissive).mul(emissiveIntensity));

    // Store metadata
    material.userData = {
        type: MaterialType.CANDY,
        isAudioReactive: false
    };

    return material;
}

/**
 * Creates a glowing material with animated pulsing emission.
 * 
 * @param config - Glowing material configuration
 * @returns A MeshStandardNodeMaterial with time-based emissive pulsing
 * 
 * @example
 * ```ts
 * const glowingOrb = createGlowingCandyMaterial({ glowIntensity: 2.0, pulseSpeed: 1.5 });
 * ```
 */
export function createGlowingCandyMaterial(config: GlowingMaterialConfig = {}): MaterialCreateResult<MeshStandardNodeMaterial> {
    const {
        baseColor = 0xFFD700,
        glowIntensity = 1.5,
        pulseSpeed = 2.0
    } = config;

    const material = new MeshStandardNodeMaterial({
        color: baseColor,
        emissive: baseColor,
        roughness: 0.4
    }) as MaterialCreateResult<MeshStandardNodeMaterial>;

    // Animated pulsing glow
    const pulse = time.mul(pulseSpeed).sin().mul(0.3).add(0.7);
    material.emissiveIntensityNode = float(glowIntensity).mul(pulse);

    material.userData = {
        type: MaterialType.GLOWING,
        isAudioReactive: false
    };

    return material;
}

/**
 * Creates a translucent petal material with backlight effect.
 * Uses alpha blending instead of transmission for better performance.
 * 
 * @param config - Petal material configuration
 * @returns A double-sided transparent MeshStandardNodeMaterial
 * 
 * @example
 * ```ts
 * const rosePetal = createPetalMaterial({ baseColor: 0xFFB7C5, translucency: 0.9 });
 * ```
 */
export function createPetalMaterial(config: PetalMaterialConfig = {}): MaterialCreateResult<MeshStandardNodeMaterial> {
    const {
        baseColor = 0xFFB7C5,
        translucency = 0.8
    } = config;

    const material = new MeshStandardNodeMaterial({
        color: baseColor,
        roughness: 0.5,
        transparent: true,
        opacity: 0.9, // Alpha blend is cheaper than transmission
        side: THREE.DoubleSide
    }) as MaterialCreateResult<MeshStandardNodeMaterial>;

    // Simple backlight effect via rim lighting
    const normal = normalView;
    const viewDir = positionView.negate().normalize();
    const rim = dot(normal, viewDir).abs().oneMinus();
    material.emissiveNode = color(baseColor).mul(rim).mul(translucency);

    material.userData = {
        type: MaterialType.PETAL,
        isAudioReactive: false
    };

    return material;
}

/**
 * Creates an iridescent material with strong color-shifting effect.
 * 
 * @param config - Base candy configuration (iridescence is preset to 0.8)
 * @returns A MeshStandardNodeMaterial with strong iridescence
 */
export function createIridescentMaterial(config: CandyMaterialConfig = {}): MaterialCreateResult<MeshStandardNodeMaterial> {
    const material = createCandyMaterial({ ...config, iridescence: 0.8 });
    material.userData = {
        ...material.userData,
        type: MaterialType.IRIDESCENT
    };
    return material;
}

/**
 * Creates a jelly-like material with high translucency.
 * 
 * @param config - Base candy configuration (translucency is preset to 0.9)
 * @returns A MeshStandardNodeMaterial with jelly-like appearance
 */
export function createJellyMaterial(config: CandyMaterialConfig = {}): MaterialCreateResult<MeshStandardNodeMaterial> {
    const material = createCandyMaterial({ ...config, translucency: 0.9 });
    material.userData = {
        ...material.userData,
        type: MaterialType.JELLY
    };
    return material;
}

/**
 * Creates a frosted/matte material with high roughness.
 * 
 * @param config - Base candy configuration (roughness is preset to 0.9)
 * @returns A MeshStandardNodeMaterial with matte clay-like finish
 */
export function createFrostedMaterial(config: CandyMaterialConfig = {}): MaterialCreateResult<MeshStandardNodeMaterial> {
    const material = createCandyMaterial({ ...config, roughness: 0.9 });
    material.userData = {
        ...material.userData,
        type: MaterialType.FROSTED
    };
    return material;
}

/**
 * Creates a standard swirled candy material.
 * 
 * @param config - Base candy configuration
 * @returns A MeshStandardNodeMaterial with standard candy styling
 */
export function createSwirledMaterial(config: CandyMaterialConfig = {}): MaterialCreateResult<MeshStandardNodeMaterial> {
    const material = createCandyMaterial(config);
    material.userData = {
        ...material.userData,
        type: MaterialType.SWIRLED
    };
    return material;
}

/**
 * Creates an audio-reactive material that responds to music via global uniforms.
 * 
 * @param config - Audio-reactive material configuration
 * @returns A MeshStandardNodeMaterial that glows based on uAudioPulse
 * 
 * @example
 * ```ts
 * const reactiveMat = createAudioReactiveMaterial({ baseColor: 0xFF6347 });
 * // In animation loop:
 * updateAudioReactiveMaterials({ kick: 0.8 });
 * ```
 */
export function createAudioReactiveMaterial(config: AudioReactiveMaterialConfig = {}): MaterialCreateResult<MeshStandardNodeMaterial> {
    const { baseColor = 0xFF6347 } = config;

    const material = new MeshStandardNodeMaterial({
        color: baseColor,
        emissive: baseColor
    }) as MaterialCreateResult<MeshStandardNodeMaterial>;

    // Emissive intensity tied to global audio pulse uniform
    material.emissiveIntensityNode = uAudioPulse.mul(2.0);

    material.userData = {
        type: MaterialType.AUDIO_REACTIVE,
        isAudioReactive: true
    };

    return material;
}

/**
 * Creates a simple ground material optimized for terrain.
 * 
 * @param config - Ground material configuration
 * @returns A basic MeshStandardNodeMaterial for terrain
 */
export function createGroundMaterial(config: GroundMaterialConfig = {}): MaterialCreateResult<MeshStandardNodeMaterial> {
    const { baseColor = 0x98FB98 } = config;

    const material = new MeshStandardNodeMaterial({
        color: baseColor,
        roughness: 0.9
    }) as MaterialCreateResult<MeshStandardNodeMaterial>;

    material.userData = {
        type: MaterialType.GROUND,
        isAudioReactive: false
    };

    return material;
}

// =============================================================================
// AUDIO REACTIVE UPDATE
// =============================================================================

/**
 * Updates all audio-reactive materials with current audio state.
 * Call this in the animation loop with the current audio analysis data.
 * 
 * @param audioState - Current audio state from the audio system
 * 
 * @example
 * ```ts
 * // In animation loop:
 * const state = audioSystem.update();
 * updateAudioReactiveMaterials({ 
 *     kick: state.kickTrigger,
 *     color: 0xFF00FF 
 * });
 * ```
 */
export function updateAudioReactiveMaterials(audioState: AudioState): void {
    if (audioState.kick !== undefined) {
        uAudioPulse.value = audioState.kick;
    }
    if (audioState.color !== undefined) {
        uAudioColor.value.setHex(audioState.color);
    }
}

// =============================================================================
// MATERIAL FACTORY CLASS
// =============================================================================

/**
 * Factory class for creating typed Candy World materials.
 * Provides a clean API for material creation with proper TypeScript types.
 * 
 * @example
 * ```ts
 * const factory = new MaterialFactory();
 * 
 * const candy = factory.createCandy({ baseColor: 0xFF69B4 });
 * const glow = factory.createGlowing({ pulseSpeed: 3.0 });
 * const petal = factory.createPetal({ translucency: 0.9 });
 * const audioReactive = factory.createAudioReactive({ baseColor: 0xFF0000 });
 * ```
 */
export class MaterialFactory {
    /**
     * Get the global audio uniforms for custom material integration
     */
    public getAudioUniforms(): AudioUniforms {
        return {
            audioPulse: uAudioPulse,
            audioColor: uAudioColor
        };
    }

    /**
     * Create a candy-style material with fake SSS
     */
    public createCandy(config?: CandyMaterialConfig): MaterialCreateResult<MeshStandardNodeMaterial> {
        return createCandyMaterial(config);
    }

    /**
     * Create a glowing material with animated emission
     */
    public createGlowing(config?: GlowingMaterialConfig): MaterialCreateResult<MeshStandardNodeMaterial> {
        return createGlowingCandyMaterial(config);
    }

    /**
     * Create a translucent petal material
     */
    public createPetal(config?: PetalMaterialConfig): MaterialCreateResult<MeshStandardNodeMaterial> {
        return createPetalMaterial(config);
    }

    /**
     * Create an iridescent material
     */
    public createIridescent(config?: CandyMaterialConfig): MaterialCreateResult<MeshStandardNodeMaterial> {
        return createIridescentMaterial(config);
    }

    /**
     * Create a jelly-like material
     */
    public createJelly(config?: CandyMaterialConfig): MaterialCreateResult<MeshStandardNodeMaterial> {
        return createJellyMaterial(config);
    }

    /**
     * Create a frosted/matte material
     */
    public createFrosted(config?: CandyMaterialConfig): MaterialCreateResult<MeshStandardNodeMaterial> {
        return createFrostedMaterial(config);
    }

    /**
     * Create a swirled candy material
     */
    public createSwirled(config?: CandyMaterialConfig): MaterialCreateResult<MeshStandardNodeMaterial> {
        return createSwirledMaterial(config);
    }

    /**
     * Create an audio-reactive material
     */
    public createAudioReactive(config?: AudioReactiveMaterialConfig): MaterialCreateResult<MeshStandardNodeMaterial> {
        return createAudioReactiveMaterial(config);
    }

    /**
     * Create a ground/terrain material
     */
    public createGround(config?: GroundMaterialConfig): MaterialCreateResult<MeshStandardNodeMaterial> {
        return createGroundMaterial(config);
    }
}

// Export a default factory instance for convenience
export const materialFactory = new MaterialFactory();
