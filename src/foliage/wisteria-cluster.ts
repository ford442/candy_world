import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { ShaderNodeObject, Node } from 'three/tsl';
import {
    time, positionLocal, sin, cos, positionWorld, color, vec3, mix, float, smoothstep
} from 'three/tsl';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import { CONFIG } from '../core/config.ts';
import { BiomeUniforms, uCircadianPhase, circadianNightGlowMult } from '../systems/biome-uniforms.ts';
import { discoverySystem } from '../systems/discovery.ts';
import { makeInteractive } from '../utils/interaction-utils.ts';
import { attachReactivity } from './foliage-reactivity.ts';
import { spawnImpact } from './impacts.ts';
import { CandyPresets, uAudioHigh, uAudioLow, uTime, createJuicyRimLight, getCachedProceduralMaterial, applyPlayerInteraction, calculateWindSway, calculatePlayerPush } from './material-core.ts';
import { uTwilight } from './sky.ts';

export interface WisteriaClusterOptions {
    scale?: number;
    color?: number;
}

let _cachedMergedGeo: THREE.BufferGeometry | null = null;
let _cachedHitGeo: THREE.BufferGeometry | null = null;

/**
 * Creates a cluster of hanging musical vines (Wisteria) that respond to high frequencies.
 */
export function createWisteriaCluster(options: WisteriaClusterOptions = {}) {
    const { scale = 1.0, color: baseHexColor = 0x9B6A9C } = options; // Soft purple clay by default
    const group = new THREE.Group();

    // Aesthetic: "Cute Clay"
    // Use the generic Clay preset and apply audio-reactive TSL deformation.
    // Cache the material to prevent WebGPU compilation freezes
    const material = getCachedProceduralMaterial(`wisteria_cluster_${baseHexColor}`, baseHexColor, () => {
        const mat = CandyPresets.Clay(baseHexColor, {
            roughness: 0.9,
            bumpStrength: 0.1
        });

        // --- TSL Audio-Reactive Sway ---
        // Make it sway organically based on world position and uTime.
        // High frequency audio (uAudioHigh) acts as an impulse/energy multiplier.
        const baseSwayFreq = float(2.0);
        // ADSR Style scale + emissive reaction to high frequency
        const audioEnergy = uAudioHigh.mul(1.5).add(0.5); // Music Impact: hang amp + glow

        // Offset based on positionWorld so multiple clusters aren't perfectly synced
        const swayPhase = positionWorld.x.mul(0.5).add(positionWorld.z.mul(0.3));

        // Calculate sway amount. The top of the vine (y > 0) shouldn't move as much as the bottom (y < 0).
        // Assuming the geometry is created such that it hangs down from y=0.
        // If geometry goes from y=0 to y=-length, then hangFactor goes from 0 to 1.
        // Let's use positionLocal.y.
        // Assume cluster is about 4 units long, so positionLocal.y goes from 0 down to -4.
        const hangFactor = positionLocal.y.div(-4.0).clamp(0.0, 1.0);

        // Music Impact: hang sway × audioEnergy
        const hangSway = vec3(
            sin(uTime.mul(baseSwayFreq).add(swayPhase)).mul(0.5),
            float(0.0),
            cos(uTime.mul(baseSwayFreq.mul(0.8)).add(swayPhase)).mul(0.5)
        ).mul(audioEnergy).mul(hangFactor);

        // Apply night droop (phase→0 at night)
        const circadianDroop = vec3(0, float(-0.4).mul(float(1.0).sub(uCircadianPhase)).mul(hangFactor), 0);

        // Proxy height for wind and player interactions since Wisteria hangs downward (negative Y)
        const proxyPos = vec3(positionLocal.x, hangFactor.mul(4.0), positionLocal.z);

        const wind = calculateWindSway(proxyPos); // proxy: tip bends more
        const playerPush = calculatePlayerPush(proxyPos);

        const pos = positionLocal.add(hangSway).add(circadianDroop).add(wind);
        mat.positionNode = pos.add(playerPush);

        // Glow Effect based on audio
        const baseColorNode = color(baseHexColor);
        const glowColor = color(0xFF66FF); // Neon pink glow
        // Emissive boost driven by uAudioHigh, fading in smoothly — nocturnal gate
        const nightGlow = circadianNightGlowMult();
        mat.emissiveNode = glowColor.mul(BiomeUniforms.arpeggioGrove.noteColor).mul(uAudioHigh.mul(0.8)).mul(nightGlow);

        // 🎨 PALETTE: Juicy Rim Light for volumetric glow
        const rimLight = createJuicyRimLight(color(0xFFFFFF), float(1.5), float(3.0), null);
        mat.emissiveNode = (mat.emissiveNode as ShaderNodeObject<Node>).add(rimLight.mul(nightGlow));

        // 🎨 PALETTE: Twilight Glow for wisteria
        const glowPhaseOffset = positionWorld.x.mul(0.5).add(positionWorld.z.mul(0.3));
        const idlePulse = sin(time.mul(float(CONFIG.glow.glowPulseFrequency)).add(glowPhaseOffset)).mul(float(CONFIG.glow.glowPulseAmplitude)).add(1.0).mul(float(0.5)).mul(uAudioLow.mul(0.3).add(0.7));
        const targetGlowColor = color(CONFIG.glow.glowColorMap['wisteria']);
        const twilightGlowTint = targetGlowColor
            .mul(uTwilight)
            .mul(float(CONFIG.glow.glowIntensityMax))
            .mul(float(0.3).add(idlePulse));

        // ADSR Glow based on tracker channel (sky_moon base color, reactive)
        // Here we just use audioEnergy for a simple ADSR-like reaction
        const baseAdsrGlow = targetGlowColor.mul(audioEnergy).mul(0.3).mul(nightGlow);

        mat.emissiveNode = (mat.emissiveNode as ShaderNodeObject<Node>).add(twilightGlowTint).add(baseAdsrGlow);

        return mat;
    }) as MeshStandardNodeMaterial;

    // --- Geometry Construction ---
    // We create a central hanging stem and several rounded clusters ("grapes" / "petals") hanging off it.

    // Use cached geometry to avoid VRAM leak
    if (!_cachedMergedGeo) {
        const geometries: THREE.BufferGeometry[] = [];

        const vineGeo = new THREE.CylinderGeometry(0.1, 0.05, 4, 8);
        // Shift geometry so the top is at y=0, bottom is at y=-4
        vineGeo.translate(0, -2, 0);
        geometries.push(vineGeo);

        // Add rounded "clusters" (flowers) along the vine
        const clusterGeoBase = new THREE.SphereGeometry(0.4, 16, 16);

        for (let i = 0; i < 5; i++) {
            const clusterGeo = clusterGeoBase.clone();

            // Position them down the vine
            const yPos = -0.5 - (i * 0.7);
            // Offset slightly in x/z for organic look
            const xOffset = (Math.random() - 0.5) * 0.5;
            const zOffset = (Math.random() - 0.5) * 0.5;

            // Vary size
            const s = 1.0 - (i * 0.1); // smaller towards the bottom

            clusterGeo.scale(s, s, s);
            clusterGeo.translate(xOffset, yPos, zOffset);

            geometries.push(clusterGeo);
        }

        _cachedMergedGeo = mergeGeometries(geometries);

        // Clean up temporary geometries to prevent memory leaks
        vineGeo.dispose();
        clusterGeoBase.dispose();
        for (let i = 1; i < geometries.length; i++) {
            geometries[i].dispose();
        }
    }

    const mainMesh = new THREE.Mesh(_cachedMergedGeo, material);
    group.add(mainMesh);

    // Add an invisible hitbox for interaction since the visual mesh hangs down
    if (!_cachedHitGeo) {
        _cachedHitGeo = new THREE.CylinderGeometry(1.0, 1.0, 4);
    }
    const hitMat = new THREE.MeshBasicMaterial({ visible: false });
    const hitMesh = new THREE.Mesh(_cachedHitGeo, hitMat);
    hitMesh.position.y = -2;
    group.add(hitMesh);

    group.scale.setScalar(scale);

    group.userData.type = 'wisteria_cluster';
    group.userData.interactionText = "Commune";

    // Interaction
    group.userData.onInteract = () => {
        // Just trigger a discovery if not already discovered, and visual feedback
        discoverySystem.discover('wisteria_cluster', 'Wisteria Cluster', '🍇');

        // Visual feedback (Particles)
        spawnImpact(group.position, 'spore', baseHexColor);

        // Audio variation
        if ((window as any).AudioSystem && (window as any).AudioSystem.playSound) {
            (window as any).AudioSystem.playSound('impact', { position: group.position, pitch: Math.random() * 0.2 + 0.9 });
        }

        // Visual pop
        group.scale.setScalar(scale * 1.2);
        setTimeout(() => {
            group.scale.setScalar(scale);
        }, 150);
    };

    const interactive = makeInteractive(group);

    // Ensure reactivity flag is attached
    return attachReactivity(interactive);
}
