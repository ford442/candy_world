// src/foliage/animation.ts

import * as THREE from 'three';
import { freqToHue } from '../utils/wasm-loader.js';
import { reactiveMaterials, _foliageReactiveColor, median } from './common.js';
import { CONFIG } from '../core/config.js';
import { FoliageObject, AudioData, FoliageMaterial, ChannelData } from './types.js';
import { updateArpeggio } from './arpeggio.js';
import { foliageBatcher } from './foliage-batcher.js';

export * from './types.js';

// ⚡ OPTIMIZATION: Shared scratch variables to prevent GC in hot loops
const _scratchOne = new THREE.Vector3(1, 1, 1);
const _scratchWhite = new THREE.Color(0xFFFFFF);

export function triggerGrowth(plants: FoliageObject[], intensity: number): void {
    plants.forEach(plant => {
        // Initialize baseline scales if not present
        if (plant.userData.initialScale === undefined) {
            plant.userData.initialScale = plant.scale.x;
        }
        
        // Set limits if not already defined
        if (!plant.userData.maxScale) {
            // Mushrooms can grow larger (2.5x), others standard (1.5x)
            const growthFactor = plant.userData.type === 'mushroom' ? 2.5 : 1.5;
            plant.userData.maxScale = plant.userData.initialScale * growthFactor;
        }

        if (!plant.userData.minScale) {
            // Allow shrinking to 50% of original size
            plant.userData.minScale = plant.userData.initialScale * 0.5;
        }

        const currentScale = plant.scale.x;
        const growthRate = intensity * 0.01;
        let nextScale = currentScale + growthRate;

        // Apply Limits
        if (growthRate > 0) {
            // Growing
            if (nextScale > plant.userData.maxScale) nextScale = plant.userData.maxScale;
        } else {
            // Shrinking
            if (nextScale < plant.userData.minScale) nextScale = plant.userData.minScale;
        }

        // Apply scale if changed
        if (Math.abs(nextScale - currentScale) > 0.0001) {
            plant.scale.setScalar(nextScale);
        }
    });
}

export function triggerBloom(flowers: FoliageObject[], intensity: number): void {
    flowers.forEach(flower => {
        if (flower.userData.type === 'flower') {
             if (flower.userData.isFlower || flower.userData.type === 'flower') {
                if (!flower.userData.maxBloom) {
                    flower.userData.maxBloom = flower.scale.x * 1.3;
                }

                if (flower.scale.x < flower.userData.maxBloom) {
                    const bloomRate = intensity * 0.02;
                    flower.scale.addScalar(bloomRate);
                }
             }
        }
    });
}

function applyWetEffect(material: FoliageMaterial, wetAmount: number): void {
    if (material.userData.dryRoughness === undefined) {
        material.userData.dryRoughness = material.roughness || 0.5;
        material.userData.dryMetalness = material.metalness || 0;
        if (material.color) {
            material.userData.dryColor = material.color.clone();
        }
    }

    if (material.roughness !== undefined && material.userData.dryRoughness !== undefined) {
        const targetRoughness = THREE.MathUtils.lerp(material.userData.dryRoughness, 0.2, wetAmount);
        material.roughness = targetRoughness;
    }

    if (material.metalness !== undefined && material.userData.dryMetalness !== undefined) {
        const targetMetalness = THREE.MathUtils.lerp(material.userData.dryMetalness, 0.15, wetAmount);
        material.metalness = targetMetalness;
    }

    if (material.color && material.userData.dryColor) {
        const darkColor = material.userData.dryColor.clone().multiplyScalar(1 - wetAmount * 0.3);
        material.color.lerp(darkColor, 0.1);
    }
}

export function updateMaterialsForWeather(materials: FoliageMaterial[], weatherState: string | null, weatherIntensity: number): void {
    materials.forEach(mat => {
        // Basic check if it's a material
        if (!mat || !(mat as any).isMaterial) return;

        let wetAmount = 0;

        if (weatherState === 'rain') {
            wetAmount = weatherIntensity * 0.5;
        } else if (weatherState === 'storm') {
            wetAmount = weatherIntensity * 0.8;
        }

        applyWetEffect(mat, wetAmount);
    });
}

