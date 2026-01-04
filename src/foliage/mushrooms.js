// src/foliage/mushrooms.js

import * as THREE from 'three';
import { color, time, sin, positionLocal, float, uniform } from 'three/tsl';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import { foliageMaterials, registerReactiveMaterial, attachReactivity, pickAnimation, eyeGeo, createRimLight } from './common.js';

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

    // Stem Geometry (Lathe)
    const stemPoints = [];
    for (let i = 0; i <= 10; i++) {
        const t = i / 10;
        const r = stemR * (1.0 - Math.pow(t - 0.3, 2) * 0.5);
        const y = t * stemH;
        stemPoints.push(new THREE.Vector2(r, y));
    }
    const stemGeo = new THREE.LatheGeometry(stemPoints, 16);
    const stem = new THREE.Mesh(stemGeo, foliageMaterials.mushroomStem);
    stem.castShadow = true;
    stem.receiveShadow = true;
    group.add(stem);

    // Cap Geometry (Sphere)
    const capGeo = new THREE.SphereGeometry(capR, 24, 24, 0, Math.PI * 2, 0, Math.PI / 1.8);
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

    // Clone material to allow individual emissive strobing
    const instanceCapMat = capMat.clone();
    // Ensure base emissive is set for fade-back
    instanceCapMat.userData.baseEmissive = new THREE.Color(0x000000);
    // Store note color for reactivity
    if (noteColor !== null) {
        instanceCapMat.userData.noteColor = new THREE.Color(noteColor);
    }

    // --- PALETTE UPDATE: Add Rim Light for Depth ---
    // Apply soft white rim light to make it pop against dark backgrounds
    // We compose it with existing emissive logic if needed, or just add it
    // But since this material might be cloned from a shared one, we need to be careful.
    // However, MeshStandardNodeMaterial's emissiveNode can be assigned a TSL node.

    // Default Emissive (black) + Rim Light
    // Note: If reactivity updates emissiveNode later, we might lose this.
    // Ideally, reactivity should modulate a uniform that is PART of this graph.
    // But for now, let's add it.
    // Since reactivity usually updates `material.emissive` color property OR `material.emissiveNode`,
    // and the `animateFoliage` loop often sets `material.emissive` directly for standard materials...
    // Wait, the project uses TSL. The `reactToNote` method here updates `cap.userData.flashColor`.
    // The actual update happens in the animation loop.

    // Let's add the rim light to the *emissiveNode* permanently.

    // Fix: We need to preserve the standard emissive behavior so audio reactivity (flashing) works.
    // Standard materials use `material.emissive * material.emissiveIntensity`.
    // In TSL, we can bind the material's emissive color property as a uniform so changes on CPU (reactivity) reflect here.
    const uEmissive = uniform(instanceCapMat.emissive); // Binds to the JS .emissive color object

    // Pass positional arguments to match TSL Fn definition: [color, intensity, power]
    const rimEffect = createRimLight(color(0xFFFFFF), float(0.4), float(3.0));

    // Compose: Standard Emissive + Rim Light
    instanceCapMat.emissiveNode = uEmissive.add(rimEffect);
    // -----------------------------------------------

    const cap = new THREE.Mesh(capGeo, instanceCapMat);
    cap.position.y = stemH - (capR * 0.2);
    cap.castShadow = true;
    cap.receiveShadow = true;
    group.add(cap);

    // Gills (Cone)
    const gillGeo = new THREE.ConeGeometry(capR * 0.9, capR * 0.4, 24, 1, true);
    const gillMat = foliageMaterials.mushroomGills;
    const gill = new THREE.Mesh(gillGeo, gillMat);
    gill.position.y = stemH - (capR * 0.2);
    gill.rotation.x = Math.PI;
    group.add(gill);

    // Spots - vary pattern based on note
    const spotCount = actualNoteIndex >= 0 ? (3 + actualNoteIndex % 5) : (3 + Math.floor(Math.random() * 5));
    const spotGeo = new THREE.SphereGeometry(capR * 0.15, 6, 6);
    const spotMat = foliageMaterials.mushroomSpots;
    
    // Add note-colored accent spots if this is a musical mushroom
    let accentSpotMat = spotMat;
    if (noteColor !== null) {
        // Create tinted spot material
        accentSpotMat = spotMat.clone();
        const tintColor = new THREE.Color(noteColor);
        // Blend white with note color for subtle tint
        accentSpotMat.color.copy(new THREE.Color(0xFFFFFF).lerp(tintColor, 0.4));
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
        const spot = new THREE.Mesh(spotGeo, useAccent ? accentSpotMat : spotMat);
        spot.position.set(x, y + stemH - (capR * 0.2), z);
        spot.scale.set(1, 0.2, 1);
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
        const smileGeo = new THREE.TorusGeometry(0.12, 0.04, 6, 12, Math.PI);
        const smile = new THREE.Mesh(smileGeo, foliageMaterials.clayMouth);
        smile.rotation.z = Math.PI;
        smile.position.set(0, -0.05, 0.1);

        // Cheeks (Rosy!)
        const cheekGeo = new THREE.SphereGeometry(0.08, 8, 8);
        const leftCheek = new THREE.Mesh(cheekGeo, foliageMaterials.mushroomCheek);
        leftCheek.position.set(-0.25, 0.0, 0.05);
        leftCheek.scale.set(1, 0.6, 0.5);

        const rightCheek = new THREE.Mesh(cheekGeo, foliageMaterials.mushroomCheek);
        rightCheek.position.set(0.25, 0.0, 0.05);
        rightCheek.scale.set(1, 0.6, 0.5);

        faceGroup.add(leftEye, rightEye, smile, leftCheek, rightCheek);
        group.add(faceGroup);
    }

    // Giant Breathing Effect & Pulsing Stripes (TSL)
    if (isGiant) {
        const breathMat = new MeshStandardNodeMaterial({
            color: instanceCapMat.color, // Use the clay color
            roughness: 0.8,
            metalness: 0.0,
        });

        const pos = positionLocal;
        const breathSpeed = time.mul(2.0);
        const breath = sin(breathSpeed).mul(0.1).add(1.0);
        // Displace vertices for breathing
        breathMat.positionNode = pos.mul(breath);

        // Animated Emission Stripes
        // Use positionLocal.y to create horizontal stripes
        // Use time to move them upwards
        const stripeFreq = 10.0;
        const stripeSpeed = 2.0;
        const stripePattern = sin(pos.y.mul(stripeFreq).sub(time.mul(stripeSpeed)));

        // Clamp to 0-1 and sharpen
        const stripeIntensity = stripePattern.add(1.0).mul(0.5).pow(2.0);

        // Base color pulse + Stripe overlay
        const basePulse = sin(breathSpeed.mul(2.0)).mul(0.1).add(0.2);
        const totalEmission = stripeIntensity.mul(0.3).add(basePulse);

        breathMat.emissiveNode = color(instanceCapMat.color).mul(totalEmission);

        cap.material = breathMat;
        // Keep reference for reactivity override
        instanceCapMat.colorNode = breathMat.colorNode;
    }

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
        const flashColor = group.userData.noteColor 
            ? new THREE.Color(group.userData.noteColor)
            : new THREE.Color(colorVal);
            
        cap.userData.flashColor = flashColor;
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

    return group;
}
