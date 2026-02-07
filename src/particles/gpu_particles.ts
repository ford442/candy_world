/**
 * @file gpu_particles.ts
 * @description GPU-accelerated particle systems using Three.js TSL
 * 
 * Implements 5 particle systems:
 * - Shimmer particles (floating sparkles)
 * - Bubble streams (rising iridescent bubbles)
 * - Pollen clouds (swirling around flowers)
 * - Leaf confetti (falling with physics)
 * - Pulse rings (audio-reactive expanding rings)
 * 
 * All systems use TSL nodes for GPU-based animation.
 * 
 * @example
 * ```ts
 * import { 
 *     createShimmerParticles, 
 *     createBubbleStream,
 *     addAmbientParticles 
 * } from './gpu_particles';
 * 
 * // Add shimmer sparkles
 * const shimmer = createShimmerParticles({ count: 1000 });
 * scene.add(shimmer.mesh);
 * 
 * // Add bubbles from a position
 * const bubbles = createBubbleStream({ position: new THREE.Vector3(0, 0, 0) });
 * scene.add(bubbles.mesh);
 * ```
 */

import * as THREE from 'three';
import {
    color,
    vec3,
    vec4,
    attribute,
    time,
    positionLocal,
    mix,
    sin,
    cos
} from 'three/tsl';
import { PointsNodeMaterial } from 'three/webgpu';

import type {
    IParticleSystem,
    ShimmerParticleConfig,
    BubbleStreamConfig,
    PollenCloudConfig,
    LeafConfettiConfig,
    PulseRingConfig,
    ParticleAudioState,
    ParticleBounds
} from './particle_config.ts';
import { ParticleSystemType } from './particle_config.ts';
import { uPulseStrength, uPulseColor } from './audio_reactive.ts';

// =============================================================================
// SHIMMER PARTICLES (Floating Sparkles)
// =============================================================================

/**
 * Shimmer particle system implementation
 */
class ShimmerParticleSystem implements IParticleSystem {
    public readonly type = ParticleSystemType.SHIMMER;
    public readonly mesh: THREE.Points;

    constructor(config: ShimmerParticleConfig = {}) {
        const {
            count = 500,
            bounds = { x: 50, y: 20, z: 50 },
            minSize = 0.1,
            maxSize = 0.3,
            floatAmplitude = 2.0,
            speed = 1.0
        } = config;

        const geometry = new THREE.BufferGeometry();
        const positions = new Float32Array(count * 3);
        const sizes = new Float32Array(count);
        const offsets = new Float32Array(count);
        const colors = new Float32Array(count * 3);

        for (let i = 0; i < count; i++) {
            // Random positions within bounds
            positions[i * 3] = (Math.random() - 0.5) * bounds.x;
            positions[i * 3 + 1] = Math.random() * bounds.y + 2;
            positions[i * 3 + 2] = (Math.random() - 0.5) * bounds.z;

            // Random sizes
            sizes[i] = Math.random() * (maxSize - minSize) + minSize;
            
            // Random animation offsets for desynchronization
            offsets[i] = Math.random() * 100;

            // Pastel colors
            colors[i * 3] = 0.7 + Math.random() * 0.3;
            colors[i * 3 + 1] = 0.7 + Math.random() * 0.3;
            colors[i * 3 + 2] = 0.7 + Math.random() * 0.3;
        }

        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
        geometry.setAttribute('offset', new THREE.BufferAttribute(offsets, 1));
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

        const material = new PointsNodeMaterial({
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false
        });

        // TSL Animation nodes
        const aOffset = attribute('offset', 'float');
        const aSize = attribute('size', 'float');
        const aColor = attribute('color', 'vec3');

        // Floating animation
        const floatY = time.mul(0.3 * speed).add(aOffset).sin().mul(floatAmplitude);
        const driftX = time.mul(0.1 * speed).add(aOffset.mul(0.1)).sin().mul(0.5);
        const driftZ = time.mul(0.15 * speed).add(aOffset.mul(0.15)).cos().mul(0.5);

        const pos = positionLocal;
        material.positionNode = vec3(
            pos.x.add(driftX),
            pos.y.add(floatY),
            pos.z.add(driftZ)
        );

        // Twinkle effect
        const twinkle = time.mul(3.0 * speed).add(aOffset).sin().mul(0.5).add(0.5);
        material.sizeNode = aSize.mul(twinkle.add(0.3));

        // Color with sparkle
        const sparkle = time.mul(5.0 * speed).add(aOffset.mul(2.0)).sin().mul(0.3).add(0.7);
        material.colorNode = vec4(aColor.mul(sparkle), twinkle);

        this.mesh = new THREE.Points(geometry, material);
        this.mesh.userData.type = 'shimmer';
    }