export function updateFoliageMaterials(audioData: AudioData | null, isNight: boolean, weatherState: string | null = null, weatherIntensity: number = 0): void {
    if (!audioData) return;

    if (isNight) {
        const channels = audioData.channelData;
        if (channels && channels.length > 0) {
            // Cast reactiveMaterials to FoliageMaterial[]
            (reactiveMaterials as unknown as FoliageMaterial[]).forEach((mat, i) => {
                const chIndex = (i % 4) + 1;
                const ch = channels[Math.min(chIndex, channels.length - 1)];

                if (ch && ch.freq > 0) {
                    const hue = freqToHue(ch.freq);
                    _foliageReactiveColor.setHSL(hue, 1.0, 0.6);

                    // Check material type using 'type' string or property presence
                    if ((mat as any).isMeshBasicMaterial && mat.color) {
                        mat.color.lerp(_foliageReactiveColor, 0.3);
                    } else if (mat.emissive) {
                        mat.emissive.lerp(_foliageReactiveColor, 0.3);
                    }
                }
                const intensity = 0.2 + (ch?.volume || 0) + (ch?.trigger || 0) * 2.0;

                if (!(mat as any).isMeshBasicMaterial && mat.emissiveIntensity !== undefined) {
                     mat.emissiveIntensity = intensity;
                }
            });
        }
    } else {
        (reactiveMaterials as unknown as FoliageMaterial[]).forEach(mat => {
            if (mat.emissive) {
                mat.emissive.setHex(0x000000);
                mat.emissiveIntensity = 0;
            }
        });
    }

    if (weatherState && weatherIntensity > 0) {
        updateMaterialsForWeather(reactiveMaterials as unknown as FoliageMaterial[], weatherState, weatherIntensity);
    }
}

