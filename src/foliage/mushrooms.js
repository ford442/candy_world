// src/foliage/mushrooms.js

import * as THREE from 'three';
import { color, time, sin, positionLocal, float, uniform, vec3 } from 'three/tsl';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import { foliageMaterials, registerReactiveMaterial, attachReactivity, pickAnimation, eyeGeo, createRimLight, uAudioLow, uAudioHigh, sharedGeometries, _foliageReactiveColor } from './common.js';
import { uTwilight } from './sky.js';

// 12 Chromatic Notes with their corresponding colors
// Colors are defined here to match CONFIG.noteColorMap.mushroom palette
export const MUSHROOM_NOTES = [
    { note: 'C',  color: 0xFF4040, name: 'C Red' },       // Red
    { note: 'C#', color: 0xEF1280, name: 'C# Magenta' },  // Magenta-Red
    { note: 'D',  color: 0xC020C0, name: 'D Magenta' },   // Magenta
    { note: 'D#', color: 0x8020EF, name: 'D# Violet' },   // Violet
    { note: 'E',  color: 0x4040FF, name: 'E Blue' },      // Blue
    { note: 'F',  color: 0x1280EF, name: 'F Azure' },     // Azure
    { note: 'F#', color: 0x00C0C0, name: 'F# Cyan' },     // Cyan
    { note: 'G',  color: 0x12EF80, name: 'G Spring' },    // Spring Green
    { note: 'G#', color: 0x40FF40, name: 'G# Green' },    // Green
    { note: 'A',  color: 0x80EF12, name: 'A Lime' },      // Lime
    { note: 'A#', color: 0xC0C000, name: 'A# Yellow' },   // Yellow
    { note: 'B',  color: 0xEF8012, name: 'B Orange' }     // Orange
];

