import * as THREE from 'three';
import { freqToHue } from '../utils/wasm-loader.js';
import { reactiveMaterials, _foliageReactiveColor, median } from './common.js';
import { CONFIG } from '../core/config.js';

export function triggerGrowth(plants, intensity) {
    plants.forEach(plant => {
        if (!plant.userData.maxScale) {
            plant.userData.maxScale = plant.scale.x * 1.5;
        }

        if (plant.scale.x < plant.userData.maxScale) {
            const growthRate = intensity * 0.01;
            const newScale = plant.scale.x + growthRate;
            plant.scale.setScalar(newScale);
        }
    });
}

export function triggerBloom(flowers, intensity) {
    flowers.forEach(flower => {
        if (flower.userData.isFlower) {
            if (!flower.userData.maxBloom) {
                flower.userData.maxBloom = flower.scale.x * 1.3;
            }

            if (flower.scale.x < flower.userData.maxBloom) {
                const bloomRate = intensity * 0.02;
                flower.scale.addScalar(bloomRate);
            }
        }
    });
}

function applyWetEffect(material, wetAmount) {
    if (material.userData.dryRoughness === undefined) {
        material.userData.dryRoughness = material.roughness;
        material.userData.dryMetalness = material.metalness || 0;
        material.userData.dryColor = material.color.clone();
    }

    const targetRoughness = THREE.MathUtils.lerp(material.userData.dryRoughness, 0.2, wetAmount);
    material.roughness = targetRoughness;

    const targetMetalness = THREE.MathUtils.lerp(material.userData.dryMetalness, 0.15, wetAmount);
    if (material.metalness !== undefined) {
        material.metalness = targetMetalness;
    }

    if (material.color) {
        const darkColor = material.userData.dryColor.clone().multiplyScalar(1 - wetAmount * 0.3);
        material.color.lerp(darkColor, 0.1);
    }
}

export function updateMaterialsForWeather(materials, weatherState, weatherIntensity) {
    materials.forEach(mat => {
        if (!mat || !mat.isMaterial) return;

        let wetAmount = 0;

        if (weatherState === 'rain') {
            wetAmount = weatherIntensity * 0.5;
        } else if (weatherState === 'storm') {
            wetAmount = weatherIntensity * 0.8;
        }

        applyWetEffect(mat, wetAmount);
    });
}

export function updateFoliageMaterials(audioData, isNight, weatherState = null, weatherIntensity = 0) {
    if (!audioData) return;

    if (isNight) {
        const channels = audioData.channelData;
        if (channels && channels.length > 0) {
            reactiveMaterials.forEach((mat, i) => {
                const chIndex = (i % 4) + 1;
                const ch = channels[Math.min(chIndex, channels.length - 1)];

                if (ch && ch.freq > 0) {
                    const hue = freqToHue(ch.freq);
                    _foliageReactiveColor.setHSL(hue, 1.0, 0.6);
                    if (mat.isMeshBasicMaterial) {
                        mat.color.lerp(_foliageReactiveColor, 0.3);
                    } else {
                        mat.emissive.lerp(_foliageReactiveColor, 0.3);
                    }
                }
                const intensity = 0.2 + (ch?.volume || 0) + (ch?.trigger || 0) * 2.0;
                if (mat.isMeshBasicMaterial) {
                } else {
                    mat.emissiveIntensity = intensity;
                }
            });
        }
    } else {
        reactiveMaterials.forEach(mat => {
            if (mat.emissive) {
                mat.emissive.setHex(0x000000);
                mat.emissiveIntensity = 0;
            }
        });
    }

    if (weatherState && weatherIntensity > 0) {
        updateMaterialsForWeather(reactiveMaterials, weatherState, weatherIntensity);
    }
}

