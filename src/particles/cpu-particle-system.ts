/**
 * @file cpu-particle-system.ts
 * @description CPU-based fallback particle system when WebGPU compute is not available
 */

import * as THREE from 'three';
import { PointsNodeMaterial } from 'three/webgpu';
import { uv, distance, vec2, vec3, smoothstep, sin, float, mix, color, Fn } from 'three/tsl';
import { uTime, uAudioHigh } from '../foliage/material-core.ts';
import { gemCanopyNoteColorNode, BiomeUniforms } from '../systems/biome-uniforms.ts';
import { ComputeParticleType, ComputeParticleConfig, ParticleAudioData } from './compute-particles-types.ts';
import {
    respawnCpuParticle,
    simulateCpuParticles,
    type CpuParticleBuffers,
    type CpuParticleSimParams,
} from './cpu-particle-simulate.ts';
import { isEmscriptenReady } from '../utils/wasm-loader-core.ts';
import { updateCpuParticlesNative } from '../utils/wasm-particles-cpp.ts';

/**
 * CPU-based fallback when WebGPU compute is not available
 * Simulates the same behavior on the CPU for compatibility
 */
export class CPUParticleSystem {
    public mesh: THREE.Points;
    private positions: Float32Array;
    private velocities: Float32Array;
    private lives: Float32Array;
    private sizes: Float32Array;
    private colors: Float32Array;
    private seeds: Float32Array;
    private count: number;
    private type: ComputeParticleType;
    private bounds: { x: number; y: number; z: number };
    private center: THREE.Vector3;
    private sizeRange: { min: number; max: number };
    private buffers: CpuParticleBuffers;

    constructor(config: ComputeParticleConfig) {
        this.count = config.count || 10000;
        this.type = config.type;
        this.bounds = config.bounds || { x: 100, y: 20, z: 100 };
        this.center = config.center || new THREE.Vector3(0, 5, 0);
        this.sizeRange = config.sizeRange || { min: 0.1, max: 0.3 };

        this.positions = new Float32Array(this.count * 3);
        this.velocities = new Float32Array(this.count * 3);
        this.lives = new Float32Array(this.count);
        this.sizes = new Float32Array(this.count);
        this.colors = new Float32Array(this.count * 4);
        this.seeds = new Float32Array(this.count);
        this.buffers = {
            positions: this.positions,
            velocities: this.velocities,
            lives: this.lives,
            sizes: this.sizes,
            colors: this.colors,
            seeds: this.seeds,
        };

        const respawnParams = this.getRespawnParams();
        for (let i = 0; i < this.count; i++) {
            respawnCpuParticle(this.buffers, respawnParams, i, true);
        }

        const geometry = new THREE.BufferGeometry();
        const quadPositions = new Float32Array(this.count * 4 * 3);
        const quadUvs = new Float32Array(this.count * 4 * 2);
        const quadIndices = new Uint32Array(this.count * 6);

        for (let i = 0; i < this.count; i++) {
            for (let j = 0; j < 4; j++) {
                const baseIdx = (i * 4 + j) * 3;
                quadPositions[baseIdx] = 0;
                quadPositions[baseIdx + 1] = 0;
                quadPositions[baseIdx + 2] = 0;

                const uvIdx = (i * 4 + j) * 2;
                quadUvs[uvIdx] = j % 2 === 0 ? 0 : 1;
                quadUvs[uvIdx + 1] = j < 2 ? 0 : 1;
            }

            const idxBase = i * 6;
            quadIndices[idxBase] = i * 4;
            quadIndices[idxBase + 1] = i * 4 + 1;
            quadIndices[idxBase + 2] = i * 4 + 2;
            quadIndices[idxBase + 3] = i * 4 + 1;
            quadIndices[idxBase + 4] = i * 4 + 3;
            quadIndices[idxBase + 5] = i * 4 + 2;
        }

        geometry.setAttribute('position', new THREE.BufferAttribute(quadPositions, 3));
        geometry.setAttribute('uv', new THREE.BufferAttribute(quadUvs, 2));
        geometry.setIndex(new THREE.BufferAttribute(quadIndices, 1));

        const material = this.createMaterial();

        this.mesh = new THREE.Points(geometry, material);
        this.mesh.frustumCulled = false;
        this.mesh.userData.isCPUParticles = true;
        if (this.type === 'gem_sparks') {
            this.mesh.renderOrder = -10;
        }
    }

