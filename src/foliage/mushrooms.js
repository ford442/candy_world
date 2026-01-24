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

// ⚡ PERFORMANCE: Material cache to prevent ~3000 shader compilations
// Create one material per note (12 total) * 2 sizes (Regular/Giant) = 24 total
const _mushroomCapMaterialCache = new Map();
const _mushroomGillMaterialCache = new Map();

// Helper to apply common TSL logic (Squish, Rim, Glow) to a mushroom material
function applyMushroomTSL(material, isGiant) {
    // 1. TSL Squish Animation (Vertex Position)
    const pos = positionLocal;
    // Idle Breathing (Slower for giants)
    const breathSpeed = time.mul(isGiant ? 2.0 : 3.0);
    const breathAmount = float(isGiant ? 0.05 : 0.02);
    const breathCycle = sin(breathSpeed);
    // Audio Reaction (Kick Drum Squish)
    const kickSquish = uAudioLow.mul(0.15); // Max 15% deformation on kick

    // Total Vertical Scale
    const totalScaleY = float(1.0).add(breathCycle.mul(breathAmount)).sub(kickSquish);
    const totalScaleXZ = float(1.0).sub(breathCycle.mul(breathAmount).mul(0.5)).add(kickSquish.mul(0.5));

    const newPos = vec3(
        pos.x.mul(totalScaleXZ),
        pos.y.mul(totalScaleY),
        pos.z.mul(totalScaleXZ)
    );
    material.positionNode = newPos;

    // 2. Audio-Reactive Rim Light & Emission
    const uEmissive = uniform(material.emissive);
    const rimIntensity = float(0.4).add(uAudioHigh.mul(0.5));
    const rimEffect = createRimLight(color(0xFFFFFF), rimIntensity, float(3.0));
    const twilightGlow = color(material.color).mul(uTwilight).mul(0.4);

    let finalEmissiveNode = uEmissive.add(rimEffect).add(twilightGlow);

    // 3. Giant Features (Stripes)
    if (isGiant) {
        const stripeFreq = 10.0;
        const stripeSpeed = 2.0;
        const stripePattern = sin(newPos.y.mul(stripeFreq).sub(time.mul(stripeSpeed)));
        const stripeIntensity = stripePattern.add(1.0).mul(0.5).pow(2.0);
        const basePulse = sin(breathSpeed.mul(2.0)).mul(0.1).add(0.2);
        const stripeColor = color(material.color).mul(0.5);
        finalEmissiveNode = finalEmissiveNode.add(stripeColor.mul(stripeIntensity.mul(0.5).add(basePulse)));
    }

    material.emissiveNode = finalEmissiveNode;
}

function getOrCreateNoteMaterial(noteIndex, noteColor, isGiant) {
    const key = `${noteIndex}_${isGiant}`;
    if (!_mushroomCapMaterialCache.has(key)) {
        const baseCapMat = foliageMaterials.mushroomCap[0] || foliageMaterials.mushroomStem;
        const cached = baseCapMat.clone();
        cached.color.setHex(noteColor);
        cached.roughness = 0.7;
        cached.userData.isClone = true;
        cached.userData.baseEmissive = new THREE.Color(0x000000);
        cached.userData.noteColor = new THREE.Color(noteColor);

        // Apply TSL logic once
        applyMushroomTSL(cached, isGiant);

        _mushroomCapMaterialCache.set(key, cached);
        console.log(`[Mushroom Cache] Created material for note ${MUSHROOM_NOTES[noteIndex].note} (${isGiant ? 'Giant' : 'Reg'}) - Cache Size: ${_mushroomCapMaterialCache.size}`);
    }
    return _mushroomCapMaterialCache.get(key);
}

function getOrCreateGillMaterial(noteIndex, noteColor) {
    if (!_mushroomGillMaterialCache.has(noteIndex)) {
        const baseGillMat = foliageMaterials.mushroomGills;
        const cached = baseGillMat.clone();
        cached.userData.isClone = true;
        const lightColor = new THREE.Color(noteColor);
        cached.emissive = lightColor.clone().multiplyScalar(0.3);
        cached.emissiveIntensity = 0.3;
        _mushroomGillMaterialCache.set(noteIndex, cached);
    }
    return _mushroomGillMaterialCache.get(noteIndex);
}