    public dispose(): void {
        this.mesh.geometry.dispose();
        (this.mesh.material as THREE.Material).dispose();
    }
}

/**
 * Creates a shimmer particle system (floating sparkles).
 * 
 * @param config - Configuration options
 * @returns A shimmer particle system
 * 
 * @example
 * ```ts
 * const shimmer = createShimmerParticles({ 
 *     count: 1000, 
 *     bounds: { x: 100, y: 30, z: 100 } 
 * });
 * scene.add(shimmer.mesh);
 * ```
 */
export function createShimmerParticles(config: ShimmerParticleConfig = {}): IParticleSystem {
    return new ShimmerParticleSystem(config);
}

// =============================================================================
// BUBBLE STREAM PARTICLES
// =============================================================================

/**
 * Bubble stream particle system implementation
 */
class BubbleStreamSystem implements IParticleSystem {
    public readonly type = ParticleSystemType.BUBBLE;
    public readonly mesh: THREE.Points;

    constructor(config: BubbleStreamConfig) {
        const {
            position,
            count = 100,
            maxSize = 0.5,
            riseSpeed = 1.0,
            resetHeight = 15
        } = config;

        const geometry = new THREE.BufferGeometry();
        const positions = new Float32Array(count * 3);
        const sizes = new Float32Array(count);
        const offsets = new Float32Array(count);
        const velocities = new Float32Array(count * 3);

        for (let i = 0; i < count; i++) {
            // Start at source position with small random spread
            positions[i * 3] = position.x + (Math.random() - 0.5) * 0.5;
            positions[i * 3 + 1] = position.y;
            positions[i * 3 + 2] = position.z + (Math.random() - 0.5) * 0.5;

            sizes[i] = Math.random() * maxSize * 0.6 + maxSize * 0.4;
            offsets[i] = Math.random() * 10;

            // Upward velocity with slight random drift
            velocities[i * 3] = (Math.random() - 0.5) * 0.2;
            velocities[i * 3 + 1] = 1.0 + Math.random() * 0.5;
            velocities[i * 3 + 2] = (Math.random() - 0.5) * 0.2;
        }

        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
        geometry.setAttribute('offset', new THREE.BufferAttribute(offsets, 1));
        geometry.setAttribute('velocity', new THREE.BufferAttribute(velocities, 3));

        const material = new PointsNodeMaterial({
            transparent: true,
            opacity: 0.6,
            blending: THREE.NormalBlending,
            depthWrite: false
        });

        // TSL Animation
        const aOffset = attribute('offset', 'float');
        const aSize = attribute('size', 'float');
        const aVelocity = attribute('velocity', 'vec3');

        // Rising bubbles with wobble
        const riseHeight = time.mul(aVelocity.y).mul(riseSpeed).add(aOffset);
        const wobbleX = time.mul(2.0 * riseSpeed).add(aOffset).sin().mul(0.3);
        const wobbleZ = time.mul(2.5 * riseSpeed).add(aOffset).cos().mul(0.3);

        const pos = positionLocal;
        const newY = pos.y.add(riseHeight).mod(resetHeight);

        material.positionNode = vec3(
            pos.x.add(wobbleX),
            newY,
            pos.z.add(wobbleZ)
        );

        // Size grows as bubble rises
        const growFactor = newY.div(resetHeight).mul(0.5).add(1.0);
        material.sizeNode = aSize.mul(growFactor);

        // Iridescent bubble effect
        const iridescence = time.add(aOffset).mul(0.5).sin();
        const bubbleColor = mix(
            color(0xADD8E6), // Light blue
            color(0xE6E6FA), // Lavender
            iridescence.mul(0.5).add(0.5)
        );
        material.colorNode = bubbleColor;

        this.mesh = new THREE.Points(geometry, material);
        this.mesh.userData.type = 'bubbles';
        this.mesh.position.copy(position);
    }

