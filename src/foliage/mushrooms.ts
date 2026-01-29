// src/foliage/mushrooms.ts

import * as THREE from 'three';
import { mushroomBatcher } from './mushroom-batcher.ts';
import { sharedGeometries } from './common.ts';

// Interface for Note Definition
export interface MushroomNote {
    note: string;
    color: number;
    name: string;
}

// 12 Chromatic Notes with their corresponding colors
// Colors are defined here to match CONFIG.noteColorMap.mushroom palette
export const MUSHROOM_NOTES: MushroomNote[] = [
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

// ⚡ PERFORMANCE: Material cache size (Mocked as we use Batcher now)
export function getMaterialCacheSize(): number {
    return 1;
}

export interface MushroomOptions {
    size?: 'regular' | 'giant';
    scale?: number;
    colorIndex?: number;
    hasFace?: boolean;
    isBouncy?: boolean;
    note?: string | null;
    noteIndex?: number;
    spawnTime?: number;
    isBioluminescent?: boolean;
}

export function createMushroom(options: MushroomOptions = {}): THREE.Group {
    const {
        size = 'regular',
        scale = 1.0,
        colorIndex = -1,
        hasFace = false,
        isBouncy = false,
        note = null,
        noteIndex = -1,
        spawnTime = -100.0, // Allow overriding spawn time (for pop-in)
        isBioluminescent = false
    } = options;

    const group = new THREE.Group();
    const isGiant = size === 'giant';

    // Determine properties for batcher
    let actualNoteIndex = -1;
    let noteColor: number | null = null;
    let musicalNote: string | null = null;

    if (noteIndex >= 0 && noteIndex < MUSHROOM_NOTES.length) {
        actualNoteIndex = noteIndex;
        musicalNote = MUSHROOM_NOTES[noteIndex].note;
        noteColor = MUSHROOM_NOTES[noteIndex].color;
    } else if (note) {
        const found = MUSHROOM_NOTES.find(n => n.note === note);
        if (found) {
            actualNoteIndex = MUSHROOM_NOTES.indexOf(found);
            musicalNote = found.note;
            noteColor = found.color;
        }
    }

    // HitBox for Physics/Collision (Invisible)
    // Scale Cylinder to approximate mushroom bounds
    // Base Scale * Giant Scale
    // Giant ~ 8.0, Reg ~ 1.0
    const baseScale = isGiant ? 8.0 * scale : 1.0 * scale;
    const hitBox = new THREE.Mesh(sharedGeometries.unitCylinder, new THREE.MeshBasicMaterial({ visible: false }));
    // Cylinder is 1x1x1 centered at 0.5Y.
    // Mushroom is roughly width 0.4 to 1.2 * baseScale, height 1.2 * baseScale.
    hitBox.scale.set(baseScale * 0.5, baseScale * 1.2, baseScale * 0.5);
    // HitBox is child of group, so transform is local.
    group.add(hitBox);

    // Metadata
    group.userData.type = 'mushroom';
    group.userData.size = size;
    group.userData.isTrampoline = isGiant || isBouncy;
    
    if (musicalNote) {
        group.userData.musicalNote = musicalNote;
        group.userData.noteColor = noteColor;
        group.userData.noteIndex = actualNoteIndex;
    }

    // Deferred Registration (to allow positioning before matrix capture)
    // safeAddFoliage calls this.
    group.userData.onPlacement = () => {
        // Calculate options for batcher
        const batchOptions = {
            hasFace: isGiant || hasFace, // Giants always have faces
            noteIndex: actualNoteIndex,
            size: size,
            noteColor: noteColor,
            spawnTime: spawnTime
        };

        // If no note color but colorIndex provided, pick a color?
        // Current batcher implementation expects `noteColor` (hex) or defaults.
        // We can map `colorIndex` to a color if needed, but for now we stick to Note Colors or default.
        
        // ⚡ OPTIMIZATION: Register instance to Batcher (Visuals)
        mushroomBatcher.register(group, batchOptions);

        // Clear callback to avoid re-registration
        group.userData.onPlacement = null;
    };

    return group;
}

export function replaceMushroomWithGiant(scene: THREE.Scene, oldMushroom: THREE.Object3D): THREE.Object3D | null {
    if (!oldMushroom || !oldMushroom.parent) return null;

    const position = oldMushroom.position.clone();
    const rotation = oldMushroom.rotation.clone();

    const colorIndex = oldMushroom.userData.colorIndex;
    const noteIndex = oldMushroom.userData.noteIndex;

    // Remove old logic object
    oldMushroom.parent.remove(oldMushroom);

    // Current Time for pop animation
    const now = performance.now() / 1000.0;

    const newGiant = createMushroom({
        size: 'giant',
        scale: 1.0,
        colorIndex: colorIndex,
        noteIndex: noteIndex,
        hasFace: true,
        isBouncy: true,
        spawnTime: now // Trigger pop-in animation
    });

    newGiant.position.copy(position);
    newGiant.rotation.copy(rotation);

    // Manually trigger placement since we bypass safeAddFoliage
    if (newGiant.userData.onPlacement) {
        // @ts-ignore - Dynamic property
        newGiant.userData.onPlacement();
    }

    scene.add(newGiant);

    return newGiant;
}