// ⚡ PERFORMANCE: Export for verification
export function getMaterialCacheSize() {
    return _mushroomCapMaterialCache.size + _mushroomGillMaterialCache.size;
}

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
        // ⚡ PERFORMANCE: Use cached material (Includes TSL logic)
        capMat = getOrCreateNoteMaterial(actualNoteIndex, noteColor, isGiant);
        chosenColorIndex = actualNoteIndex;
    } else if (colorIndex >= 0 && colorIndex < foliageMaterials.mushroomCap.length) {
        chosenColorIndex = colorIndex;
        capMat = foliageMaterials.mushroomCap[chosenColorIndex];
    } else {
        chosenColorIndex = Math.floor(Math.random() * foliageMaterials.mushroomCap.length);
        capMat = foliageMaterials.mushroomCap[chosenColorIndex];
    }

    // For non-musical mushrooms, still clone material to allow individual emissive strobing
    const instanceCapMat = noteColor !== null ? capMat : capMat.clone();

    // If it's NOT a cached material (non-musical), we need to apply the TSL logic manually
    // AND ensure base emissive is set
    if (noteColor === null) {
        instanceCapMat.userData.isClone = true;
        instanceCapMat.userData.baseEmissive = new THREE.Color(0x000000);
        applyMushroomTSL(instanceCapMat, isGiant);
    }

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
    // ⚡ PERFORMANCE: Reuse the same cached material as the cap
    const accentSpotMat = noteColor !== null ? capMat : spotMat;

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
        spot.scale.set(spotRadius, spotRadius * 0.2, spotRadius);
        spot.lookAt(0, stemH + capR, 0);
        group.add(spot);
    }

    // Face
    if (showFace) {
        const faceGroup = new THREE.Group();
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

        // Cheeks
        const leftCheek = new THREE.Mesh(sharedGeometries.sphereLow, foliageMaterials.mushroomCheek);
        leftCheek.position.set(-0.25, 0.0, 0.05);
        leftCheek.scale.set(0.08, 0.048, 0.04);

        const rightCheek = new THREE.Mesh(sharedGeometries.sphereLow, foliageMaterials.mushroomCheek);
        rightCheek.position.set(0.25, 0.0, 0.05);
        rightCheek.scale.set(0.08, 0.048, 0.04);

        faceGroup.add(leftEye, rightEye, smile, leftCheek, rightCheek);
        group.add(faceGroup);
    }

    group.userData.animationType = pickAnimation(['wobble', 'bounce', 'accordion']);
    group.userData.animationOffset = Math.random() * 10;
    group.userData.type = 'mushroom';
    group.userData.interactionText = "Bounce!";
    group.userData.colorIndex = typeof chosenColorIndex === 'number' ? chosenColorIndex : -1;
    
    if (mushroomNote) {
        group.userData.musicalNote = mushroomNote.note;
        group.userData.noteColor = noteColor;
        group.userData.noteIndex = actualNoteIndex;
    }
    
    // --- NEW: Bioluminescence Logic ---
    const shouldGlow = mushroomNote !== null || options.isBioluminescent;
    
    if (shouldGlow) {
        const lightColor = noteColor !== null 
            ? new THREE.Color(noteColor) 
            : ((instanceCapMat && instanceCapMat.color) ? instanceCapMat.color : new THREE.Color(0x00FF88));

        const light = new THREE.PointLight(lightColor, 0, 4.0);
        light.position.set(0, stemH * 0.5, 0);
        group.add(light);
        group.userData.glowLight = light;

        if (gill && gill.material) {
            // ⚡ PERFORMANCE: Use cached gill material for musical mushrooms
            if (noteColor !== null) {
                gill.material = getOrCreateGillMaterial(actualNoteIndex, noteColor);
            } else {
                gill.material = gill.material.clone();
                gill.material.userData.isClone = true;
                gill.material.emissive = lightColor.clone().multiplyScalar(0.3);
                gill.material.emissiveIntensity = 0.3;
            }
        }

        group.userData.isBioluminescent = true;
    }

    // --- IMPORTANT: Metadata for Weather System ---
    group.userData.size = size;
    group.userData.capRadius = capR;
    group.userData.capHeight = stemH;
    group.userData.stemRadius = stemR;
    
    group.userData.radius = capR * 1.2;

    group.userData.reactiveMeshes = [cap];

    if (isGiant || isBouncy) {
        group.userData.isTrampoline = true;
    }

    attachReactivity(group, { minLight: 0.0, maxLight: 0.6, type: 'flora' });

    // Custom Reactivity Method: Note-specific Blink & Bounce
    group.reactToNote = (note, colorVal, velocity) => {
        if (group.userData.musicalNote) {
            let playedNote = note;
            if (typeof note === 'string') {
                playedNote = note.replace(/[0-9-]/g, '');
            } else if (typeof note === 'number') {
                const CHROMATIC = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
                playedNote = CHROMATIC[note % 12];
            }
            
            if (playedNote !== group.userData.musicalNote) {
                return;
            }
        }
        
        if (group.userData.noteColor) {
            _foliageReactiveColor.setHex(group.userData.noteColor);
        } else {
            _foliageReactiveColor.setHex(colorVal);
        }
            
        if (!cap.userData.flashColor) {
            cap.userData.flashColor = new THREE.Color();
        }
        cap.userData.flashColor.copy(_foliageReactiveColor);

        cap.userData.flashIntensity = 1.5 + (velocity * 2.5);
        cap.userData.flashDecay = 0.15;

        if (group.userData.glowLight) {
            const light = group.userData.glowLight;
            light.intensity = 2.0 + (velocity * 3.0);
            if (!light.userData.baseIntensity) {
                light.userData.baseIntensity = 0.8;
            }
        }

        const squash = 1.0 - (velocity * 0.3);
        const stretch = 1.0 + (velocity * 0.3);
        group.scale.set(baseScale * stretch, baseScale * squash, baseScale * stretch);

        group.userData.scaleTarget = baseScale;
        group.userData.scaleAnimTime = 0.08;
        group.userData.scaleAnimStart = Date.now();
    };

    import('../systems/music-reactivity.ts').then(module => {
        module.musicReactivitySystem.registerObject(group, 'mushroom');
    });

    return group;
}

