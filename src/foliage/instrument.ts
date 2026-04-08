import * as THREE from 'three';
import {
    createUnifiedMaterial,
    sharedGeometries,
    attachReactivity
} from './index.ts';
import {
    color, float, mix, uv, sin, cos,
    vec3, vec2, floor, smoothstep, abs, mx_noise_float, uniform
} from 'three/tsl';
import { makeInteractive } from '../utils/interaction-utils.ts';
import { unlockSystem } from '../systems/unlocks.ts';
import { spawnImpact } from './impacts.ts';

const _scratchPos = new THREE.Vector3();
const _scratchUp = new THREE.Vector3(0, 1, 0);

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
    // We use uniforms so the puzzle pattern can be cycled on interact
    const uInstrumentID = uniform(instrumentID);

    // --- Instrument-ID Textures (Advanced Shaders) ---
    // Procedural patterns generated based on Instrument ID
    const pUV = uv().mul(10.0);
    const timeOffset = pUV.x.add(pUV.y).add(uInstrumentID);

    // Pattern 1: Grid-like (e.g. for structured synth instruments)
    const patternGrid = sin(pUV.x.add(uInstrumentID)).mul(cos(pUV.y.add(uInstrumentID)));

    // Pattern 2: Noise-like (e.g. for organic or percussive instruments)
    const patternNoise = mx_noise_float(vec3(pUV.x, pUV.y, uInstrumentID));

    // Pattern 3: Concentric ripples
    const distToCenter = vec2(pUV.x.sub(5.0), pUV.y.sub(5.0)).length();
    const patternRipple = sin(distToCenter.mul(3.0).sub(uInstrumentID.mul(2.0)));

    // Pattern 4: Diagonal stripes
    const patternStripes = sin(pUV.x.add(pUV.y).mul(5.0).add(uInstrumentID.mul(10.0)));

    // Smooth blending across 4 distinct pattern types based on Instrument ID modulo
    // We use a pseudo-modulo trick: id - 4 * floor(id/4)
    const mod4 = uInstrumentID.sub(floor(uInstrumentID.div(4.0)).mul(4.0));

    // Create blend masks using smoothstep for distinct pattern transitions
    const maskGrid = float(1.0).sub(smoothstep(0.0, 1.0, abs(mod4.sub(0.0))));
    const maskNoise = float(1.0).sub(smoothstep(0.0, 1.0, abs(mod4.sub(1.0))));
    const maskRipple = float(1.0).sub(smoothstep(0.0, 1.0, abs(mod4.sub(2.0))));
    const maskStripes = float(1.0).sub(smoothstep(0.0, 1.0, abs(mod4.sub(3.0))));

    // Combine all patterns weighted by their masks
    const combinedPattern = patternGrid.mul(maskGrid)
        .add(patternNoise.mul(maskNoise))
        .add(patternRipple.mul(maskRipple))
        .add(patternStripes.mul(maskStripes));

    const pattern = combinedPattern;

    // Colorize
    // Map ID to Hue and pass via Uniform to allow dynamic updating
    const jsHue = (instrumentID * 0.1) % 1.0;
    const jsColor = new THREE.Color().setHSL(jsHue, 1.0, 0.5);
    const uBaseColor = uniform(jsColor);

    // Apply pattern to emissive
    shrineMat.emissiveNode = uBaseColor.mul(pattern.add(0.5).mul(2.0)); // Glow

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
    group.userData.interactionText = `Tune Shrine (Current: ${instrumentID})`; // Shortened for UI fit

    // Store uniforms on userData so they can be updated
    group.userData.uInstrumentID = uInstrumentID;
    group.userData.uBaseColor = uBaseColor;
    group.userData.jsColor = jsColor;

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
            _scratchPos.copy(group.position).y += 3.0;
            spawnImpact(_scratchPos, 'muzzle', group.userData.jsColor, _scratchUp);

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
            // Cycle the puzzle ID!
            group.userData.instrumentID = (group.userData.instrumentID + 1) % 16;

            // Update Uniforms
            group.userData.uInstrumentID.value = group.userData.instrumentID;
            group.userData.jsColor.setHSL((group.userData.instrumentID * 0.1) % 1.0, 1.0, 0.5);

            // Interaction Text Update
            group.userData.interactionText = `Tune Shrine (Current: ${group.userData.instrumentID})`;

            // Audio feedback for cycling
            if ((window as any).AudioSystem && (window as any).AudioSystem.playSound) {
                 (window as any).AudioSystem.playSound('click', { position: group.position, pitch: 1.0 + (group.userData.instrumentID * 0.05), volume: 0.5 });
            }
        }

        if (originalInteract) originalInteract();
    };

    return interactive;
}
