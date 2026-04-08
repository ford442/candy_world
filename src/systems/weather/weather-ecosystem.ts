// src/systems/weather/weather-ecosystem.ts
// Ecosystem management: cloud-mushroom interactions, spawning, waterfalls

import * as THREE from 'three';
import { getGroundHeight, uploadMushroomSpecs, batchMushroomSpawnCandidates, readSpawnCandidates, isWasmReady } from '../../utils/wasm-loader.js';
import { createMushroom } from '../../foliage/mushrooms.ts';
import { createLanternFlower } from '../../foliage/flowers.ts';
import { cleanupReactivity } from '../../foliage/foliage-reactivity.ts';
import { updateCloudAttraction, isCloudOverTarget } from '../../foliage/clouds.ts';
import { foliageClouds } from '../../world/state.ts';
import { replaceMushroomWithGiant } from '../../foliage/mushrooms.ts';
import { mushroomBatcher } from '../../foliage/mushroom-batcher.ts';
import { waterfallBatcher } from '../../foliage/waterfall-batcher.ts';
import { musicReactivitySystem } from '../music-reactivity.ts';
import type { WeatherSystem } from './weather.ts';

// Scratch objects for optimization
const _scratchSunDir = new THREE.Vector3();
const _scratchWaterfallPos = new THREE.Vector3();

export class EcosystemManager {
    private weatherSystem: WeatherSystem;
    private _claimedMushroomsScratch: Set<string>;
    private _lastSpawnCheck: number = 0;
    private _spawnCapPerFrame: number = 3;
    private _spawnThrottle: number = 0.5;

    constructor(weatherSystem: WeatherSystem) {
        this.weatherSystem = weatherSystem;
        this._claimedMushroomsScratch = new Set();
    }

    /**
     * Main ecosystem update loop - handles cloud-mushroom behavior
     */
    updateEcosystem(dt: number): void {
        const trackedMushrooms = this.weatherSystem.trackedMushrooms;
        
        // Only run if we have active entities
        if (!foliageClouds || foliageClouds.length === 0 || trackedMushrooms.length === 0) return;

        // TRACKING SET: Prevents multiple clouds from picking the same mushroom
        // Use scratch set + clear() instead of allocating new Set() every frame
        const claimedMushrooms = this._claimedMushroomsScratch;
        claimedMushrooms.clear();

        // 1. Register existing locks first
        for (let i = 0, len = foliageClouds.length; i < len; i++) {
            const cloud: any = foliageClouds[i];
            if (cloud.userData.targetMushroom) {
                claimedMushrooms.add(cloud.userData.targetMushroom.uuid);
            }
        }

        // 2. Process Clouds
        for (let i = 0, len = foliageClouds.length; i < len; i++) {
            const cloud: any = foliageClouds[i];
            // Skip dead/falling clouds
            if (cloud.userData.isFalling) {
                // If it had a target, we implicitly release it by not moving towards it
                cloud.userData.targetMushroom = null;
                continue;
            }

            // A. Find Target (if none)
            if (!cloud.userData.targetMushroom) {
                let minDistSq = 1000000;
                let candidate = null;

                for (let j = 0, mLen = trackedMushrooms.length; j < mLen; j++) {
                    const m = trackedMushrooms[j];
                    // Rule: Don't target if already claimed by another cloud
                    if (claimedMushrooms.has(m.uuid)) continue;

                    // Rule: Favor Small mushrooms initially to grow them
                    // But if it's already Giant, we can still latch on if we are close (permanent barrier logic)

                    const distSq = cloud.position.distanceToSquared(m.position);
                    if (distSq < 2500 && distSq < minDistSq) { // 50m scan range (50*50 = 2500)
                        minDistSq = distSq;
                        candidate = m;
                    }
                }

                if (candidate) {
                    cloud.userData.targetMushroom = candidate;
                    claimedMushrooms.add(candidate.uuid); // Claim it immediately
                }
            }

            // B. Execute Behavior
            if (cloud.userData.targetMushroom) {
                const target = cloud.userData.targetMushroom;

                // Safety check: Mushroom might have been deleted/replaced
                if (!target.parent) {
                    cloud.userData.targetMushroom = null;
                    continue;
                }

                // Steer
                updateCloudAttraction(cloud, target.position, dt);

                // Rain Logic
                if (isCloudOverTarget(cloud, target.position)) {
                    // Increase Wetness
                    if (!target.userData.wetness) target.userData.wetness = 0;
                    target.userData.wetness += dt * 1.5;

                    // Growth Threshold (~3 seconds of dedicated rain)
                    if (target.userData.wetness > 3.0 && target.userData.size !== 'giant') {
                        this.transformMushroom(target);
                    }
                }
            }
        }
    }