// --- NEW FUNCTION ---
export function replaceMushroomWithGiant(scene, oldMushroom) {
    if (!oldMushroom || !oldMushroom.parent) return null;

    const position = oldMushroom.position.clone();
    const rotation = oldMushroom.rotation.clone();

    const colorIndex = oldMushroom.userData.colorIndex;
    const noteIndex = oldMushroom.userData.noteIndex;
    const musicalNote = oldMushroom.userData.musicalNote;
    const noteColor = oldMushroom.userData.noteColor;

    oldMushroom.parent.remove(oldMushroom);

    const newGiant = createMushroom({
        size: 'giant',
        scale: 1.0,
        colorIndex: colorIndex,
        noteIndex: noteIndex,
        hasFace: true,
        isBouncy: true
    });

    if (musicalNote) newGiant.userData.musicalNote = musicalNote;
    if (noteColor) newGiant.userData.noteColor = noteColor;

    newGiant.position.copy(position);
    newGiant.rotation.copy(rotation);

    scene.add(newGiant);

    newGiant.scale.set(0.1, 0.1, 0.1);
    const targetScale = 1.0;

    newGiant.userData.popTime = 0;
    newGiant.userData.onBeforeRender = (renderer, scene, camera, geometry, material, group) => {
        if (newGiant.userData.popTime < 1.0) {
            newGiant.userData.popTime += 0.04;
            const t = Math.min(1.0, newGiant.userData.popTime);
            const s = targetScale * (1 + 0.5 * Math.sin(t * 18) * (1-t));
            newGiant.scale.setScalar(Math.max(0.1, s));
        }
    };

    return newGiant;
}