    public dispose(): void {
        this.mesh.geometry.dispose();
        (this.mesh.material as THREE.Material).dispose();
    }
}

/**
 * Creates a bubble stream particle system.
 * 
 * @param config - Configuration with required position
 * @returns A bubble stream particle system
 * 
 * @example
 * ```ts
 * const bubbles = createBubbleStream({ 
 *     position: new THREE.Vector3(10, 0, 5),
 *     count: 200,
 *     riseSpeed: 1.5
 * });
 * scene.add(bubbles.mesh);
 * ```
 */
export function createBubbleStream(config: BubbleStreamConfig): IParticleSystem {
    return new BubbleStreamSystem(config);
}

// =============================================================================
// POLLEN CLOUD PARTICLES
// =============================================================================

/**
 * Pollen cloud particle system implementation
 */
class PollenCloudSystem implements IParticleSystem {
    public readonly type = ParticleSystemType.POLLEN;
    public readonly mesh: THREE.Points;
    private readonly centerPosition: THREE.Vector3;

    constructor(config: PollenCloudConfig) {
        const {
            position,
            count = 200,
            pollenColor = 0xFFD700,
            radius = 2.0,
            swirlSpeed = 1.0
        } = config;

        this.centerPosition = position.clone();

        const geometry = new THREE.BufferGeometry();
        const positions = new Float32Array(count * 3);
        const sizes = new Float32Array(count);
        const offsets = new Float32Array(count);

        for (let i = 0; i < count; i++) {
            // Random positions in sphere
            const theta = Math.random() * Math.PI * 2;
            const phi = Math.acos(2 * Math.random() - 1);
            const r = Math.random() * radius;

            positions[i * 3] = position.x + r * Math.sin(phi) * Math.cos(theta);
            positions[i * 3 + 1] = position.y + r * Math.sin(phi) * Math.sin(theta);
            positions[i * 3 + 2] = position.z + r * Math.cos(phi);

            sizes[i] = Math.random() * 0.15 + 0.05;
            offsets[i] = Math.random() * 100;
        }

        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
        geometry.setAttribute('offset', new THREE.BufferAttribute(offsets, 1));

        const material = new PointsNodeMaterial({
            transparent: true,
            opacity: 0.7,
            blending: THREE.AdditiveBlending,
            depthWrite: false
        });

        // TSL Animation
        const aOffset = attribute('offset', 'float');
        const aSize = attribute('size', 'float');

        // Swirl motion around flower
        const swirl = time.mul(0.5 * swirlSpeed).add(aOffset);
        const swirlRadius = time.mul(0.1).sin().mul(0.5).add(radius);

        const pos = positionLocal;
        const centerX = pos.x.sub(position.x);
        const centerZ = pos.z.sub(position.z);

        const rotatedX = centerX.mul(cos(swirl)).sub(centerZ.mul(sin(swirl)));
        const rotatedZ = centerX.mul(sin(swirl)).add(centerZ.mul(cos(swirl)));

        const floatY = time.mul(0.2 * swirlSpeed).add(aOffset).sin().mul(0.5);

        material.positionNode = vec3(
            rotatedX.add(position.x),
            pos.y.add(floatY),
            rotatedZ.add(position.z)
        );

        // Pulsing size
        const pulse = time.mul(2.0).add(aOffset).sin().mul(0.3).add(0.7);
        material.sizeNode = aSize.mul(pulse);

        material.colorNode = color(pollenColor);

        this.mesh = new THREE.Points(geometry, material);
        this.mesh.userData.type = 'pollen';
        this.mesh.position.copy(position);
    }