    /**
     * Transform a regular mushroom into a giant mushroom
     */
    transformMushroom(oldMushroom: any): void {
        const scene = this.weatherSystem.scene;
        const trackedMushrooms = this.weatherSystem.trackedMushrooms;
        const index = trackedMushrooms.indexOf(oldMushroom);
        if (index === -1) return;

        // Perform the Swap
        const newGiant = replaceMushroomWithGiant(scene, oldMushroom);

        if (newGiant) {
            // Update WeatherSystem Registry
            trackedMushrooms[index] = newGiant;

            // Critical: Update the Cloud's reference!
            // Find the cloud that was targeting the old mushroom
            for (let i = 0, len = foliageClouds.length; i < len; i++) {
                const c: any = foliageClouds[i];
                if (c.userData.targetMushroom === oldMushroom) {
                    c.userData.targetMushroom = newGiant;

                    // Lift the cloud up! Giants are tall.
                    c.position.y = Math.max(c.position.y, newGiant.position.y + 25);
                }
            }
        }
    }

    /**
     * Manage mushroom pool size - prevent unbounded growth
     */
    manageMushroomCount(): void {
        const MAX_MUSHROOMS = 150;
        const trackedMushrooms = this.weatherSystem.trackedMushrooms;
        const mushroomPool = this.weatherSystem.mushroomPool;
        const scene = this.weatherSystem.scene;

        if (trackedMushrooms.length > MAX_MUSHROOMS) {
            const toRemove = trackedMushrooms.shift(); // FIFO: Remove oldest

            if (toRemove) {
                // Remove from Scene so it doesn't double-register when pooled
                if (toRemove.parent) toRemove.parent.remove(toRemove);
                if (mushroomBatcher && mushroomBatcher.removeInstance) {
                    mushroomBatcher.removeInstance(toRemove);
                }
                cleanupReactivity(toRemove);
                if (musicReactivitySystem && musicReactivitySystem.unregisterObject) {
                    musicReactivitySystem.unregisterObject(toRemove, 'mushroom');
                }

                // Return to pool instead of disposing materials to prevent GC stutter
                if (toRemove.userData.isBioluminescent === undefined) {
                    mushroomPool.push(toRemove);
                } else {
                    // Dispose special mushrooms (e.g. Giant, Bioluminescent)
                    toRemove.traverse((child: any) => {
                        if (child.material) {
                            if (Array.isArray(child.material)) {
                                for (let i = 0; i < child.material.length; i++) {
                                    const m: any = child.material[i];
                                    if (m.userData?.isClone && m.dispose) m.dispose();
                                }
                            } else if (child.material.userData?.isClone && child.material.dispose) {
                                child.material.dispose();
                            }
                        }
                    });
                }
            }
        }
    }