export function createMushroom(options = {}) {
    const {
        size = 'regular',
        scale = 1.0,
        colorIndex = -1,
        hasFace = false,
        isBouncy = false,
        note = null,  // Musical note (e.g., 'C', 'F#', etc.)
        noteIndex = -1 // Index into MUSHROOM_NOTES array (0-11)
    } = options;

    const group = new THREE.Group();
    const isGiant = size === 'giant';
    // All mushrooms get faces now if requested, but giants always have them
    const showFace = isGiant || hasFace;

    // Determine which musical note this mushroom represents
    let mushroomNote = null;
    let noteColor = null;
    let actualNoteIndex = -1;

    if (noteIndex >= 0 && noteIndex < MUSHROOM_NOTES.length) {
        actualNoteIndex = noteIndex;
        mushroomNote = MUSHROOM_NOTES[noteIndex];
        noteColor = mushroomNote.color;
    } else if (note) {
        // Find note by name
        const found = MUSHROOM_NOTES.find(n => n.note === note);
        if (found) {
            mushroomNote = found;
            noteColor = found.color;
            actualNoteIndex = MUSHROOM_NOTES.indexOf(found);
        }
    }

    // Shape variations based on note (0-11 creates subtle differences)
    const noteVariation = actualNoteIndex >= 0 ? actualNoteIndex / 11.0 : Math.random();
    const baseScale = isGiant ? 8.0 * scale : 1.0 * scale;
    
    // Subtle shape variations by note
    // Lower notes (C, C#, D) = shorter, wider; Higher notes (A, A#, B) = taller, thinner
    const heightMod = 0.8 + (noteVariation * 0.6); // 0.8 to 1.4
    const widthMod = 1.2 - (noteVariation * 0.4);  // 1.2 to 0.8
    
    const stemH = (1.0 + Math.random() * 0.3) * baseScale * heightMod;
    const stemR = (0.15 + Math.random() * 0.05) * baseScale * widthMod;
    const capR = stemR * (2.5 + Math.random() * 0.5) * (isGiant ? 1.0 : 1.2) * widthMod;

    // Stem Geometry (Shared Unit Cylinder + TSL Shaping)
    // The curve logic (r = 1.0 - (t - 0.3)^2 * 0.5) is now applied in the material's vertex shader.
    // We just scale the unit cylinder (radius 1, height 1) to the desired dimensions.
    const stem = new THREE.Mesh(sharedGeometries.unitCylinder, foliageMaterials.mushroomStem);
    stem.scale.set(stemR, stemH, stemR);
    stem.castShadow = true;
    stem.receiveShadow = true;
    group.add(stem);

    // Cap Geometry (Shared Sphere with Cuts)
    let capMat;
    let chosenColorIndex;
    
    // Use note color if available, otherwise use colorIndex or random
    if (noteColor !== null) {
        // Create dedicated material with note color for musical mushrooms
        const baseCapMat = foliageMaterials.mushroomCap[0] || foliageMaterials.mushroomStem;
        capMat = baseCapMat.clone();
        capMat.color.setHex(noteColor);
        capMat.roughness = 0.7;
        chosenColorIndex = actualNoteIndex;
    } else if (colorIndex >= 0 && colorIndex < foliageMaterials.mushroomCap.length) {
        chosenColorIndex = colorIndex;
        capMat = foliageMaterials.mushroomCap[chosenColorIndex];
    } else {
        chosenColorIndex = Math.floor(Math.random() * foliageMaterials.mushroomCap.length);
        capMat = foliageMaterials.mushroomCap[chosenColorIndex];
    }

    // Clone material to allow individual emissive strobing and TSL modification
    const instanceCapMat = capMat.clone();
    instanceCapMat.userData.isClone = true;
    // Ensure base emissive is set for fade-back
    instanceCapMat.userData.baseEmissive = new THREE.Color(0x000000);
    // Store note color for reactivity
    if (noteColor !== null) {
        instanceCapMat.userData.noteColor = new THREE.Color(noteColor);
    }

    // --- PALETTE UPDATE: Jelly Squish & Audio Reactivity ---
    // Make ALL mushrooms "alive" with TSL animations

    // 1. TSL Squish Animation (Vertex Position)
    // Combine idle breathing + kick-drum reaction
    const pos = positionLocal;

    // Idle Breathing (Slower for giants)
    const breathSpeed = time.mul(isGiant ? 2.0 : 3.0);
    const breathAmount = float(isGiant ? 0.05 : 0.02);
    const breathCycle = sin(breathSpeed);

    // Audio Reaction (Kick Drum Squish)
    // uAudioLow is global 0-1 kick intensity
    const kickSquish = uAudioLow.mul(0.15); // Max 15% deformation on kick

    // Total Vertical Scale (1.0 +/- variation)
    // As Y expands, X/Z shrink to preserve volume (approx)
    const totalScaleY = float(1.0).add(breathCycle.mul(breathAmount)).sub(kickSquish);
    const totalScaleXZ = float(1.0).sub(breathCycle.mul(breathAmount).mul(0.5)).add(kickSquish.mul(0.5));

    const newPos = vec3(
        pos.x.mul(totalScaleXZ),
        pos.y.mul(totalScaleY),
        pos.z.mul(totalScaleXZ)
    );

    // If existing material has position logic (e.g. unified material), we should ideally chain it.
    // But since we are cloning presets, we can override or use if/else logic if needed.
    // For now, we apply the Jelly Squish to all mushrooms.
    instanceCapMat.positionNode = newPos;

    // 2. Audio-Reactive Rim Light & Emission
    // Bind base properties to uniforms so CPU animation loop works
    const uEmissive = uniform(instanceCapMat.emissive);

    // Reactive Rim Light: Pulses with High Frequency (Hi-hats/Melody)
    const rimIntensity = float(0.4).add(uAudioHigh.mul(0.5));
    const rimEffect = createRimLight(color(0xFFFFFF), rimIntensity, float(3.0));

    // Twilight Glow Logic:
    // Boost emission during twilight/night
    // If the mushroom has a note color, we can mix that in, otherwise use base color.
    // For TSL simplicity, we boost the current emissive color (which might be black, so careful).
    // Better: Add the diffuse color as emissive during twilight.
    const twilightGlow = color(instanceCapMat.color).mul(uTwilight).mul(0.4); // 40% glow at night

    let finalEmissiveNode = uEmissive.add(rimEffect).add(twilightGlow);

    // 3. Giant Features (Stripes) - Integrated into same material
    if (isGiant) {
        // Animated Emission Stripes
        const stripeFreq = 10.0;
        const stripeSpeed = 2.0;
        const stripePattern = sin(newPos.y.mul(stripeFreq).sub(time.mul(stripeSpeed)));
        const stripeIntensity = stripePattern.add(1.0).mul(0.5).pow(2.0);

        // Base Pulse
        const basePulse = sin(breathSpeed.mul(2.0)).mul(0.1).add(0.2);

        // Mix stripe color (lighter version of cap color)
        const stripeColor = color(instanceCapMat.color).mul(0.5); // Additive

        // Compose: Existing (Base + Rim) + Stripes
        finalEmissiveNode = finalEmissiveNode.add(stripeColor.mul(stripeIntensity.mul(0.5).add(basePulse)));
    }

    instanceCapMat.emissiveNode = finalEmissiveNode;
    // -----------------------------------------------

    // Cap Mesh
    const cap = new THREE.Mesh(sharedGeometries.mushroomCap, instanceCapMat);
    cap.scale.setScalar(capR);
    cap.position.y = stemH - (capR * 0.2);
    cap.castShadow = true;
    cap.receiveShadow = true;
    group.add(cap);

    // Gills (Shared Cone)
    const gillMat = foliageMaterials.mushroomGills;
    const gill = new THREE.Mesh(sharedGeometries.mushroomGillCenter, gillMat);
    // Scale Unit Cone (R=1, H=1) to desired dimensions
    gill.scale.set(capR * 0.9, capR * 0.4, capR * 0.9);
    gill.position.y = stemH - (capR * 0.2);
    gill.rotation.x = Math.PI;
    group.add(gill);

    // Spots - vary pattern based on note
    const spotCount = actualNoteIndex >= 0 ? (3 + actualNoteIndex % 5) : (3 + Math.floor(Math.random() * 5));
    // Use shared Unit Sphere for spots
    const spotRadius = capR * 0.15;
    const spotMat = foliageMaterials.mushroomSpots;
    
    // Add note-colored accent spots if this is a musical mushroom
    let accentSpotMat = spotMat;
    if (noteColor !== null) {
        // Create dedicated material with note color for musical mushrooms
        const baseCapMat = foliageMaterials.mushroomCap[0] || foliageMaterials.mushroomStem;
        accentSpotMat = baseCapMat.clone();
        accentSpotMat.userData.isClone = true;
        accentSpotMat.color.setHex(noteColor);
        accentSpotMat.roughness = 0.7;
    }

    for (let i = 0; i < spotCount; i++) {
        const u = Math.random();
        const v = Math.random() * 0.5;
        const theta = 2 * Math.PI * u;
        const phi = Math.acos(1 - v);

        const x = Math.sin(phi) * Math.cos(theta) * capR;
        const y = Math.cos(phi) * capR;
        const z = Math.sin(phi) * Math.sin(theta) * capR;

        // Use accent material for some spots on musical mushrooms
        const useAccent = noteColor !== null && i % 2 === 0;
        const spot = new THREE.Mesh(sharedGeometries.unitSphere, useAccent ? accentSpotMat : spotMat);
        spot.position.set(x, y + stemH - (capR * 0.2), z);
        // Combine base radius with flattening scale
        // Original: radius=spotRadius, scale=(1, 0.2, 1)
        // New: radius=1, scale=(spotRadius, spotRadius*0.2, spotRadius)
        spot.scale.set(spotRadius, spotRadius * 0.2, spotRadius);
        spot.lookAt(0, stemH + capR, 0);
        group.add(spot);
    }

    // Face
    if (showFace) {
        const faceGroup = new THREE.Group();
        // Position face on the front of the stem/cap junction
        faceGroup.position.set(0, stemH * 0.6, stemR * 0.85);
        const faceScale = isGiant ? baseScale : baseScale * 0.6;
        faceGroup.scale.set(faceScale, faceScale, faceScale);

        // Eyes
        const leftEye = new THREE.Mesh(eyeGeo, foliageMaterials.eye);
        leftEye.position.set(-0.15, 0.1, 0.1);
        const rightEye = new THREE.Mesh(eyeGeo, foliageMaterials.eye);
        rightEye.position.set(0.15, 0.1, 0.1);

        // Pupils
        const pupilGeo = new THREE.SphereGeometry(0.06, 8, 8);
        const leftPupil = new THREE.Mesh(pupilGeo, foliageMaterials.pupil);
        leftPupil.position.set(0, 0, 0.1);
        leftEye.add(leftPupil);

        const rightPupil = new THREE.Mesh(pupilGeo, foliageMaterials.pupil);
        rightPupil.position.set(0, 0, 0.1);
        rightEye.add(rightPupil);

        // Smile
        const smile = new THREE.Mesh(sharedGeometries.mushroomSmile, foliageMaterials.clayMouth);
        smile.rotation.z = Math.PI;
        smile.position.set(0, -0.05, 0.1);

        // Cheeks (Rosy!)
        // ⚡ OPTIMIZATION: Use shared sphere geometry scaled down
        const leftCheek = new THREE.Mesh(sharedGeometries.sphereLow, foliageMaterials.mushroomCheek);
        leftCheek.position.set(-0.25, 0.0, 0.05);
        leftCheek.scale.set(0.08, 0.048, 0.04); // Scaled from radius 1.0 to 0.08

        const rightCheek = new THREE.Mesh(sharedGeometries.sphereLow, foliageMaterials.mushroomCheek);
        rightCheek.position.set(0.25, 0.0, 0.05);
        rightCheek.scale.set(0.08, 0.048, 0.04);

        faceGroup.add(leftEye, rightEye, smile, leftCheek, rightCheek);
        group.add(faceGroup);
    }

    // Giant specific logic moved to shared material setup above to preserve preset visual properties (like SSS/Gummy)
    // while adding the giant animation effects.

    group.userData.animationType = pickAnimation(['wobble', 'bounce', 'accordion']);
    group.userData.animationOffset = Math.random() * 10;
    group.userData.type = 'mushroom';
    group.userData.colorIndex = typeof chosenColorIndex === 'number' ? chosenColorIndex : -1;
    
    // Store musical note information
    if (mushroomNote) {
        group.userData.musicalNote = mushroomNote.note;
        group.userData.noteColor = noteColor;
        group.userData.noteIndex = actualNoteIndex;
    }
    
    // --- NEW: Bioluminescence Logic ---
    // Musical mushrooms always glow at night with their note color
    const shouldGlow = mushroomNote !== null || options.isBioluminescent;
    
    if (shouldGlow) {
        // Determine color based on note or cap material
        const lightColor = noteColor !== null 
            ? new THREE.Color(noteColor) 
            : ((instanceCapMat && instanceCapMat.color) ? instanceCapMat.color : new THREE.Color(0x00FF88));

        // Add a Point Light inside the cap for night glow
        const light = new THREE.PointLight(lightColor, 0, 4.0); // Start at 0, will be animated
        // Position it under the cap so it lights up the stem and ground
        light.position.set(0, stemH * 0.5, 0);
        group.add(light);
        
        // Store light reference for animation
        group.userData.glowLight = light;

        // Make the gills emissive for bioluminescence
        if (gill && gill.material) {
            // Clone to avoid affecting all mushrooms
            gill.material = gill.material.clone();
            gill.material.userData.isClone = true;
            gill.material.emissive = lightColor.clone().multiplyScalar(0.3);
            gill.material.emissiveIntensity = 0.3;
        }

        group.userData.isBioluminescent = true;
    }
    // ----------------------------------

    // --- IMPORTANT: Metadata for Weather System ---
    group.userData.size = size;
    group.userData.capRadius = capR;
    group.userData.capHeight = stemH;
    group.userData.stemRadius = stemR;

    // Register cap for flash animation system
    group.userData.reactiveMeshes = [cap];
    // ----------------------------------------------

    if (isGiant || isBouncy) {
        group.userData.isTrampoline = true;
    }

    // Attach Reactivity with Custom Logic
    attachReactivity(group, { minLight: 0.0, maxLight: 0.6, type: 'flora' });

    // Custom Reactivity Method: Note-specific Blink & Bounce
    group.reactToNote = (note, colorVal, velocity) => {
        // Only react if this mushroom's note matches the played note
        if (group.userData.musicalNote) {
            // Extract base note name (e.g., "C#" from "C#4")
            let playedNote = note;
            if (typeof note === 'string') {
                playedNote = note.replace(/[0-9-]/g, '');
            } else if (typeof note === 'number') {
                const CHROMATIC = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
                playedNote = CHROMATIC[note % 12];
            }
            
            // Only react if notes match
            if (playedNote !== group.userData.musicalNote) {
                return;
            }
        }
        
        // 1. Strobe Effect (via animateFoliage system)
        // ⚡ OPTIMIZATION: Use shared color object to prevent GC spike
        if (group.userData.noteColor) {
            _foliageReactiveColor.setHex(group.userData.noteColor);
        } else {
            _foliageReactiveColor.setHex(colorVal);
        }
            
        // Copy to flashColor (which might be new property on userData if not initialized)
        if (!cap.userData.flashColor) {
            cap.userData.flashColor = new THREE.Color();
        }
        cap.userData.flashColor.copy(_foliageReactiveColor);

        cap.userData.flashIntensity = 1.5 + (velocity * 2.5); // High intensity for blink
        cap.userData.flashDecay = 0.15; // Fast decay for strobe effect

        // 2. Glow light blink at night
        if (group.userData.glowLight) {
            const light = group.userData.glowLight;
            light.intensity = 2.0 + (velocity * 3.0); // Bright flash
            // Store original for fade back
            if (!light.userData.baseIntensity) {
                light.userData.baseIntensity = 0.8;
            }
        }

        // 3. Bounce / Retrigger Squish
        const squash = 1.0 - (velocity * 0.3);
        const stretch = 1.0 + (velocity * 0.3);
        group.scale.set(baseScale * stretch, baseScale * squash, baseScale * stretch);

        // Store scale animation state for frame-based animation
        group.userData.scaleTarget = baseScale;
        group.userData.scaleAnimTime = 0.08; // 80ms duration
        group.userData.scaleAnimStart = Date.now();
    };

    // Register with music reactivity system
    import('../systems/music-reactivity.js').then(module => {
        module.musicReactivitySystem.registerObject(group, 'mushroom');
    });

    return group;
}