export function animateFoliage(foliageObject, time, audioData, isDay, isDeepNight = false) {
    const offset = foliageObject.userData.animationOffset || 0;
    const type = foliageObject.userData.animationType;

    // --- Per-note flash application (emissive/color) with automatic fade-back ---
    const reactive = foliageObject.userData.reactiveMeshes || [];
    
    // Skip material updates if no reactive meshes or no active flashes
    if (reactive.length === 0) {
        // Fast path: no reactive meshes to update
    } else {
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
                const mats = Array.isArray(child.material) ? child.material : [child.material];

                if (fi > 0) {
                    const fc = child.userData.flashColor || new THREE.Color(0xFFFFFF);
                    for (const mat of mats) {
                        if (!mat) continue;
                        // stronger blend for higher intensity; immediate override when very strong
                        const t = Math.min(1, fi * 1.2) * 0.8;
                        if (CONFIG.debugNoteReactivity && fi > 0.5) {
                            try { console.log('applyFlash pre:', foliageObject.userData.type, child.name || child.uuid, 'mat=', mat.name || mat.type, 'mat.emissive=', mat.emissive?.getHexString?.(), 'target=', fc.getHexString(), 'fi=', fi); } catch (e) {}
                        }
                        if (mat.isMeshBasicMaterial) {
                            if (fi > 0.7) mat.color.copy(fc);
                            else mat.color.lerp(fc, t);
                        } else if (mat.emissive) {
                            if (fi > 0.7) mat.emissive.copy(fc);
                            else mat.emissive.lerp(fc, t);
                            // ensure visible intensity (min floor) scaled by global flashScale
                            mat.emissiveIntensity = Math.max(0.2, fi * (CONFIG.flashScale || 2.0));
                        }
                        if (CONFIG.debugNoteReactivity && fi > 0.5) {
                            try { console.log('applyFlash post:', foliageObject.userData.type, child.name || child.uuid, 'mat=', mat.name || mat.type, 'mat.emissive=', mat.emissive?.getHexString?.()); } catch (e) {}
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
                    const fadeT = CONFIG.reactivity?.fadeSpeed ?? 0.06;
                    const snapThreshold = CONFIG.reactivity?.fadeSnapThreshold ?? 0.06;
                    const snapThresholdSq = snapThreshold * snapThreshold; // Avoid sqrt in distance check
                    let allFadedBack = true;
                    
                    for (const mat of mats) {
                        if (!mat) continue;
                        if (mat.isMeshBasicMaterial) {
                            if (mat.userData && mat.userData.baseColor) {
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

    // --- Mushroom wobble smoothing (median + lerp) ---
    if (foliageObject.userData.type === 'mushroom') {
        const buf = foliageObject.userData.noteBuffer || [];
        const medianVel = median(buf);
        const cfg = CONFIG.reactivity?.mushroom || {};
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

    if (type === 'speakerPulse') {
        foliageObject.position.y = (foliageObject.userData.originalY || 0) + Math.sin(time + offset) * 0.2;

        const pump = kick * 0.5;
        const pad = foliageObject.children[0];
        if (pad) {
            pad.scale.set(1.0 + pump * 0.2, 1.0 - pump * 0.5, 1.0 + pump * 0.2);

            if (isActive && pad.userData.ringMaterial) {
                const ringMat = pad.userData.ringMaterial;
                const glow = pump * 5.0;
                ringMat.emissive.setHSL(0.0 + pump * 0.21, 1.0, 0.5);
                ringMat.emissiveIntensity = glow;
            }
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
        const rainChild = foliageObject.children.find(c => c.type === 'Points');
        if (rainChild && rainChild.geometry && rainChild.geometry.attributes.position) {
            const positions = rainChild.geometry.attributes.position.array;
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

            const shakeSpeed = 25 + vibratoAmount * 50;
            const shakeAmount = 0.02 + vibratoAmount * 0.15;

            headGroup.children.forEach((child, i) => {
                if (i === 0) return;
                const phase = child.userData.vibratoPhase || (i * 0.5);
                child.rotation.x = -Math.PI / 2 + Math.sin(time * shakeSpeed + phase) * shakeAmount;
                child.rotation.y = Math.cos(time * shakeSpeed * 0.7 + phase) * shakeAmount * 0.5;
            });

            headGroup.rotation.z = Math.sin(time * 2 + offset) * 0.05 * intensity;
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
                const positions = plume.geometry.attributes.position.array;
                const velocities = plume.geometry.attributes.velocity.array;
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

            plume.material.opacity = 0.5 + eruptionStrength * 0.5;
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