// @perf-migrate {target: "asc", reason: "hot-loop-math", threshold: "3ms", note: "Iterates over thousands of reactive objects every frame"}
export function animateFoliage(foliageObject: FoliageObject, time: number, audioData: AudioData | null, isDay: boolean, isDeepNight: boolean = false): void {
    const offset = foliageObject.userData.animationOffset || 0;
    const type = foliageObject.userData.animationType;

    // --- Per-note flash application (emissive/color) with automatic fade-back ---
    const reactive = foliageObject.userData.reactiveMeshes;
    
    // Fast path: skip material updates if no reactive meshes
    if (reactive && reactive.length > 0) {
        // Check if any child has active flash or needs fade back to avoid unnecessary iteration
        let hasActiveFlash = false;
        let needsFadeBack = false;
        for (let i = 0; i < reactive.length; i++) {
            const child = reactive[i];
            if ((child.userData.flashIntensity || 0) > 0) {
                hasActiveFlash = true;
            }
            if (child.userData._needsFadeBack) {
                needsFadeBack = true;
            }
            if (hasActiveFlash && needsFadeBack) break; // Early exit if we found both
        }
        
        // Only update materials if there's an active flash or we need to fade back
        if (hasActiveFlash || needsFadeBack) {
            for (let i = 0; i < reactive.length; i++) {
                const child = reactive[i];
                let fi = child.userData.flashIntensity || 0;
                const decay = child.userData.flashDecay ?? 0.05;
                // Normalize materials to array
                const mats: FoliageMaterial[] = Array.isArray(child.material) ? (child.material as FoliageMaterial[]) : (child.material ? [child.material as FoliageMaterial] : []);

                if (fi > 0) {
                    const fc = child.userData.flashColor || _scratchWhite;
                    for (const mat of mats) {
                        if (!mat) continue;
                        // stronger blend for higher intensity; immediate override when very strong
                        const t = Math.min(1, fi * 1.2) * 0.8;

                        if ((mat as any).isMeshBasicMaterial && mat.color) {
                            if (fi > 0.7) mat.color.copy(fc);
                            else mat.color.lerp(fc, t);
                        } else if (mat.emissive) {
                            if (fi > 0.7) mat.emissive.copy(fc);
                            else mat.emissive.lerp(fc, t);
                            // ensure visible intensity (min floor) scaled by global flashScale
                            mat.emissiveIntensity = Math.max(0.2, fi * ((CONFIG as any).flashScale || 2.0));
                        }
                    }

                    // decay flash intensity
                    child.userData.flashIntensity = Math.max(0, fi - decay);
                    if (child.userData.flashIntensity === 0) {
                        // keep base colors in place and allow fade-back logic to run next frame
                        delete child.userData.flashColor;
                        delete child.userData.flashDecay;
                        child.userData._needsFadeBack = true; // Mark this specific child for fade-back
                    }
                } else if (child.userData._needsFadeBack) {
                    // No active flash: smoothly fade materials back to their stored base colors/emissives
                    const fadeT = (CONFIG as any).reactivity?.fadeSpeed ?? 0.06;
                    const snapThreshold = (CONFIG as any).reactivity?.fadeSnapThreshold ?? 0.06;
                    const snapThresholdSq = snapThreshold * snapThreshold; // Avoid sqrt in distance check
                    let allFadedBack = true;
                    
                    for (const mat of mats) {
                        if (!mat) continue;
                        if ((mat as any).isMeshBasicMaterial) {
                            if (mat.userData && mat.userData.baseColor && mat.color) {
                                const distSq = mat.color.distanceToSquared(mat.userData.baseColor);
                                if (distSq > snapThresholdSq) {
                                    mat.color.lerp(mat.userData.baseColor, fadeT);
                                    allFadedBack = false;
                                } else {
                                    mat.color.copy(mat.userData.baseColor);
                                }
                            }
                        } else if (mat.emissive) {
                            if (mat.userData && mat.userData.baseEmissive) {
                                mat.emissive.lerp(mat.userData.baseEmissive, fadeT);
                            }
                            // lerp emissiveIntensity back toward 0
                            const current = mat.emissiveIntensity || 0;
                            if (current > snapThreshold) {
                                mat.emissiveIntensity = THREE.MathUtils.lerp(current, 0, fadeT);
                                allFadedBack = false;
                            } else {
                                // If intensity is very low, snap back to base to avoid residual tint
                                if (mat.userData && mat.userData.baseEmissive) {
                                    mat.emissive.copy(mat.userData.baseEmissive);
                                }
                                mat.emissiveIntensity = 0;
                            }
                        }
                    }
                    
                    // Clear fade back flag when all materials have returned to base
                    if (allFadedBack) {
                        child.userData._needsFadeBack = false;
                    }
                }
            }
        }
    }

    // --- Mushroom Night Glow Animation (Bioluminescence) ---
    // Animate the glow light intensity for mushrooms with bioluminescence
    if (foliageObject.userData.glowLight && foliageObject.userData.isBioluminescent) {
        const light = foliageObject.userData.glowLight;
        const baseIntensity = light.userData.baseIntensity || 0.8;
        
        // If there was a recent flash (from note trigger), decay back to base
        if (light.intensity > baseIntensity * 1.2) {
            light.intensity = THREE.MathUtils.lerp(light.intensity, baseIntensity, 0.08);
        } else {
            // Normal gentle pulsing when idle (at night)
            const pulseSpeed = 2.0 + (foliageObject.userData.animationOffset || 0) * 0.3;
            const pulse = Math.sin(time * pulseSpeed) * 0.2 + 1.0; // 0.8 to 1.2
            light.intensity = baseIntensity * pulse;
        }
    }

    // --- Mushroom Scale Animation (from note bounce) ---
    // Animate scale back to base after note trigger (replaces setTimeout)
    if (foliageObject.userData.scaleAnimStart) {
        const elapsed = Date.now() - foliageObject.userData.scaleAnimStart;
        const duration = foliageObject.userData.scaleAnimTime || 0.08;
        const t = Math.min(1.0, elapsed / (duration * 1000));
        
        if (t < 1.0) {
            const target = foliageObject.userData.scaleTarget || 1.0;
            // Lerp each axis independently to handle non-uniform squash/stretch smoothly
            // (e.g. restoring aspect ratio from flattened state)
            foliageObject.scale.x = THREE.MathUtils.lerp(foliageObject.scale.x, target, t * 0.5);
            foliageObject.scale.y = THREE.MathUtils.lerp(foliageObject.scale.y, target, t * 0.5);
            foliageObject.scale.z = THREE.MathUtils.lerp(foliageObject.scale.z, target, t * 0.5);
        } else {
            // Animation complete
            foliageObject.scale.setScalar(foliageObject.userData.scaleTarget || 1.0);
            delete foliageObject.userData.scaleAnimStart;
            delete foliageObject.userData.scaleTarget;
            delete foliageObject.userData.scaleAnimTime;
        }
    }

    // --- Mushroom wobble smoothing (median + lerp) ---
    if (foliageObject.userData.type === 'mushroom') {
        const buf = foliageObject.userData.noteBuffer || [];
        const medianVel = median(buf);
        const cfg = (CONFIG as any).reactivity?.mushroom || {};
        const scale = cfg.scale || 1.0;
        const target = Math.min(cfg.maxAmplitude ?? 1.0, Math.max(cfg.minThreshold ?? 0.01, medianVel * scale));
        const cur = foliageObject.userData.wobbleCurrent || 0;
        const lerpT = Math.min(0.25, (cfg.smoothingRate || 8) * 0.02);
        foliageObject.userData.wobbleCurrent = THREE.MathUtils.lerp(cur, target, lerpT);
    }

    if (isDeepNight) {
        const isNightFlower = foliageObject.userData.type === 'flower' && foliageObject.userData.animationType === 'glowPulse';

        if (!isNightFlower) {
            const sleepSpeed = 0.5;
            const sleepAmount = 0.02;
            const shiver = Math.sin(time * sleepSpeed + offset) * sleepAmount;

            foliageObject.rotation.z = shiver;
            foliageObject.rotation.x = shiver * 0.5;
            return;
        }
    }

    let kick = 0, groove = 0, beatPhase = 0, leadVol = 0;
    if (audioData) {
        kick = audioData.kickTrigger || 0;
        groove = audioData.grooveAmount || 0;
        beatPhase = audioData.beatPhase || 0;
        leadVol = audioData.channelData?.[2]?.volume || 0;
    }

    const isActive = !isDay;
    const intensity = isActive ? (1.0 + groove * 5.0) : 0.2;
    const animTime = time + beatPhase;

    // --- WASM Batching Integration ---
    // Bolt Optimization: Direct queue attempt avoids array allocation/lookup.
    if (type && foliageBatcher.queue(foliageObject, type, intensity, animTime, kick)) {
        return; // Successfully queued, skip JS logic
    }

    // --- Fallback JS Logic ---

    if (type === 'arpeggioUnfurl') {
        updateArpeggio(foliageObject, time, audioData);
    }
    else if (type === 'snareSnap') {
        let snareTrigger = 0;
        // Heuristic: Check channel 1 (common snare index) for trigger
        if (audioData && audioData.channelData && audioData.channelData[1]) {
            snareTrigger = audioData.channelData[1].trigger || 0;
        }

        const left = foliageObject.userData.leftJaw;
        const right = foliageObject.userData.rightJaw;

        if (left && right) {
            // Snap shut fast (on trigger), open slow (decay)
            if (snareTrigger > 0.2) {
                foliageObject.userData.snapState = 1.0;
            } else {
                foliageObject.userData.snapState = Math.max(0, (foliageObject.userData.snapState || 0) - 0.1);
            }

            const s = foliageObject.userData.snapState || 0;
            // Left Jaw: Open -0.5, Closed 0.0
            left.rotation.x = THREE.MathUtils.lerp(-0.5, 0.0, s);
            // Right Jaw: Open 0.5+PI, Closed 0.0+PI
            right.rotation.x = THREE.MathUtils.lerp(0.5 + Math.PI, Math.PI, s);
        }
    }
    else if (type === 'accordionStretch') {
        const trunkGroup = foliageObject.userData.trunk;
        if (trunkGroup) {
            const stretch = 1.0 + Math.max(0, Math.sin(animTime * 10 + offset)) * 0.31 * intensity;
            trunkGroup.scale.y = stretch;
            const width = 1.0 / Math.sqrt(stretch);
            trunkGroup.scale.x = width;
            trunkGroup.scale.z = width;
        }
    }
    else if (type === 'fiberWhip') {
        foliageObject.rotation.y = Math.sin(time * 0.5 + offset) * 0.111;

        const whip = leadVol * 2.0;
        foliageObject.children.forEach((branchGroup, i) => {
            if (branchGroup === foliageObject.children[0]) return;

            const childOffset = i * 0.51;
            const cable = branchGroup.children[0];

            let rotZ = Math.PI / 4 + Math.sin(time * 2 + childOffset) * 0.13;

            if (isActive) {
                rotZ += Math.sin(time * 10 + childOffset) * whip;
                const tip = cable.children[0];
                if (tip) {
                    tip.visible = Math.random() < (0.5 + whip);
                }
            }

            if (cable) cable.rotation.z = rotZ;
        });
    }
    // Note: bounce, sway, wobble, hop, gentleSway are now handled by WASM batcher above.
    // Kept here as fallback if batcher fails/overflows.
    else if (type === 'bounce') {
        const y = foliageObject.userData.originalY ?? foliageObject.position.y;
        foliageObject.userData.originalY = y;
        foliageObject.position.y = y + Math.sin(animTime * 3 + offset) * 0.12 * intensity;
        if (isActive && kick > 0.12) foliageObject.position.y += kick * 0.21;
    }
    else if (type === 'sway') {
        foliageObject.rotation.z = Math.sin(time + offset) * 0.11 * intensity;
    }
    else if (type === 'wobble') {
        const wobbleBoost = foliageObject.userData.wobbleCurrent || 0;
        foliageObject.rotation.x = Math.sin(animTime * 3 + offset) * 0.15 * intensity * (1 + wobbleBoost);
        foliageObject.rotation.z = Math.cos(animTime * 3 + offset) * 0.16 * intensity * (1 + wobbleBoost);
    }
    else if (type === 'accordion') {
        const target = foliageObject.userData.trunk || foliageObject;
        const stretch = 1.0 + Math.max(0, Math.sin(animTime * 10 + offset)) * 0.3 * intensity;
        target.scale.y = stretch;
        if (foliageObject.userData.trunk) {
            const w = 1.0 / Math.sqrt(stretch);
            target.scale.x = w;
            target.scale.z = w;
        }
    }
    else if (type === 'hop') {
        const y = foliageObject.userData.originalY ?? foliageObject.position.y;
        foliageObject.userData.originalY = y;
        const hopTime = animTime * 4 + offset;
        const bounce = Math.max(0, Math.sin(hopTime)) * 0.3 * intensity;
        foliageObject.position.y = y + bounce;
        if (isActive && kick > 0.1) foliageObject.position.y += kick * 0.15;
    }
    else if (type === 'shiver') {
        const shiver = Math.sin(animTime * 20 + offset) * 0.05 * intensity;
        foliageObject.rotation.z = shiver;
        foliageObject.rotation.x = shiver * 0.5;
    }
    else if (type === 'spring') {
        const springTime = animTime * 5 + offset;
        foliageObject.scale.y = 1.0 + Math.sin(springTime) * 0.1 * intensity;
        foliageObject.scale.x = 1.0 - Math.sin(springTime) * 0.05 * intensity;
        foliageObject.scale.z = 1.0 - Math.sin(springTime) * 0.05 * intensity;
    }
    else if (type === 'gentleSway') {
        foliageObject.rotation.z = Math.sin(time * 0.5 + offset) * 0.05 * intensity;
    }
    else if (type === 'vineSway') {
        foliageObject.rotation.z = Math.sin(time * 1.5 + offset) * 0.2 * intensity;
        foliageObject.rotation.x = Math.cos(time * 1.2 + offset) * 0.1 * intensity;
    }
    else if (type === 'spiralWave') {
        foliageObject.children.forEach((child, i) => {
            child.rotation.y = Math.sin(time * 2 + offset + i * 0.5) * 0.3 * intensity;
        });
    }
    else if (type === 'float') {
        const y = foliageObject.userData.originalY ?? foliageObject.position.y;
        foliageObject.userData.originalY = y;
        foliageObject.position.y = y + Math.sin(time * 2 + offset) * 0.5 * intensity;
    }
    else if (type === 'spin') {
        foliageObject.rotation.y += 0.01 * intensity;
    }
    else if (type === 'glowPulse') {
        const y = foliageObject.userData.originalY ?? foliageObject.position.y;
        foliageObject.userData.originalY = y;
        foliageObject.position.y = y + Math.sin(time * 2 + offset) * 0.1;
    }
    else if (type === 'rain') {
        const rainChild = foliageObject.children.find(c => c.type === 'Points') as THREE.Points;
        if (rainChild && rainChild.geometry && rainChild.geometry.attributes.position) {
            const positions = rainChild.geometry.attributes.position.array as Float32Array;
            for (let i = 0; i < positions.length; i += 3) {
                positions[i + 1] -= 0.1;
                if (positions[i + 1] < -6) positions[i + 1] = 0;
            }
            rainChild.geometry.attributes.position.needsUpdate = true;
        }
        const y = foliageObject.userData.originalY ?? foliageObject.position.y;
        foliageObject.userData.originalY = y;
        foliageObject.position.y = y + Math.sin(time * 0.3 + offset) * 0.2;
    }
    else if (type === 'cloudBob') {
        const y = foliageObject.userData.originalY ?? foliageObject.position.y;
        foliageObject.userData.originalY = y;
        foliageObject.position.y = y + Math.sin(time * 0.5 + offset) * 0.3;
        foliageObject.rotation.y = Math.sin(time * 0.2 + offset * 0.5) * 0.05;
    }
    else if (type === 'vibratoShake') {
        const headGroup = foliageObject.userData.headGroup;
        if (headGroup) {
            let vibratoAmount = 0;
            if (audioData && audioData.channelData) {
                for (const ch of audioData.channelData) {
                    if (ch.activeEffect === 1) {
                        vibratoAmount = Math.max(vibratoAmount, ch.effectValue || 0);
                    }
                }
            }
            vibratoAmount = Math.max(vibratoAmount, groove * 0.5);

            // Enhance for "frequency distortion field" feel
            const shakeSpeed = 50 + vibratoAmount * 100; // Increased speed
            const shakeAmount = 0.05 + vibratoAmount * 0.25; // Increased range

            headGroup.children.forEach((child, i) => {
                if (i === 0) return;
                const phase = child.userData.vibratoPhase || (i * 0.5);
                child.rotation.x = -Math.PI / 2 + Math.sin(time * shakeSpeed + phase) * shakeAmount;
                child.rotation.y = Math.cos(time * shakeSpeed * 1.3 + phase) * shakeAmount * 0.8;

                // Add a "jitter" scale effect for visual distortion
                const jitter = 1.0 + Math.random() * vibratoAmount * 0.2;
                child.scale.setScalar(jitter);
            });

            // Whole head wobble
            headGroup.rotation.z = Math.sin(time * 15 + offset) * 0.1 * intensity;
        }
    }
    else if (type === 'tremeloPulse') {
        const headGroup = foliageObject.userData.headGroup;
        const bellMat = foliageObject.userData.bellMaterial;
        const vortex = foliageObject.userData.vortex;

        let tremoloAmount = 0;
        if (audioData && audioData.channelData) {
            for (const ch of audioData.channelData) {
                if (ch.activeEffect === 3) {
                    tremoloAmount = Math.max(tremoloAmount, ch.effectValue || 0);
                }
            }
        }
        tremoloAmount = Math.max(tremoloAmount, Math.sin(beatPhase * Math.PI * 2) * 0.3);

        if (headGroup) {
            const pulseSpeed = 8 + tremoloAmount * 15;
            const pulseAmount = 0.1 + tremoloAmount * 0.3;
            const pulse = 1.0 + Math.sin(time * pulseSpeed + offset) * pulseAmount;

            headGroup.scale.set(pulse, pulse, pulse);

            if (bellMat) {
                bellMat.opacity = 0.7 + Math.sin(time * pulseSpeed + offset) * 0.2 * intensity;
                bellMat.emissiveIntensity = 0.3 + tremoloAmount * 0.7;
            }

            if (vortex) {
                vortex.scale.setScalar(1.0 - Math.sin(time * pulseSpeed + offset) * 0.4);
                vortex.material.opacity = 0.3 + Math.sin(time * pulseSpeed + offset + Math.PI) * 0.4;
            }
        }

        foliageObject.rotation.z = Math.sin(time + offset) * 0.03 * intensity;
    }
    else if (type === 'cymbalShake') {
        const head = foliageObject.children[1];
        if (head) {
             let highFreq = 0;
             if (audioData && audioData.channelData) {
                 // Check higher channels (3 and 4)
                 const ch3 = audioData.channelData[3]?.volume || 0;
                 const ch4 = audioData.channelData[4]?.volume || 0;
                 highFreq = Math.max(ch3, ch4);
             }

             // Twitch based on high frequency
             if (highFreq > 0.05) {
                 const twitch = highFreq * 0.2;
                 head.rotation.z = (Math.random() - 0.5) * twitch;
                 head.rotation.x = (Math.random() - 0.5) * twitch;

                 // Shake individual seeds
                 head.children.forEach(stalk => {
                     stalk.rotation.z += (Math.random() - 0.5) * twitch * 2.0;
                     // Dampen back
                     stalk.rotation.z *= 0.8;
                 });
             } else {
                 head.rotation.z *= 0.9;
                 head.rotation.x *= 0.9;
             }

             // Burst effect (scale pulse)
             if (highFreq > 0.4) {
                  const s = 1.0 + (highFreq - 0.4) * 0.5;
                  head.scale.set(s, s, s);
             } else {
                  // ⚡ OPTIMIZATION: Use shared vector to avoid allocation
                  head.scale.lerp(_scratchOne, 0.1);
             }
        }
    }
    else if (type === 'panningBob') {
        const panBias = foliageObject.userData.panBias || 0; // -1 (Left) to 1 (Right)

        let targetBob = 0;
        let activeGlow = 0;

        if (audioData && audioData.channelData) {
            // Check all channels for pan activity matching our bias
            // Or just check the main melody channels (2, 3)
            // Let's iterate and sum weighted by volume
            for (const ch of audioData.channelData) {
                 const vol = ch.volume || 0;
                 const pan = ch.pan || 0; // -1 to 1

                 // If pad is LEFT (panBias < 0) and sound is LEFT (pan < 0), add up
                 // If pad is RIGHT (panBias > 0) and sound is RIGHT (pan > 0), add up
                 if (panBias * pan > 0) {
                     targetBob += vol * Math.abs(pan);
                 }
                 // Also react to center pan slightly
                 if (Math.abs(pan) < 0.2) {
                     targetBob += vol * 0.3;
                 }
            }
        }

        // Smooth bob
        const currentBob = foliageObject.userData.currentBob || 0;
        const nextBob = THREE.MathUtils.lerp(currentBob, targetBob, 0.1);
        foliageObject.userData.currentBob = nextBob;

        // Apply visual bob
        const bobHeight = nextBob * 1.5 * intensity; // Scale bob
        const baseY = foliageObject.userData.originalY ?? foliageObject.position.y;
        foliageObject.userData.originalY = baseY;

        foliageObject.position.y = baseY + Math.sin(time * 2 + offset) * 0.1 + bobHeight;

        // Tilt based on bias
        foliageObject.rotation.z = panBias * bobHeight * 0.2;

        // Update Glow intensity
        const glowMat = foliageObject.userData.glowMaterial;
        const glowUni = foliageObject.userData.glowUniform;
        if (glowUni) {
             // Update TSL Uniform
             glowUni.value = 0.6 + bobHeight * 0.8;
        } else if (glowMat) {
             // Basic opacity update if supported (fallback)
             (glowMat as any).opacity = 0.6 + bobHeight * 0.5;
        }
    }
    else if (type === 'spiritFade') {
        const mat = foliageObject.userData.spiritMaterial;
        let volume = 1.0;
        // Calculate master volume proxy
        if (audioData) {
            // Average of all channels or just use main meter
            // audioData.average isn't strictly typed but passed in some contexts
            // Let's sum active channels
            let sum = 0;
            if (audioData.channelData) {
                for (const ch of audioData.channelData) {
                    sum += ch.volume || 0;
                }
                volume = sum / 4.0; // Normalize roughly
            }
        }

        // Logic: If volume < threshold (breakdown/silence), spirit appears.
        // If volume > threshold, spirit fades/flees.
        const threshold = 0.1;

        if (volume < threshold) {
            foliageObject.userData.targetOpacity = 0.8;
            foliageObject.userData.fleeSpeed = Math.max(0, foliageObject.userData.fleeSpeed - 0.01);
        } else {
            foliageObject.userData.targetOpacity = 0.0;
            if (foliageObject.userData.currentOpacity > 0.1) {
                // Flee!
                foliageObject.userData.fleeSpeed = Math.min(0.2, foliageObject.userData.fleeSpeed + 0.01);
            }
        }

        // Lerp Opacity
        const cur = foliageObject.userData.currentOpacity || 0;
        const target = foliageObject.userData.targetOpacity;
        const next = THREE.MathUtils.lerp(cur, target, 0.05);
        foliageObject.userData.currentOpacity = next;

        if (mat) {
            mat.opacity = next;
            mat.visible = next > 0.01;
        }

        // Flee movement (bob away)
        if (foliageObject.userData.fleeSpeed > 0) {
             foliageObject.position.z -= foliageObject.userData.fleeSpeed;
             // Reset if too far? Or just let them run away forever (they get culled eventually)
        }

        // Hover animation
        if (next > 0.01) {
             const baseY = foliageObject.userData.originalY ?? foliageObject.position.y;
             foliageObject.userData.originalY = baseY;
             foliageObject.position.y = baseY + Math.sin(time * 1.5 + offset) * 0.2;
        }
    }
    else if (type === 'geyserErupt') {
        const plume = foliageObject.userData.plume;
        const plumeLight = foliageObject.userData.plumeLight;
        const coreMat = foliageObject.userData.coreMaterial;
        const maxHeight = foliageObject.userData.maxHeight || 5.0;

        const kickThreshold = 0.3;
        let eruptionStrength = foliageObject.userData.eruptionStrength || 0;

        if (kick > kickThreshold) {
            eruptionStrength = Math.min(1.0, eruptionStrength + kick * 0.5);
        } else {
            eruptionStrength = Math.max(0, eruptionStrength - 0.03);
        }
        foliageObject.userData.eruptionStrength = eruptionStrength;

        if (plume) {
            plume.visible = eruptionStrength > 0.05;

            if (plume.visible && plume.geometry.attributes.position) {
                const positions = plume.geometry.attributes.position.array as Float32Array;
                const velocities = plume.geometry.attributes.velocity.array as Float32Array;
                const currentMaxH = maxHeight * eruptionStrength;

                for (let i = 0; i < positions.length / 3; i++) {
                    const idx = i * 3;
                    const vel = velocities[i];

                    positions[idx + 1] += vel * eruptionStrength * 0.3;

                    const heightRatio = positions[idx + 1] / currentMaxH;
                    positions[idx] += (Math.random() - 0.5) * 0.02 * heightRatio;
                    positions[idx + 2] += (Math.random() - 0.5) * 0.02 * heightRatio;

                    if (positions[idx + 1] > currentMaxH || positions[idx + 1] < 0) {
                        positions[idx] = (Math.random() - 0.5) * 0.2;
                        positions[idx + 1] = 0;
                        positions[idx + 2] = (Math.random() - 0.5) * 0.2;
                    }
                }
                plume.geometry.attributes.position.needsUpdate = true;
            }

            if ((plume.material as any).opacity !== undefined) {
                 (plume.material as any).opacity = 0.5 + eruptionStrength * 0.5;
            }
        }

        if (plumeLight) {
            plumeLight.intensity = eruptionStrength * 2.0;
            plumeLight.position.y = 1 + eruptionStrength * maxHeight * 0.3;
        }

        if (coreMat) {
            coreMat.emissiveIntensity = 0.3 + eruptionStrength * 1.5 + Math.sin(time * 20) * 0.2 * eruptionStrength;
        }
    }
}