// --- NEW FUNCTION ---
export function replaceMushroomWithGiant(scene, oldMushroom) {
    if (!oldMushroom || !oldMushroom.parent) return null;

    // 1. Capture State from Old Mushroom
    const position = oldMushroom.position.clone();
    const rotation = oldMushroom.rotation.clone();

    // Critical: Preserve Musical Identity
    const colorIndex = oldMushroom.userData.colorIndex;
    const noteIndex = oldMushroom.userData.noteIndex;
    const musicalNote = oldMushroom.userData.musicalNote;
    const noteColor = oldMushroom.userData.noteColor;

    // 2. Remove Old
    oldMushroom.parent.remove(oldMushroom);
    // Best practice: dispose geometry/material if not shared (omitted for brevity)

    // 3. Create Giant Version
    // Giants are always trampolines and have faces
    const newGiant = createMushroom({
        size: 'giant',
        scale: 1.0, // Giants calculate their own base scale
        colorIndex: colorIndex,
        noteIndex: noteIndex,
        hasFace: true,
        isBouncy: true
    });

    // Restore Musical Data explicitly if createMushroom didn't catch it from index
    if (musicalNote) newGiant.userData.musicalNote = musicalNote;
    if (noteColor) newGiant.userData.noteColor = noteColor;

    // 4. Restore Transform
    newGiant.position.copy(position);
    newGiant.rotation.copy(rotation);

    // 5. Add to Scene
    scene.add(newGiant);

    // 6. Visual "Pop" Animation
    newGiant.scale.set(0.1, 0.1, 0.1);
    const targetScale = 1.0;

    // Attach a temporary render callback for the pop effect
    newGiant.userData.popTime = 0;
    newGiant.userData.onBeforeRender = (renderer, scene, camera, geometry, material, group) => {
        if (newGiant.userData.popTime < 1.0) {
            newGiant.userData.popTime += 0.04;
            const t = Math.min(1.0, newGiant.userData.popTime);
            // Elastic bounce ease-out
            const s = targetScale * (1 + 0.5 * Math.sin(t * 18) * (1-t));
            newGiant.scale.setScalar(Math.max(0.1, s));
        }
    };

    return newGiant;
}