    private getRespawnParams() {
        return {
            type: this.type,
            centerX: this.center.x,
            centerY: this.center.y,
            centerZ: this.center.z,
            boundsX: this.bounds.x,
            boundsY: this.bounds.y,
            boundsZ: this.bounds.z,
            sizeMin: this.sizeRange.min,
            sizeMax: this.sizeRange.max,
        };
    }

    private buildSimParams(
        deltaTime: number,
        playerPosition: THREE.Vector3,
        audioData: ParticleAudioData,
        now: number
    ): CpuParticleSimParams {
        return {
            type: this.type,
            count: this.count,
            deltaTime,
            centerX: this.center.x,
            centerY: this.center.y,
            centerZ: this.center.z,
            boundsX: this.bounds.x,
            boundsY: this.bounds.y,
            boundsZ: this.bounds.z,
            sizeMin: this.sizeRange.min,
            sizeMax: this.sizeRange.max,
            playerX: playerPosition.x,
            playerY: playerPosition.y,
            playerZ: playerPosition.z,
            audioLow: audioData.low,
            audioHigh: audioData.high || 0,
            windX: audioData.windX || 0,
            windZ: audioData.windZ || 0,
            timeOffsetFirefly: Math.cos(now * 0.001),
            timeOffsetPollen: now * 0.0005,
            timeSec: now * 0.001,
        };
    }

    private createMaterial(): THREE.Material {
        const material = new PointsNodeMaterial({
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending
        });

        const aUv = uv();
        const distFromCenter = distance(aUv, vec2(0.5));
        const alpha = smoothstep(0.5, 0.2, distFromCenter);

        material.opacityNode = alpha;

        let finalColor;
        switch (this.type) {
            case 'fireflies':
                finalColor = vec3(0.88, 1.0, 0.0);
                break;
            case 'pollen':
                finalColor = vec3(0.0, 1.0, 1.0);
                break;
            case 'berries':
                finalColor = vec3(1.0, 0.4, 0.0);
                break;
            case 'rain':
                finalColor = vec3(0.6, 0.8, 1.0);
                break;
            case 'sparks':
                finalColor = vec3(1.0, 0.9, 0.5);
                break;
            case 'gem_sparks':
                material.colorNode = Fn(() => {
                    const jewelRuby = color(0xE0115F);
                    const jewelSapphire = color(0x0F52BA);
                    const jewelAmethyst = color(0x9966CC);
                    const baseJewel = mix(jewelRuby, mix(jewelSapphire, jewelAmethyst, float(0.5)));
                    const musicTint = mix(baseJewel, gemCanopyNoteColorNode, BiomeUniforms.gemCanopy.shimmer);
                    const beatBoost = uAudioHigh.mul(0.5).add(1.0);
                    return musicTint.mul(beatBoost);
                })();
                return material;
            default:
                finalColor = vec3(1.0, 1.0, 1.0);
        }

        material.colorNode = finalColor;

        return material;
    }

    update(deltaTime: number, playerPosition: THREE.Vector3, audioData: ParticleAudioData): void {
        const posAttr = this.mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
        const quadPositions = posAttr.array as Float32Array;
        const now = Date.now();
        const simParams = this.buildSimParams(deltaTime, playerPosition, audioData, now);

        if (isEmscriptenReady() && updateCpuParticlesNative(this.buffers, simParams)) {
            // Native path handled simulation; only expand quads below.
        } else {
            simulateCpuParticles(this.buffers, simParams);
        }

        for (let i = 0; i < this.count; i++) {
            this.updateQuadVertices(i, quadPositions);
        }

        posAttr.needsUpdate = true;
    }

    private updateQuadVertices(i: number, positions: Float32Array): void {
        const idx = i * 3;
        const px = this.positions[idx];
        const py = this.positions[idx + 1];
        const pz = this.positions[idx + 2];
        const size = this.sizes[i];
        const baseIdx = i * 4 * 3;

        positions[baseIdx] = px - size;
        positions[baseIdx + 1] = py - size;
        positions[baseIdx + 2] = pz;

        positions[baseIdx + 3] = px + size;
        positions[baseIdx + 4] = py - size;
        positions[baseIdx + 5] = pz;

        positions[baseIdx + 6] = px - size;
        positions[baseIdx + 7] = py + size;
        positions[baseIdx + 8] = pz;

        positions[baseIdx + 9] = px + size;
        positions[baseIdx + 10] = py + size;
        positions[baseIdx + 11] = pz;
    }

    dispose(): void {
        this.mesh.geometry.dispose();
        (this.mesh.material as THREE.Material).dispose();
    }
}
