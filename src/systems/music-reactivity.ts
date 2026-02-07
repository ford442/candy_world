import * as THREE from 'three';
import { CONFIG, CYCLE_DURATION } from '../core/config.ts';
import { animateFoliage } from '../foliage/animation.ts';
import { foliageBatcher } from '../foliage/foliage-batcher.ts';
import { arpeggioFernBatcher } from '../foliage/arpeggio-batcher.ts';
import { portamentoPineBatcher } from '../foliage/portamento-batcher.ts';
import { mushroomBatcher } from '../foliage/mushroom-batcher.ts';
import type { AudioData, FoliageObject } from '../foliage/types.ts';

// ⚡ OPTIMIZATION: Reusable Frustum & Matrices
const _frustum = new THREE.Frustum();
const _projScreenMatrix = new THREE.Matrix4();
const _scratchSphere = new THREE.Sphere(); // Reusable for Group culling checks

// ⚡ OPTIMIZATION: Reusable scratch array for species list
const _scratchSpeciesList: string[] = [];

// --- Type Definitions ---

interface MoonState {
    isBlinking: boolean;
    blinkStartTime: number;
    nextBlinkTime: number;
    baseScale: THREE.Vector3;
    dancePhase: number;
}

// Minimal interface for WeatherSystem based on usage
export interface IWeatherSystem {
    getTwilightGlowIntensity?(cyclePos: number): number;
    isNight(): boolean;
}

