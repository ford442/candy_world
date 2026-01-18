// src/systems/music-reactivity.js
import * as THREE from 'three';
import { CONFIG, CYCLE_DURATION } from '../core/config.js';
import { animateFoliage } from '../foliage/animation.ts';
import { foliageBatcher } from '../foliage/foliage-batcher.ts';
import { arpeggioFernBatcher } from '../foliage/arpeggio-batcher.ts';

// ⚡ OPTIMIZATION: Reusable Frustum
const _frustum = new THREE.Frustum();
const _projScreenMatrix = new THREE.Matrix4();

class MusicReactivitySystem {
    constructor() {
        this.moon = null;
        this.weatherSystem = null;
        this.registeredObjects = new Map(); // Map<species, Set<Object3D>>

        // Moon animation state
        this.moonState = {
            isBlinking: false,
            blinkStartTime: 0,
            nextBlinkTime: 0,
            baseScale: new THREE.Vector3(1, 1, 1),
            dancePhase: 0
        };

        this.scheduleNextBlink();
    }

    init(scene, weatherSystem) {
        this.weatherSystem = weatherSystem;
        // Moon registration is now handled explicitly via registerMoon() from main.js
    }

    registerMoon(moonMesh) {
        if (!moonMesh) return;
        this.moon = moonMesh;
        this.moonState.baseScale.copy(moonMesh.scale);
        // Ensure moon has userData for animation if needed
        if (!this.moon.userData) this.moon.userData = {};
    }

    registerObject(object, species) {
        if (!object || !species) return;
        
        if (!this.registeredObjects.has(species)) {
            this.registeredObjects.set(species, new Set());
        }
        this.registeredObjects.get(species).add(object);

        // Add minimal reactToNote method if it doesn't exist (as a fallback)
        if (!object.reactToNote) {
            object.reactToNote = (note, color, velocity) => {
                if (object.material && object.material.emissive) {
                    const originalEmissive = object.userData.originalEmissive || object.material.emissive.clone();
                    if (!object.userData.originalEmissive) object.userData.originalEmissive = originalEmissive;

                    // Simple flash
                    object.material.emissive.setHex(color);
                }
            };
        }
    }

    unregisterObject(object, species) {
        if (this.registeredObjects.has(species)) {
            this.registeredObjects.get(species).delete(object);
        }
    }

    // Called by AudioSystem or Main loop
    handleNoteOn(note, velocity, channelIndex) {
        // Normalize note to A-G# format if needed, or assume 'note' is string like "C4"
        // If note is MIDI number, convert to string
        let noteName = note;
        if (typeof note === 'number') {
            const notes = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
            noteName = notes[note % 12];
        } else if (typeof note === 'string') {
            // Strip octave if present "C4" -> "C"
            noteName = note.replace(/[0-9-]/g, '');
        }

        // Determine species to trigger based on channel or other logic
        // For now, let's trigger 'mushroom' for bass/drums, 'flower' for melody
        // This mapping logic can be expanded
        let speciesList = [];

        // Example mapping logic
        if (channelIndex === 0) speciesList.push('mushroom'); // Kick/Bass
        if (channelIndex === 1) speciesList.push('flower');   // Melody
        if (channelIndex === 2) speciesList.push('tree');     // Chords
        if (channelIndex === 3) speciesList.push('cloud');    // FX

        // Also trigger global listeners if any
        speciesList.push('global');

        speciesList.forEach(species => {
            const colorMap = CONFIG.noteColorMap[species] || CONFIG.noteColorMap['global'];
            const color = colorMap[noteName] || 0xFFFFFF;

            this.triggerReaction(species, noteName, color, velocity);
        });

        // Moon reaction (optional, e.g. blink on specific notes)
        if (this.moon && CONFIG.moon.blinkOnBeat && velocity > 100) {
            this.triggerMoonBlink();
        }
    }

    triggerReaction(species, noteName, color, velocity) {
        const objects = this.registeredObjects.get(species);
        if (objects) {
            objects.forEach(obj => {
                if (obj.reactToNote) {
                    obj.reactToNote(noteName, color, velocity);
                }
            });
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

    update(time, deltaTime, audioState, weatherSystem, animatedFoliage, camera, isNight, isDeepNight) {
        // 1. Update Moon Animation
        this.updateMoon(time, deltaTime);

        // 2. Update Twilight Glow
        this.updateTwilightGlow(time);

        // 3. Update Foliage Animation Loop (Restored)
        // This handles wind, wiggles, bounces, etc.
        if (animatedFoliage && camera) {
            // Update Frustum for Culling
            _projScreenMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
            _frustum.setFromProjectionMatrix(_projScreenMatrix);

            const isDay = !isNight;

            for (let i = 0; i < animatedFoliage.length; i++) {
                const obj = animatedFoliage[i];
                if (!obj) continue;

                // Frustum Culling (Performance)
                // Skip if not visible, but allow some margin for large objects
                // Simple check: distance to camera < 150 (render distance)
                // Or use frustum check
                const distSq = obj.position.distanceToSquared(camera.position);
                if (distSq > 150 * 150) { // 150m cull distance
                    continue;
                }

                // If in frustum (approx)
                if (_frustum.intersectsObject(obj)) {
                    animateFoliage(obj, time, audioState, isDay, isDeepNight);
                }
            }

            // Flush batched updates to GPU
            foliageBatcher.flush(camera, time);

            // Update Arpeggio Batcher
            arpeggioFernBatcher.update();
        }
    }

    updateTwilightGlow(time) {
        if (!this.weatherSystem) return;

        // Get smooth twilight intensity (0 = day, 1 = night peak)
        // We use weatherSystem.getTwilightGlowIntensity if available, or fallback
        const cyclePos = time % CYCLE_DURATION;
        const glowIntensity = this.weatherSystem.getTwilightGlowIntensity
            ? this.weatherSystem.getTwilightGlowIntensity(cyclePos)
            : 0.0;

        // Iterate over registered objects that might have glow capabilities
        // For now, specifically handling Mushrooms with 'glowLight'
        const mushrooms = this.registeredObjects.get('mushroom');
        if (mushrooms) {
            mushrooms.forEach(mushroom => {
                if (mushroom.userData.isBioluminescent && mushroom.userData.glowLight) {
                    const light = mushroom.userData.glowLight;
                    // Base target intensity for night glow
                    const baseTarget = 0.8 * glowIntensity;

                    const current = light.intensity;

                    if (current > baseTarget) {
                        // Decay down to base
                        light.intensity = THREE.MathUtils.lerp(current, baseTarget, 0.1);
                    } else {
                        // Ramp up to base
                        light.intensity = THREE.MathUtils.lerp(current, baseTarget, 0.05);
                    }
                }
            });
        }
    }

    updateMoon(time, deltaTime) {
        if (!this.moon) return;

        // Only animate moon at night
        const isNight = this.weatherSystem ? this.weatherSystem.isNight() : true;

        if (!isNight) {
            // Reset to base state if day
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
                // 0 -> 0.1 -> 1.0 (squash down then up)
                // A quick blink might be a scale down on Y
                const blinkCurve = Math.sin(progress * Math.PI);
                const scaleY = 1.0 - (blinkCurve * 0.8); // Squash to 20% height

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
            // Optionally bob position if needed, but rotation is safer for simple mesh
        }
    }
}

export const musicReactivitySystem = new MusicReactivitySystem();
