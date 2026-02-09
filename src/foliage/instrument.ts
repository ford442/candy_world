import * as THREE from 'three';
import {
    createUnifiedMaterial,
    sharedGeometries,
    attachReactivity
} from './common.ts';
import {
    color, float, mix, uv, sin, cos,
    vec3, mx_noise_float
} from 'three/tsl';
import { makeInteractive } from './musical_flora.ts';
import { unlockSystem } from '../systems/unlocks.ts';
import { spawnImpact } from './impacts.ts';

export interface InstrumentShrineOptions {
    instrumentID?: number;
    scale?: number;
}

export function createInstrumentShrine(options: InstrumentShrineOptions = {}): THREE.Group {
    const {
        instrumentID = 0,
        scale = 1.0
    } = options;

    const group = new THREE.Group();

    // The Shrine is a monolith that displays patterns based on the Instrument ID.
    // 0 = Drums, 1 = Bass, etc (in standard MOD files instruments are 1-based usually).

    const shrineMat = createUnifiedMaterial(0x333333, {
        roughness: 0.2,
        metalness: 0.8,
        bumpStrength: 0.1
    });

    // Custom TSL override for Color based on Instrument ID
    // We create a procedural pattern
    const id = float(instrumentID);

    // Pattern Logic:
    // Generate a pattern based on UV and ID
    const pUV = uv().mul(10.0);

    // Different math for different ID ranges for variety
    const patternA = sin(pUV.x.add(id)).mul(cos(pUV.y.add(id))); // Grid-like
    const patternB = mx_noise_float(vec3(pUV.x, pUV.y, id)); // Noise-like

    // Mix based on ID modulo
    // We can't use modulo easily in TSL without some work, so let's just use sin(id) to mix
    const mixFactor = sin(id.mul(0.5)).add(1.0).mul(0.5); // 0 to 1

    const pattern = mix(patternA, patternB, mixFactor);

    // Colorize
    // Map ID to Hue (Calculate in JS since ID is constant per instance)
    const jsHue = (instrumentID * 0.1) % 1.0;
    const jsColor = new THREE.Color().setHSL(jsHue, 1.0, 0.5);

    const baseCol = color(jsColor);

    // Apply pattern to emissive
    shrineMat.emissiveNode = baseCol.mul(pattern.add(0.5).mul(2.0)); // Glow

    // Geometry: Monolith
    const geo = new THREE.BoxGeometry(1, 3, 1);
    const mesh = new THREE.Mesh(geo, shrineMat);
    mesh.scale.set(scale, scale, scale);
    mesh.position.y = 1.5 * scale;
    mesh.castShadow = true;

    group.add(mesh);

    // Floating symbol on top (Sphere)
    const orbMat = createUnifiedMaterial(0xFFFFFF, {
        transmission: 1.0,
        thickness: 1.0,
        roughness: 0.0,
        ior: 1.5,
        iridescenceStrength: 1.0
    });
    const orb = new THREE.Mesh(sharedGeometries.unitSphere, orbMat);
    orb.position.y = 3.5 * scale;
    orb.scale.setScalar(0.5 * scale);
    group.add(orb);

    // Store orb for animation
    group.userData.orb = orb;
    group.userData.orbMat = orbMat;

    group.userData.type = 'instrumentShrine';
    group.userData.instrumentID = instrumentID;

    // Use specific animation type for logic
    group.userData.animationType = 'instrumentShrine';
    group.userData.animationOffset = Math.random() * 100;

    // Puzzle State
    group.userData.isActive = false; // Is matching instrument playing?
    group.userData.isSolved = false; // Has player activated it?
    group.userData.interactionText = `Locked (Need Inst ${instrumentID})`; // Shortened for UI fit

    // Reactivity
    attachReactivity(group, { minLight: 0.0, maxLight: 1.0 });

    const interactive = makeInteractive(group);

    // Override interaction
    const originalInteract = group.userData.onInteract;
    group.userData.onInteract = () => {
        if (group.userData.isSolved) {
            // Already solved feedback
            // Maybe toggle something else or just show sparkle
             if ((window as any).AudioSystem) {
                // Play a small 'already done' sound if available, or just generic click
            }
            return;
        }

        if (group.userData.isActive) {
            // Solve!
            group.userData.isSolved = true;
            group.userData.interactionText = "Shrine Activated";

            // Visual feedback
            spawnImpact(group.position.clone().add(new THREE.Vector3(0, 3, 0)), 'muzzle', { color: {r:jsColor.r, g:jsColor.g, b:jsColor.b}, direction: new THREE.Vector3(0,1,0) });

            // Audio feedback
            if ((window as any).AudioSystem && (window as any).AudioSystem.playSound) {
                 (window as any).AudioSystem.playSound('chime', { position: group.position, pitch: 1.0, volume: 0.8 });
            }

            // Reward
            unlockSystem.harvest('shrine_token', 1, 'Shrine Token');

            // Update visual state immediately
            orbMat.emissive.set(0xFFD700); // Turn Gold
            orbMat.emissiveIntensity = 2.0;

        } else {
             // Locked feedback
             if ((window as any).AudioSystem && (window as any).AudioSystem.playSound) {
                 (window as any).AudioSystem.playSound('click', { position: group.position, pitch: 0.5, volume: 0.5 });
            }
        }

        if (originalInteract) originalInteract();
    };

    return interactive;
}