    public dispose(): void {
        this.mesh.geometry.dispose();
        (this.mesh.material as THREE.Material).dispose();
    }
}

/**
 * Creates a pollen cloud particle system.
 * 
 * @param config - Configuration with required position
 * @returns A pollen cloud particle system
 * 
 * @example
 * ```ts
 * const pollen = createPollenCloud({
 *     position: flowerPosition,
 *     pollenColor: 0xFFD700,
 *     radius: 3.0
 * });
 * scene.add(pollen.mesh);
 * ```
 */
export function createPollenCloud(config: PollenCloudConfig): IParticleSystem {
    return new PollenCloudSystem(config);
}

// =============================================================================
// LEAF CONFETTI PARTICLES
// =============================================================================

/**
 * Leaf confetti particle system implementation
 */
class LeafConfettiSystem implements IParticleSystem {
    public readonly type = ParticleSystemType.CONFETTI;
    public readonly mesh: THREE.Points;

    constructor(config: LeafConfettiConfig) {
        const {
            position,
            count = 150,
            leafColor = 0xFF69B4,
            spreadRadius = 5.0,
            fallSpeed = 1.0
        } = config;

        const geometry = new THREE.BufferGeometry();
        const positions = new Float32Array(count * 3);
        const sizes = new Float32Array(count);
        const offsets = new Float32Array(count);
        const rotations = new Float32Array(count);

        for (let i = 0; i < count; i++) {
            // Start above and spread out
            positions[i * 3] = position.x + (Math.random() - 0.5) * spreadRadius;
            positions[i * 3 + 1] = position.y + Math.random() * 10;
            positions[i * 3 + 2] = position.z + (Math.random() - 0.5) * spreadRadius;

            sizes[i] = Math.random() * 0.4 + 0.2;
            offsets[i] = Math.random() * 100;
            rotations[i] = Math.random() * Math.PI * 2;
        }

        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
        geometry.setAttribute('offset', new THREE.BufferAttribute(offsets, 1));
        geometry.setAttribute('rotation', new THREE.BufferAttribute(rotations, 1));

        const material = new PointsNodeMaterial({
            transparent: true,
            opacity: 0.8,
            blending: THREE.NormalBlending,
            depthWrite: false
        });

        // TSL Animation
        const aOffset = attribute('offset', 'float');
        const aSize = attribute('size', 'float');
        const aRotation = attribute('rotation', 'float');

        // Falling with wind drift
        const fall = time.mul(2.0 * fallSpeed).add(aOffset);
        const windX = time.mul(0.5 * fallSpeed).add(aOffset).sin().mul(2.0);
        const windZ = time.mul(0.7 * fallSpeed).add(aOffset).cos().mul(2.0);
        const tumbleRotation = fall.mul(3.0).add(aRotation);

        const pos = positionLocal;
        const newY = pos.y.sub(fall).mod(15.0).add(position.y - 5); // Loop falling

        material.positionNode = vec3(
            pos.x.add(windX),
            newY,
            pos.z.add(windZ)
        );

        // Tumbling size effect (simulates rotation)
        const tumble = tumbleRotation.sin().abs();
        material.sizeNode = aSize.mul(tumble.mul(0.5).add(0.5));

        // Color variation
        const colorShift = aOffset.mul(0.1).sin().mul(0.2).add(1.0);
        material.colorNode = color(leafColor).mul(colorShift);

        this.mesh = new THREE.Points(geometry, material);
        this.mesh.userData.type = 'confetti';
        this.mesh.position.copy(position);
    }

    public dispose(): void {
        this.mesh.geometry.dispose();
        (this.mesh.material as THREE.Material).dispose();
    }
}

/**
 * Creates a leaf confetti particle system.
 * 
 * @param config - Configuration with required position
 * @returns A leaf confetti particle system
 * 
 * @example
 * ```ts
 * const confetti = createLeafConfetti({
 *     position: treePosition,
 *     leafColor: 0x90EE90,
 *     count: 200
 * });
 * scene.add(confetti.mesh);
 * ```
 */
export function createLeafConfetti(config: LeafConfettiConfig): IParticleSystem {
    return new LeafConfettiSystem(config);
}