    /**
     * Update mushroom waterfall particle effects
     */
    updateMushroomWaterfalls(time: number, bassIntensity: number, state: any, intensity: number, trackedMushrooms: any[], mushroomWaterfalls: Set<string>): void {
        const isRaining = state !== 'clear' && intensity > 0.4;

        for (let i = 0, len = trackedMushrooms.length; i < len; i++) {
            const mushroom = trackedMushrooms[i];
            if (mushroom.userData.size === 'giant') {
                const uuid = mushroom.uuid;

                if (isRaining) {
                    if (!mushroomWaterfalls.has(uuid)) {
                        const radius = mushroom.userData.capRadius || 5.0;
                        const height = mushroom.userData.capHeight || 8.0;
                        
                        // Use scratch vectors
                        _scratchSunDir.set(mushroom.position.x + radius * 0.8, height * 0.8, mushroom.position.z);
                        _scratchWaterfallPos.set(mushroom.position.x + radius * 0.8, height * 0.8, mushroom.position.z);

                        // Add to batcher
                        waterfallBatcher.add(uuid, _scratchSunDir, height * 0.8, 2.0);
                        waterfallBatcher.add(uuid, _scratchWaterfallPos, height * 0.8, 2.0);
                        mushroomWaterfalls.add(uuid);
                    }

                    if (bassIntensity > 0.5) {
                        waterfallBatcher.updateInstance(uuid, 1.0 + bassIntensity * 0.1);
                    }
                } else {
                    if (mushroomWaterfalls.has(uuid)) {
                        waterfallBatcher.remove(uuid);
                        mushroomWaterfalls.delete(uuid);
                    }
                }
            }
        }
    }

    /**
     * Handle spawning logic based on favorability scores
     */
    handleSpawning(time: number, fungiScore: number, lanternScore: number, globalLight: number, onSpawnFoliage: ((object: any, isNew: boolean, duration: number) => void) | null): void {
        if (time - this._lastSpawnCheck < this._spawnThrottle) return;
        this._lastSpawnCheck = time;

        if (fungiScore > 0.8) {
            if (Math.random() < 0.4) this.spawnFoliage('mushroom', true, onSpawnFoliage);
        }
        if (lanternScore > 0.6) {
            if (Math.random() < 0.3) this.spawnFoliage('lantern', false, onSpawnFoliage);
        }
        if (globalLight > 0.7 && fungiScore < 0.3) {
             if (Math.random() < 0.2) this.spawnFoliage('flower', false, onSpawnFoliage);
        }
    }

    /**
     * Spawn a single foliage object
     */
    spawnFoliage(type: string, isGlowing: boolean, onSpawnFoliage: ((object: any, isNew: boolean, duration: number) => void) | null): void {
        if (!onSpawnFoliage) return;

        const x = (Math.random() - 0.5) * 60;
        const z = (Math.random() - 0.5) * 60;
        const y = getGroundHeight(x, z);

        let object;
        if (type === 'mushroom') {
            object = createMushroom({
                size: 'regular',
                scale: 0.5 + Math.random() * 0.5,
                isBioluminescent: isGlowing
            });
        } else if (type === 'lantern') {
            object = createLanternFlower({
                height: 2.0 + Math.random() * 1.5,
                color: 0xFFaa00
            });
        }

        if (object) {
            object.position.set(x, y, z);
            object.scale.setScalar(0.01);
            onSpawnFoliage(object, true, 0);
            if (type === 'mushroom') {
                this.weatherSystem.registerMushroom(object);
                this.manageMushroomCount();
            }
            if (type === 'lantern') this.weatherSystem.registerFlower(object);
        }
    }

    /**
     * Handle wind-based mushroom spawning
     */
    handleWindSpawning(
        time: number,
        windSpeed: number,
        windDirection: THREE.Vector3,
        trackedMushrooms: any[],
        mushroomPool: any[],
        onSpawnFoliage: ((object: any, isNew: boolean, duration: number) => void) | null,
        scene: THREE.Scene
    ): void {
        const count = trackedMushrooms.length;
        if (windSpeed > 0.4 && count > 0) {
            if (time - this._lastSpawnCheck > this._spawnThrottle) {
                this._lastSpawnCheck = time;

                if (!isWasmReady() || typeof batchMushroomSpawnCandidates !== 'function') {
                    this.spawnMushroomsJS(windSpeed, windDirection, trackedMushrooms, mushroomPool, onSpawnFoliage, scene);
                } else {
                    this.spawnMushroomsWASM(time, windDirection, windSpeed, count, trackedMushrooms, mushroomPool, onSpawnFoliage, scene);
                }
            }
        }
    }