// Caches to prevent repeated lookups (migrated from core idea)
const _noteNameCache: Record<string | number, string> = {};
const CHROMATIC_SCALE = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export class MusicReactivitySystem {
    moon: THREE.Object3D | null = null;
    weatherSystem: IWeatherSystem | null = null;
    registeredObjects: Map<string, Set<FoliageObject>> = new Map();

    // Moon animation state
    moonState: MoonState = {
        isBlinking: false,
        blinkStartTime: 0,
        nextBlinkTime: 0,
        baseScale: new THREE.Vector3(1, 1, 1),
        dancePhase: 0
    };

    private _lastLogTime: number = 0;

    constructor() {
        this.scheduleNextBlink();
    }

    init(scene: THREE.Scene, weatherSystem: IWeatherSystem) {
        this.weatherSystem = weatherSystem;
        // Moon registration is handled explicitly via registerMoon()
    }

    registerMoon(moonMesh: THREE.Object3D) {
        if (!moonMesh) return;
        this.moon = moonMesh;
        this.moonState.baseScale.copy(moonMesh.scale);
        if (!this.moon.userData) this.moon.userData = {};
    }

    registerObject(object: FoliageObject, species: string) {
        if (!object || !species) return;
        
        if (!this.registeredObjects.has(species)) {
            this.registeredObjects.set(species, new Set());
        }
        this.registeredObjects.get(species)!.add(object);

        // Add minimal reactToNote method if it doesn't exist (fallback)
        if (!object.userData.reactToNote) {
            // Note: We assign to userData.reactToNote as a convention for some objects,
            // or directly to the object if it's a method.
            // In JS version it was `object.reactToNote`.
            // We'll stick to attaching it to the object instance, but TS might complain if it's not in FoliageObject type.
            // FoliageObject extends Object3D, which is dynamic.
            (object as any).reactToNote = (note: string, color: number, velocity: number) => {
                if (object.material && !Array.isArray(object.material) && (object.material as THREE.MeshStandardMaterial).emissive) {
                    const mat = object.material as THREE.MeshStandardMaterial;
                    const originalEmissive = object.userData.originalEmissive || mat.emissive.clone();
                    if (!object.userData.originalEmissive) object.userData.originalEmissive = originalEmissive;

                    // Simple flash
                    mat.emissive.setHex(color);
                }
            };
        }
    }

    unregisterObject(object: FoliageObject, species: string) {
        if (this.registeredObjects.has(species)) {
            this.registeredObjects.get(species)!.delete(object);
        }
    }

    // Called by AudioSystem or Main loop
    handleNoteOn(note: number | string, velocity: number, channelIndex: number) {
        const noteName = this.resolveNoteName(note);

        // Determine species to trigger based on channel
        // ⚡ OPTIMIZATION: Use scratch array to avoid GC
        const speciesList = _scratchSpeciesList;
        speciesList.length = 0;

        // Example mapping logic
        if (channelIndex === 0) speciesList.push('mushroom'); // Kick/Bass
        if (channelIndex === 1) speciesList.push('flower');   // Melody
        if (channelIndex === 2) speciesList.push('tree');     // Chords
        if (channelIndex === 3) speciesList.push('cloud');    // FX

        // Also trigger global listeners if any
        speciesList.push('global');

        // ⚡ OPTIMIZATION: Trigger Batched Systems directly
        // Mushroom Batcher handles visual reaction via InstancedMesh attributes
        const noteIdx = CHROMATIC_SCALE.indexOf(noteName);
        if (noteIdx >= 0) {
            mushroomBatcher.handleNote(noteIdx, velocity);
        }

        // ⚡ OPTIMIZATION: Use for..of loop
        for (const species of speciesList) {
            const colorMap = CONFIG.noteColorMap[species] || CONFIG.noteColorMap['global'];
            const color = colorMap[noteName] || 0xFFFFFF;

            this.triggerReaction(species, noteName, color, velocity);
        }

        // Moon reaction
        if (this.moon && CONFIG.moon.blinkOnBeat && velocity > 100) {
            this.triggerMoonBlink();
        }
    }

    resolveNoteName(note: number | string): string {
        // Check cache first (string/number key)
        if (_noteNameCache[note]) {
            return _noteNameCache[note];
        }

        let result = '';
        if (typeof note === 'number') {
            result = CHROMATIC_SCALE[note % 12];
        } else if (typeof note === 'string') {
             // Strip octave if present "C4" -> "C"
            result = note.replace(/[0-9-]/g, '');
        }

        // Cache result (limit size loosely)
        _noteNameCache[note] = result;
        return result;
    }

    triggerReaction(species: string, noteName: string, color: number, velocity: number) {
        const objects = this.registeredObjects.get(species);
        if (objects) {
            for (const obj of objects) {
                // Check for method on object (legacy/dynamic)
                if ((obj as any).reactToNote) {
                    (obj as any).reactToNote(noteName, color, velocity);
                }
            }
        }
    }

    scheduleNextBlink() {
        this.moonState.nextBlinkTime = performance.now() + CONFIG.moon.blinkInterval + (Math.random() * 2000 - 1000);
    }

    triggerMoonBlink() {
        if (this.moonState.isBlinking) return;
        this.moonState.isBlinking = true;
        this.moonState.blinkStartTime = performance.now();
    }

    update(
        time: number,
        deltaTime: number,
        audioState: AudioData | null,
        weatherSystem: IWeatherSystem,
        animatedFoliage: FoliageObject[],
        camera: THREE.Camera,
        isNight: boolean,
        isDeepNight: boolean
    ) {
        // 1. Update Moon Animation
        this.updateMoon(time, deltaTime);

        // 2. Update Twilight Glow
        this.updateTwilightGlow(time);

        // 3. Update Foliage Animation Loop
        if (animatedFoliage && camera) {
            // Update Frustum for Culling
            _projScreenMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
            _frustum.setFromProjectionMatrix(_projScreenMatrix);

            const isDay = !isNight;
            
            // ⚡ PERFORMANCE: Debug counters
            let totalObjects = 0;
            let culledByDistance = 0;
            let culledByFrustum = 0;
            let rendered = 0;

            for (let i = 0; i < animatedFoliage.length; i++) {
                const obj = animatedFoliage[i];
                if (!obj) continue;
                totalObjects++;

                // ⚡ OPTIMIZATION: Skip Batched Objects
                // Mushrooms are now handled by MushroomBatcher via TSL
                if (obj.userData.type === 'mushroom') {
                    // We treat them as rendered for metrics, but skip CPU animation logic
                    rendered++; // Technically batched, so rendered
                    continue;
                }

                // ⚡ OPTIMIZATION: Standard Flowers are now TSL-driven (merged geometry)
                if (obj.userData.isFlower) {
                     rendered++;
                     continue;
                }

                // ⚡ PERFORMANCE: Size-based culling distances
                let cullDistance = 150; // Default
                
                const objType = obj.userData.type;
                const objSize = obj.userData.size;
                const objRadius = obj.userData.radius || 2.0;
                
                if (objType === 'flower') {
                    cullDistance = 80;
                } else if (objType === 'mushroom') {
                    // Unreachable if we skip above, but kept for logic safety
                    if (objSize === 'giant') {
                        cullDistance = 200;
                    } else {
                        cullDistance = 120;
                    }
                } else if (objType === 'tree' || objType === 'shrub') {
                    cullDistance = 150;
                } else if (objType === 'cloud') {
                    cullDistance = 250;
                }

                // Distance Culling
                const distSq = obj.position.distanceToSquared(camera.position);
                if (distSq > cullDistance * cullDistance) {
                    culledByDistance++;
                    continue;
                }

                // Frustum Culling
                let isVisible = false;
                if (obj.geometry && obj.geometry.boundingSphere) {
                    isVisible = _frustum.intersectsObject(obj);
                } else {
                    _scratchSphere.center.copy(obj.position);
                    _scratchSphere.radius = objRadius;
                    // Apply approximate scale
                    if (obj.scale.x > 1.0) _scratchSphere.radius *= obj.scale.x;
                    isVisible = _frustum.intersectsSphere(_scratchSphere);
                }

                if (isVisible) {
                    rendered++;
                    // Using animateFoliage (assumed typed correctly in animation.ts)
                    animateFoliage(obj, time, audioState || {}, isDay, isDeepNight);
                } else {
                    culledByFrustum++;
                }
            }
            
            // ⚡ PERFORMANCE: Debug logging every 5 seconds
            if (!this._lastLogTime || (Date.now() - this._lastLogTime) > 5000) {
                console.log(`[MusicReactivity] Objects: ${totalObjects} | Rendered: ${rendered} | Culled (Distance): ${culledByDistance} | Culled (Frustum): ${culledByFrustum}`);
                this._lastLogTime = Date.now();
            }

            // Flush batched updates to GPU
            // Pass audioState for extended animation batching (Phase 1 migration)
            const kick = audioState?.kickTrigger || 0;
            foliageBatcher.flush(time, kick, audioState);

            // Update Arpeggio Batcher
            arpeggioFernBatcher.update(audioState);

            // Update Portamento Batcher
            portamentoPineBatcher.update(time, audioState);
        }
    }

    updateTwilightGlow(time: number) {
        if (!this.weatherSystem) return;

        // Get smooth twilight intensity (0 = day, 1 = night peak)
        const cyclePos = time % CYCLE_DURATION;
        const glowIntensity = (this.weatherSystem.getTwilightGlowIntensity)
            ? this.weatherSystem.getTwilightGlowIntensity(cyclePos)
            : 0.0;

        // ⚡ OPTIMIZATION: Removed mushroom loop.
        // TSL handles global uTwilight uniform for glow base.
        // Bioluminescence logic is now in MushroomBatcher material.
    }

    updateMoon(time: number, deltaTime: number) {
        if (!this.moon) return;

        // Only animate moon at night
        const isNight = this.weatherSystem ? this.weatherSystem.isNight() : true;

        if (!isNight) {
            this.moon.scale.copy(this.moonState.baseScale);
            return;
        }

        const now = performance.now();

        // Handle Blinking
        if (!this.moonState.isBlinking && now > this.moonState.nextBlinkTime) {
            this.triggerMoonBlink();
        }

        if (this.moonState.isBlinking) {
            const elapsed = now - this.moonState.blinkStartTime;
            const progress = elapsed / CONFIG.moon.blinkDuration;

            if (progress >= 1) {
                this.moonState.isBlinking = false;
                this.moon.scale.copy(this.moonState.baseScale);
                this.scheduleNextBlink();
            } else {
                // Simple scale blink (squash Y)
                const blinkCurve = Math.sin(progress * Math.PI);
                const scaleY = 1.0 - (blinkCurve * 0.8);

                this.moon.scale.set(
                    this.moonState.baseScale.x,
                    this.moonState.baseScale.y * scaleY,
                    this.moonState.baseScale.z
                );
            }
        }

        // Handle Dancing
        if (CONFIG.moon.danceAmplitude > 0) {
            this.moonState.dancePhase += deltaTime * CONFIG.moon.danceFrequency;
            const danceOffset = Math.sin(this.moonState.dancePhase) * CONFIG.moon.danceAmplitude;
            this.moon.rotation.z = danceOffset * 0.2; // Tilt
        }
    }
}

export const musicReactivitySystem = new MusicReactivitySystem();