// =============================================================================
// PULSE RING PARTICLES (Audio-Reactive)
// =============================================================================

/**
 * Audio-reactive pulse ring particle system implementation
 */
class PulseRingSystem implements IParticleSystem {
    public readonly type = ParticleSystemType.PULSE_RING;
    public readonly mesh: THREE.Points;

    constructor(config: PulseRingConfig) {
        const {
            position,
            pointCount = 60,
            radius = 5.0,
            maxExpansion = 3.0
        } = config;

        const geometry = new THREE.BufferGeometry();
        const positions = new Float32Array(pointCount * 3);
        const angles = new Float32Array(pointCount);

        for (let i = 0; i < pointCount; i++) {
            const angle = (i / pointCount) * Math.PI * 2;
            positions[i * 3] = Math.cos(angle) * radius;
            positions[i * 3 + 1] = 0.1;
            positions[i * 3 + 2] = Math.sin(angle) * radius;
            angles[i] = angle;
        }

        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('angle', new THREE.BufferAttribute(angles, 1));

        const material = new PointsNodeMaterial({
            size: 0.5,
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false
        });

        // TSL Animation
        const aAngle = attribute('angle', 'float');

        // Expanding ring on pulse
        const expansion = time.mul(2.0).mod(3.0);
        const fadeOut = expansion.div(3.0).oneMinus();

        const pos = positionLocal;
        const expandedRadius = expansion.mul(maxExpansion).add(radius);

        material.positionNode = vec3(
            cos(aAngle).mul(expandedRadius),
            pos.y.add(expansion.mul(0.5)),
            sin(aAngle).mul(expandedRadius)
        );

        // Size and opacity fade with expansion (audio-reactive via uniforms)
        material.sizeNode = uPulseStrength.mul(2.0).mul(fadeOut).add(0.3);

        const finalColor = mix(color(0xFFFFFF), uPulseColor, uPulseStrength);
        material.colorNode = vec4(finalColor, fadeOut.mul(uPulseStrength));

        this.mesh = new THREE.Points(geometry, material);
        this.mesh.userData.type = 'pulseRing';
        this.mesh.position.copy(position);
    }

    public dispose(): void {
        this.mesh.geometry.dispose();
        (this.mesh.material as THREE.Material).dispose();
    }
}

/**
 * Creates an audio-reactive pulse ring particle system.
 * 
 * @param config - Configuration with required position
 * @returns A pulse ring particle system
 * 
 * @example
 * ```ts
 * const pulseRing = createPulseRing({
 *     position: new THREE.Vector3(0, 0, 0),
 *     radius: 8.0
 * });
 * scene.add(pulseRing.mesh);
 * 
 * // Update audio uniforms in animation loop:
 * updateParticleAudioUniforms({ kick: audioState.kickTrigger });
 * ```
 */
export function createPulseRing(config: PulseRingConfig): IParticleSystem {
    return new PulseRingSystem(config);
}

// =============================================================================
// HELPER: ADD AMBIENT PARTICLES
// =============================================================================

/**
 * Adds ambient particle systems to a scene.
 * 
 * @param scene - The Three.js scene to add particles to
 * @param bounds - Bounding box for particle spread
 * @returns Array of created particle systems
 * 
 * @example
 * ```ts
 * const particles = addAmbientParticles(scene, { x: 100, y: 30, z: 100 });
 * ```
 */
export function addAmbientParticles(
    scene: THREE.Scene,
    bounds: ParticleBounds = { x: 100, y: 30, z: 100 }
): IParticleSystem[] {
    const systems: IParticleSystem[] = [];

    // Add shimmer particles
    const shimmer = createShimmerParticles({ count: 1000, bounds });
    scene.add(shimmer.mesh);
    systems.push(shimmer);

    return systems;
}

/**
 * Disposes all particle systems in an array.
 * 
 * @param systems - Array of particle systems to dispose
 */
export function disposeParticleSystems(systems: IParticleSystem[]): void {
    for (const system of systems) {
        system.dispose();
    }
}