    private spawnMushroomsJS(
        windSpeed: number,
        windDirection: THREE.Vector3,
        trackedMushrooms: any[],
        mushroomPool: any[],
        onSpawnFoliage: ((object: any, isNew: boolean, duration: number) => void) | null,
        scene: THREE.Scene
    ): void {
        let spawned = 0;
        for (let i = 0; i < trackedMushrooms.length && spawned < this._spawnCapPerFrame; i++) {
            const m = trackedMushrooms[i];
            const colorIndex = m.userData?.colorIndex ?? -1;
            const colorWeight = (colorIndex >= 0 && colorIndex <= 3) ? 0.02 : 0.005;
            const spawnChance = colorWeight * windSpeed;
            if (Math.random() < spawnChance) {
                const distance = 3 + Math.random() * 8;
                const jitter = 2 + Math.random() * 3;
                const nx = m.position.x + windDirection.x * distance + (Math.random() - 0.5) * jitter;
                const nz = m.position.z + windDirection.z * distance + (Math.random() - 0.5) * jitter;
                const ny = getGroundHeight(nx, nz);
                let newM;
                if (mushroomPool.length > 0) {
                    newM = mushroomPool.pop();
                    newM.visible = true;
                    newM.scale.setScalar(0.7);
                    newM.userData.colorIndex = colorIndex;
                } else {
                    newM = createMushroom({ size: 'regular', scale: 0.7, colorIndex: colorIndex });
                }
                newM.position.set(nx, ny, nz);
                newM.rotation.y = Math.random() * Math.PI * 2;
                if (onSpawnFoliage) {
                    try { onSpawnFoliage(newM, true, 0.5); } catch (e) {}
                } else {
                    if (!newM.parent) scene.add(newM);
                    this.weatherSystem.registerMushroom(newM);
                }
                this.manageMushroomCount();
                spawned++;
            }
        }
    }

    private spawnMushroomsWASM(
        time: number,
        windDirection: THREE.Vector3,
        windSpeed: number,
        count: number,
        trackedMushrooms: any[],
        mushroomPool: any[],
        onSpawnFoliage: ((object: any, isNew: boolean, duration: number) => void) | null,
        scene: THREE.Scene
    ): void {
        try {
            uploadMushroomSpecs(trackedMushrooms);
            const spawnThreshold = 1.0;
            const minDistance = 3.0;
            const maxDistance = 8.0;
            const candidateCount = batchMushroomSpawnCandidates(time, windDirection.x, windDirection.z, windSpeed, count, spawnThreshold, minDistance, maxDistance);
            if (candidateCount > 0) {
                const candidates = readSpawnCandidates(candidateCount);
                let spawned = 0;
                for (const c of candidates) {
                    if (spawned >= this._spawnCapPerFrame) break;
                    let newM;
                    if (mushroomPool.length > 0) {
                        newM = mushroomPool.pop();
                        newM.visible = true;
                        newM.scale.setScalar(0.7);
                        newM.userData.colorIndex = c.colorIndex;
                    } else {
                        newM = createMushroom({ size: 'regular', scale: 0.7, colorIndex: c.colorIndex });
                    }
                    newM.position.set(c.x, c.y, c.z);
                    newM.rotation.y = Math.random() * Math.PI * 2;
                    if (onSpawnFoliage) {
                        try { onSpawnFoliage(newM, true, 0.5); } catch (e) {}
                    } else {
                        if (!newM.parent) scene.add(newM);
                        this.weatherSystem.registerMushroom(newM);
                    }
                    this.manageMushroomCount();
                    spawned++;
                }
            }
        } catch (e) {
            console.warn('WASM spawn path failed, falling back to JS:', e);
        }
    }
}
