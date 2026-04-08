/**
 * @file cpu-particle-system.ts
 * @description CPU-based fallback particle system when WebGPU compute is not available
 */

import * as THREE from 'three';
import { PointsNodeMaterial } from 'three/webgpu';
import { uv, distance, vec2, vec3, smoothstep } from 'three/tsl';
import { ComputeParticleType, ComputeParticleConfig, ParticleAudioData } from './compute-particles-types.ts';

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
    
    private _scratchVector = new THREE.Vector3();
    private _scratchVector2 = new THREE.Vector3();
    private _tempColor = new THREE.Color();
    
    constructor(config: ComputeParticleConfig) {
        this.count = config.count || 10000;
        this.type = config.type;
        this.bounds = config.bounds || { x: 100, y: 20, z: 100 };
        this.center = config.center || new THREE.Vector3(0, 5, 0);
        this.sizeRange = config.sizeRange || { min: 0.1, max: 0.3 };
        
        // Initialize arrays
        this.positions = new Float32Array(this.count * 3);
        this.velocities = new Float32Array(this.count * 3);
        this.lives = new Float32Array(this.count);
        this.sizes = new Float32Array(this.count);
        this.colors = new Float32Array(this.count * 4);
        this.seeds = new Float32Array(this.count);
        
        // Initialize particles
        for (let i = 0; i < this.count; i++) {
            this.respawnParticle(i, true);
        }
        
        // Create geometry with quad for each particle (4 vertices)
        const geometry = new THREE.BufferGeometry();
        const quadPositions = new Float32Array(this.count * 4 * 3);
        const quadUvs = new Float32Array(this.count * 4 * 2);
        const quadIndices = new Uint32Array(this.count * 6);
        
        for (let i = 0; i < this.count; i++) {
            // Quad vertices (will be updated each frame)
            for (let j = 0; j < 4; j++) {
                const baseIdx = (i * 4 + j) * 3;
                quadPositions[baseIdx] = 0;
                quadPositions[baseIdx + 1] = 0;
                quadPositions[baseIdx + 2] = 0;
                
                const uvIdx = (i * 4 + j) * 2;
                quadUvs[uvIdx] = j % 2 === 0 ? 0 : 1;
                quadUvs[uvIdx + 1] = j < 2 ? 0 : 1;
            }
            
            // Indices for two triangles
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
        
        // Create material
        const material = this.createMaterial();
        
        this.mesh = new THREE.Points(geometry, material);
        this.mesh.frustumCulled = false;
        this.mesh.userData.isCPUParticles = true;
    }
    
    private respawnParticle(i: number, initial: boolean = false): void {
        const idx = i * 3;
        
        // Random position within bounds
        this.positions[idx] = (Math.random() - 0.5) * this.bounds.x + this.center.x;
        this.positions[idx + 1] = initial 
            ? Math.random() * this.bounds.y + this.center.y
            : this.center.y + this.bounds.y;
        this.positions[idx + 2] = (Math.random() - 0.5) * this.bounds.z + this.center.z;
        
        // Reset velocity based on type
        switch (this.type) {
            case 'fireflies':
                this.velocities[idx] = (Math.random() - 0.5) * 2;
                this.velocities[idx + 1] = (Math.random() - 0.5) * 0.5;
                this.velocities[idx + 2] = (Math.random() - 0.5) * 2;
                this.lives[i] = 2 + Math.random() * 4;
                break;
            case 'pollen':
                this.velocities[idx] = (Math.random() - 0.5) * 0.5;
                this.velocities[idx + 1] = (Math.random() - 0.5) * 0.2;
                this.velocities[idx + 2] = (Math.random() - 0.5) * 0.5;
                this.lives[i] = 2 + Math.random() * 4;
                break;
            case 'berries':
                this.velocities[idx] = (Math.random() - 0.5) * 3;
                this.velocities[idx + 1] = Math.random() * 2;
                this.velocities[idx + 2] = (Math.random() - 0.5) * 3;
                this.lives[i] = 3 + Math.random() * 5;
                break;
            case 'rain':
                this.velocities[idx] = (Math.random() - 0.5) * 0.5;
                this.velocities[idx + 1] = -5 - Math.random() * 3;
                this.velocities[idx + 2] = (Math.random() - 0.5) * 0.5;
                this.lives[i] = 5;
                break;
            case 'sparks':
                const angle = Math.random() * Math.PI * 2;
                const speed = 3 + Math.random() * 5;
                this.velocities[idx] = Math.cos(angle) * speed;
                this.velocities[idx + 1] = Math.random() * speed;
                this.velocities[idx + 2] = Math.sin(angle) * speed;
                this.lives[i] = 0.3 + Math.random() * 0.5;
                break;
        }
        
        this.sizes[i] = this.sizeRange.min + Math.random() * (this.sizeRange.max - this.sizeRange.min);
        this.seeds[i] = Math.random() * 1000;
        
        // Set color based on type
        this.setParticleColor(i);
    }
    
    private setParticleColor(i: number): void {
        const idx = i * 4;
        switch (this.type) {
            case 'fireflies':
                this.colors[idx] = 0.88;
                this.colors[idx + 1] = 1.0;
                this.colors[idx + 2] = 0.0;
                this.colors[idx + 3] = 1.0;
                break;
            case 'pollen':
                this.colors[idx] = 0.0;
                this.colors[idx + 1] = 1.0;
                this.colors[idx + 2] = 1.0;
                this.colors[idx + 3] = 0.8;
                break;
            case 'berries':
                this.colors[idx] = 1.0;
                this.colors[idx + 1] = 0.4;
                this.colors[idx + 2] = 0.0;
                this.colors[idx + 3] = 1.0;
                break;
            case 'rain':
                this.colors[idx] = 0.6;
                this.colors[idx + 1] = 0.8;
                this.colors[idx + 2] = 1.0;
                this.colors[idx + 3] = 0.5;
                break;
            case 'sparks':
                this.colors[idx] = 1.0;
                this.colors[idx + 1] = 1.0;
                this.colors[idx + 2] = 0.5;
                this.colors[idx + 3] = 1.0;
                break;
        }
    }
    
    private createMaterial(): THREE.Material {
        // Use TSL for consistent look with GPU version
        const material = new PointsNodeMaterial({
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending
        });
        
        // TSL-based color and effects
        const aUv = uv();
        const distFromCenter = distance(aUv, vec2(0.5));
        const alpha = smoothstep(0.5, 0.2, distFromCenter);
        
        material.opacityNode = alpha;
        
        // Type-specific coloring
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
            default:
                finalColor = vec3(1.0, 1.0, 1.0);
        }
        
        material.colorNode = finalColor;
        
        return material;
    }
    
    update(deltaTime: number, playerPosition: THREE.Vector3, audioData: ParticleAudioData): void {
        const posAttr = this.mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
        const positions = posAttr.array as Float32Array;
        
        // Update each particle
        for (let i = 0; i < this.count; i++) {
            const idx = i * 3;
            
            // Decrease life
            this.lives[i] -= deltaTime;
            
            // Respawn if dead
            if (this.lives[i] <= 0) {
                this.respawnParticle(i);
            } else {
                // Update based on type
                switch (this.type) {
                    case 'fireflies':
                        this.updateFirefly(i, deltaTime, playerPosition, audioData);
                        break;
                    case 'pollen':
                        this.updatePollen(i, deltaTime, playerPosition, audioData);
                        break;
                    case 'berries':
                        this.updateBerry(i, deltaTime);
                        break;
                    case 'rain':
                        this.updateRain(i, deltaTime, audioData);
                        break;
                    case 'sparks':
                        this.updateSpark(i, deltaTime);
                        break;
                }
            }
            
            // Update quad vertices for this particle
            this.updateQuadVertices(i, positions);
        }
        
        posAttr.needsUpdate = true;
    }
    
    private updateFirefly(i: number, deltaTime: number, playerPosition: THREE.Vector3, audioData: ParticleAudioData): void {
        const idx = i * 3;
        
        // Curl noise approximation
        const noiseX = Math.sin(this.positions[idx] * 0.1 + this.seeds[i]) * Math.cos(Date.now() * 0.001);
        const noiseY = Math.sin(this.positions[idx + 1] * 0.1 + this.seeds[i] + 10) * Math.cos(Date.now() * 0.001);
        const noiseZ = Math.sin(this.positions[idx + 2] * 0.1 + this.seeds[i] + 20) * Math.cos(Date.now() * 0.001);
        
        // Spring force to center
        const springX = (this.center.x - this.positions[idx]) * 0.5;
        const springZ = (this.center.z - this.positions[idx + 2]) * 0.5;
        
        // Player repulsion
        const toPlayerX = this.positions[idx] - playerPosition.x;
        const toPlayerY = this.positions[idx + 1] - playerPosition.y;
        const toPlayerZ = this.positions[idx + 2] - playerPosition.z;
        const distToPlayer = Math.sqrt(toPlayerX * toPlayerX + toPlayerY * toPlayerY + toPlayerZ * toPlayerZ);
        let repelStrength = Math.max(0, 5 - distToPlayer) * 10;
        
        // Apply forces
        this.velocities[idx] += (noiseX * 2 + springX + (toPlayerX / distToPlayer) * repelStrength + audioData.low * 5) * deltaTime;
        this.velocities[idx + 1] += (noiseY * 2 + (toPlayerY / distToPlayer) * repelStrength) * deltaTime;
        this.velocities[idx + 2] += (noiseZ * 2 + springZ + (toPlayerZ / distToPlayer) * repelStrength) * deltaTime;
        
        // Damping
        this.velocities[idx] *= 0.95;
        this.velocities[idx + 1] *= 0.95;
        this.velocities[idx + 2] *= 0.95;
        
        // Floor constraint
        this.positions[idx] += this.velocities[idx] * deltaTime;
        this.positions[idx + 1] += this.velocities[idx + 1] * deltaTime;
        this.positions[idx + 2] += this.velocities[idx + 2] * deltaTime;
        
        if (this.positions[idx + 1] < 0.5) {
            this.positions[idx + 1] = 0.5;
            this.velocities[idx + 1] = Math.abs(this.velocities[idx + 1]) * 0.3;
        }
    }
    
    private updatePollen(i: number, deltaTime: number, playerPosition: THREE.Vector3, audioData: ParticleAudioData): void {
        const idx = i * 3;
        
        // Wind force
        const windX = audioData.windX || 0;
        const windZ = audioData.windZ || 0;
        this.velocities[idx] += windX * 0.05 * deltaTime;
        this.velocities[idx + 2] += windZ * 0.05 * deltaTime;
        
        // Curl noise
        const noiseScale = 0.2;
        const noiseX = Math.sin(this.positions[idx] * noiseScale + Date.now() * 0.0005);
        const noiseY = Math.sin(this.positions[idx + 1] * noiseScale + Date.now() * 0.0005 + 10);
        const noiseZ = Math.sin(this.positions[idx + 2] * noiseScale + Date.now() * 0.0005 + 20);
        
        // Player repulsion
        const toPlayerX = this.positions[idx] - playerPosition.x;
        const toPlayerZ = this.positions[idx + 2] - playerPosition.z;
        const distToPlayer = Math.sqrt(toPlayerX * toPlayerX + toPlayerZ * toPlayerZ);
        const repelFactor = Math.max(0, 5 - distToPlayer) * 2;
        
        // Center attraction
        const toCenterX = this.center.x - this.positions[idx];
        const toCenterZ = this.center.z - this.positions[idx + 2];
        const distToCenter = Math.sqrt(toCenterX * toCenterX + toCenterZ * toCenterZ);
        const pullStrength = Math.max(0, distToCenter - 15) * 0.1;
        
        // Apply forces
        this.velocities[idx] += (noiseX * 0.5 + audioData.low * 2 + (toPlayerX / distToPlayer) * repelFactor + (toCenterX / distToCenter) * pullStrength) * deltaTime;
        this.velocities[idx + 1] += (noiseY * 0.5) * deltaTime;
        this.velocities[idx + 2] += (noiseZ * 0.5 + audioData.low * 2 + (toPlayerZ / distToPlayer) * repelFactor + (toCenterZ / distToCenter) * pullStrength) * deltaTime;
        
        // Damping
        this.velocities[idx] *= 0.98;
        this.velocities[idx + 1] *= 0.98;
        this.velocities[idx + 2] *= 0.98;
        
        // Update position
        this.positions[idx] += this.velocities[idx] * deltaTime;
        this.positions[idx + 1] += this.velocities[idx + 1] * deltaTime;
        this.positions[idx + 2] += this.velocities[idx + 2] * deltaTime;
        
        // Keep above water
        if (this.positions[idx + 1] < 1.8) {
            this.positions[idx + 1] = 1.8;
            this.velocities[idx + 1] = Math.abs(this.velocities[idx + 1]) * 0.3;
        }
    }
    
    private updateBerry(i: number, deltaTime: number): void {
        const idx = i * 3;
        
        // Gravity
        this.velocities[idx + 1] -= 9.8 * deltaTime;
        
        // Update position
        this.positions[idx] += this.velocities[idx] * deltaTime;
        this.positions[idx + 1] += this.velocities[idx + 1] * deltaTime;
        this.positions[idx + 2] += this.velocities[idx + 2] * deltaTime;
        
        // Ground bounce
        if (this.positions[idx + 1] < 0.3) {
            this.positions[idx + 1] = 0.3;
            this.velocities[idx + 1] = Math.abs(this.velocities[idx + 1]) * 0.5;
            this.velocities[idx] *= 0.8;
            this.velocities[idx + 2] *= 0.8;
        }
    }
    
    private updateRain(i: number, deltaTime: number, audioData: ParticleAudioData): void {
        const idx = i * 3;
        
        // Apply wind
        const windX = audioData.windX || 0;
        const windZ = audioData.windZ || 0;
        this.velocities[idx] = windX * 0.1;
        this.velocities[idx + 2] = windZ * 0.1;
        
        // Update position
        this.positions[idx] += this.velocities[idx] * deltaTime;
        this.positions[idx + 1] += this.velocities[idx + 1] * deltaTime;
        this.positions[idx + 2] += this.velocities[idx + 2] * deltaTime;
        
        // Splash on ground
        if (this.positions[idx + 1] < 0.5) {
            this.lives[i] = 0; // Die and respawn
        }
    }
    
    private updateSpark(i: number, deltaTime: number): void {
        const idx = i * 3;
        
        // Gravity (lighter than berries)
        this.velocities[idx + 1] -= 4.9 * deltaTime;
        
        // Air resistance
        this.velocities[idx] *= 0.99;
        this.velocities[idx + 1] *= 0.99;
        this.velocities[idx + 2] *= 0.99;
        
        // Update position
        this.positions[idx] += this.velocities[idx] * deltaTime;
        this.positions[idx + 1] += this.velocities[idx + 1] * deltaTime;
        this.positions[idx + 2] += this.velocities[idx + 2] * deltaTime;
    }
    
    private updateQuadVertices(i: number, positions: Float32Array): void {
        const idx = i * 3;
        const px = this.positions[idx];
        const py = this.positions[idx + 1];
        const pz = this.positions[idx + 2];
        
        // Simple billboard (camera-facing) - approximated
        const size = this.sizes[i];
        
        // Four corners of quad
        const baseIdx = i * 4 * 3;
        
        // Bottom-left
        positions[baseIdx] = px - size;
        positions[baseIdx + 1] = py - size;
        positions[baseIdx + 2] = pz;
        
        // Bottom-right
        positions[baseIdx + 3] = px + size;
        positions[baseIdx + 4] = py - size;
        positions[baseIdx + 5] = pz;
        
        // Top-left
        positions[baseIdx + 6] = px - size;
        positions[baseIdx + 7] = py + size;
        positions[baseIdx + 8] = pz;
        
        // Top-right
        positions[baseIdx + 9] = px + size;
        positions[baseIdx + 10] = py + size;
        positions[baseIdx + 11] = pz;
    }
    
    dispose(): void {
        this.mesh.geometry.dispose();
        (this.mesh.material as THREE.Material).dispose();
    }
}
