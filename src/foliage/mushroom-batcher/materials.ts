import { color, float, attribute, positionLocal,
    sin, smoothstep, time,
    dot, normalize, normalLocal, step, Fn, positionWorld, normalWorld,
    max, uv, floor, instanceIndex, varyingProperty, mix, vec3, cameraPosition
} from "three/tsl";
import { MeshStandardNodeMaterial } from "three/webgpu";
import { CONFIG } from "../../core/config.ts";
import { BiomeUniforms, uCircadianPoseOffset } from "../../systems/biome-uniforms.ts";
import { circadianNightGlowMult } from "../../systems/biome-uniforms.ts";
import { applyAerialPerspective, aerialPerspectiveLodBoost } from "../aerial-perspective.ts";
import {
    foliageMaterials, uTime,
    uAudioLow, uAudioHigh, createJuicyRimLight, uPlayerPosition,
    createSugarSparkle, getCachedProceduralMaterial,
    applyBaseContactAO, getBaseContactHeight,
} from "../index.ts";
import {
    scaleEmissiveByLod,
    applyStandardDeformationWithLod,
    applyFoliageLodMaterialFade} from "../lod-nodes.ts";
import { uTwilight } from "../sky.ts";
import { modFloat } from "./constants.ts";

export function createMaterials(): MeshStandardNodeMaterial[] {
        // TSL Logic - OPTIMIZED: Consolidated to single instanceData attribute
        // Packed format: x=packedFlags, y=spawnTime, z=triggerTime, w=velocity
        // packedFlags: noteIndex+1 + hasFace*20 + isGiant*40
        const instanceData = attribute("instanceData", "vec4");

        // Unpack the flags
        const packedFlags = instanceData.x;
        const hasFace = modFloat(floor(packedFlags.div(20.0)), float(2.0));
        const isGiant = modFloat(floor(packedFlags.div(40.0)), float(2.0));
        // noteIndex = (packed % 20) - 1, but we don"t need it in shader since color is set via setColorAt

        const spawnTime = instanceData.y;
        const triggerTime = instanceData.z;
        const velocity = instanceData.w;

        // --- Animations ---
        // 1. Pop-In (Spawn)
        const age = uTime.sub(spawnTime);
        const popProgress = smoothstep(0.0, 1.0, age);
        // Elastic overshoot: s = 1 + 0.5 * sin(t*18) * (1-t)
        const overshoot = sin(popProgress.mul(18.0)).mul(float(1.0).sub(popProgress)).mul(0.5);
        const popScale = popProgress.add(overshoot).max(0.001);

        // 2. Bounce (Note Trigger)
        const noteAge = uTime.sub(triggerTime);
        const isBouncing = step(0.0, noteAge).mul(step(noteAge, 0.5)); // 0.5s bounce duration
        const bouncePhase = noteAge.mul(Math.PI * 4.0); // 2 cycles
        const bounceAmount = sin(bouncePhase).mul(velocity).mul(float(1.0).sub(noteAge.mul(2.0))).max(0.0);

        // Squash/Stretch logic
        // Y Scale: 1 - bounce
        // XZ Scale: 1 + bounce
        const squashY = float(1.0).sub(bounceAmount.mul(0.3));
        const stretchXZ = float(1.0).add(bounceAmount.mul(0.3));

        // 3. Combined Scale (Audio)
        const totalScaleY = popScale.mul(squashY);
        const totalScaleXZ = popScale.mul(stretchXZ);

        // --- PALETTE: Player Interaction (Squash) ---
        const calculatePlayerSquash = Fn(() => {
            const playerDist = positionWorld.sub(uPlayerPosition);
            // Ignore Y distance (cylinder interaction)
            const distSq = dot(playerDist.xz, playerDist.xz);

            // Interaction Radius = 1.5m (Squash Zone)
            const radiusSq = float(2.25);

            // Normalized distance (0 to 1 inside radius)
            const distFactor = distSq.div(radiusSq).min(1.0);

            // Invert so 1 is at center, 0 at edge
            const strength = float(1.0).sub(distFactor);
            // Squash Y down, Bulge XZ out
            const squashAmount = strength.mul(0.6); // Max 60% squash (strong feedback)

            const scaleY = float(1.0).sub(squashAmount);
            // Volume preservation approximation: XZ scales up
            const scaleXZ = float(1.0).add(squashAmount.mul(0.5));

            return vec3(scaleXZ, scaleY, scaleXZ);
        });

        // --- PALETTE: Idle Breathing (Life) ---
        const calculateIdleBreathing = Fn(() => {
            // Sine wave based on time + random offset (using positionWorld.x/z as seed)
            const phase = uTime.mul(2.0).add(positionWorld.x).add(positionWorld.z);
            const breath = sin(phase).mul(0.05); // +/- 5% scale

            const scaleY = float(1.0).add(breath);
            const scaleXZ = float(1.0).sub(breath.mul(0.5)); // Inverse breath

            // 🎨 PALETTE: Add subtle TSL sway
            const swayPhaseX = uTime.mul(1.5).add(positionWorld.z);
            const swayPhaseZ = uTime.mul(1.2).add(positionWorld.x);
            const swayX = sin(swayPhaseX).mul(0.03);
            const swayZ = sin(swayPhaseZ).mul(0.03);

            return vec3(scaleXZ.add(swayX), scaleY, scaleXZ.add(swayZ));
        });

        // --- PALETTE: Jelly Wobble (Audio Reaction) ---
        const calculateJellyWobble = Fn(([pos]: any) => {
            // Only wobble when bouncing (triggered by note)
            // Frequency 10.0, Speed 15.0
            const wobbleFreq = float(10.0);
            const wobbleSpeed = float(15.0);

            // Phase based on height (pos.y) to create a wave traveling up
            const phase = pos.y.mul(wobbleFreq).sub(uTime.mul(wobbleSpeed));

            // Amplitude modulated by bounce state and velocity
            // isBouncing is 1.0 during the 0.5s window
            const wobbleAmp = isBouncing.mul(sin(phase)).mul(velocity).mul(0.08); // 8% wobble max

            // Apply wobble to radius (XZ expansion/contraction)
            // This creates a peristaltic motion
            return wobbleAmp;
        });

        // Deformation Function
        const deform = (pos: any) => {
            const squashScale = calculatePlayerSquash();
            const breathScale = calculateIdleBreathing();
            const wobble = calculateJellyWobble(pos);
            const circadianDroop = float(-0.5).mul(uCircadianPoseOffset).mul(pos.y);

            // Combine scales (Multiplicative)
            // Add wobble to XZ scale
            const finalScaleY = totalScaleY.mul(squashScale.y).mul(breathScale.y);
            const finalScaleXZ = totalScaleXZ.mul(squashScale.x).mul(breathScale.x).add(wobble);

            return vec3(
                pos.x.mul(finalScaleXZ),
                pos.y.mul(finalScaleY).add(circadianDroop),
                pos.z.mul(finalScaleXZ)
            );
        };

        // --- Material Definitions ---

        // 0. Stem
        const stemMat = getCachedProceduralMaterial('mushroom_stem_wind', 0xFFFFFF, () => {
            const m = (foliageMaterials.mushroomStem as MeshStandardNodeMaterial).clone();
            const defPos = deform(positionLocal);
            m.positionNode = applyStandardDeformationWithLod(defPos);
            m.colorNode = applyBaseContactAO(
                color(0xF5F5DC),
                positionLocal.y,
                float(getBaseContactHeight('mushroom')),
            );
            applyFoliageLodMaterialFade(m);
            return m;
        }) as MeshStandardNodeMaterial;

        // 1. Cap
        // PALETTE: Upgraded to use instanceColor + Juicy Rim Light
        // mushroomCap is an array of materials in common.ts
        const capList = foliageMaterials.mushroomCap as MeshStandardNodeMaterial[];
        const capMat = getCachedProceduralMaterial('mushroom_cap_wind', 0xFFFFFF, () => {
            const m = capList[0].clone();
            const defPos = deform(positionLocal);
            m.positionNode = applyStandardDeformationWithLod(defPos);
            applyFoliageLodMaterialFade(m);
            return m;
        }) as MeshStandardNodeMaterial;

        // Base color from instance (set via register/setColorAt)
        // Uses the vInstanceColor varying populated by InstancedMeshNode
        const baseColor = varyingProperty('vec3', 'vInstanceColor');

        // Add Juicy Rim Light! (Pop against background)
        // 🎨 PALETTE: Make rim light react to bass for pulsing edge glow
        const audioRimThickness = float(3.0).add(uAudioLow.mul(2.0));
        const audioRimIntensity = float(1.5).add(uAudioLow.mul(1.0));
        const rimLight = createJuicyRimLight(baseColor, audioRimIntensity, audioRimThickness, null);

        // Add Sugar Sparkle! (Palette Polish)
        // Scale 15.0 for fine grain, Density 0.3 for sparse twinkle, Intensity 2.0
        const sugarSparkle = createSugarSparkle(normalWorld, float(15.0), float(0.3), float(2.0));

        // --- PALETTE: Bioluminescent Inner Glow (Fake SSS) ---
        // Simulates light scattering inside the gummy cap
        const viewDir = normalize(cameraPosition.sub(positionWorld));
        const NdotV = dot(normalWorld, viewDir).abs(); // 1.0 at center, 0.0 at edge

        // Glow is strongest at center (thickest looking part) and driven by High Freq Audio
        // 🎨 PALETTE: Enhance High Freq glow response
        const sssIntensity = uAudioHigh.mul(1.5).add(0.2); // Base glow + Audio boost
        const innerGlowFactor = NdotV.pow(2.0).mul(sssIntensity);

        // Warm/Pink tint for the inner light
        const innerGlowColor = mix(baseColor, color(0xFFDDDD), 0.5).mul(innerGlowFactor);

        // Final Color: Base + Rim + Inner Glow, then aerial recession
        const capDiffuse = baseColor.add(rimLight).add(innerGlowColor);
        capMat.colorNode = applyAerialPerspective(capDiffuse, positionWorld, aerialPerspectiveLodBoost());

        // Emissive Logic for Cap (Bioluminescence + Flash)
        const flashIntensity = smoothstep(0.2, 0.0, noteAge).mul(velocity).mul(2.0);

        // 🎨 PALETTE: Twilight Glow System Support
        // Apply phase offset based on instance index to prevent unison pulsing
        const glowPhaseOffset = float(instanceIndex).mul(0.1);
        const glowPulseFreq = float(CONFIG.glow.glowPulseFrequency);
        const glowPulseAmp = float(CONFIG.glow.glowPulseAmplitude);

        // Use a base idle pulse that responds to audio and time with the phase offset
        const idlePulse = sin(uTime.mul(glowPulseFreq).add(glowPhaseOffset)).mul(glowPulseAmp).add(1.0).mul(float(0.5)).mul(uAudioLow.mul(0.5));

        // Get the specific twilight glow color from config and multiply by twilight window
        const targetGlowColor = color(CONFIG.glow.glowColorMap['mushroom']);
        const twilightGlowTint = targetGlowColor.mul(uTwilight).mul(float(CONFIG.glow.glowIntensityMax));
        const baseGlow = uTwilight.mul(float(0.5).add(idlePulse));

        // Combine Glow + Flash + Sparkle
        // Note: innerGlowColor is added to diffuse colorNode, so it responds to light but also self-illuminates if unlit?
        // Actually, adding to colorNode makes it appear as surface color.
        // To make it truly glow in dark, we should add some of it to emissive too?
        // Yes, let's add a fraction of inner glow to emissive for night visibility.
        const totalGlow = baseGlow.add(flashIntensity).add(sugarSparkle).add(innerGlowFactor.mul(0.3));

        // Add twilight glow directly to emissive node output
        // Circadian night-glow: mushroom caps brighten at night (phase=0), dim by day (phase=1).
        const circadianGlowMult = circadianNightGlowMult();
        capMat.emissiveNode = scaleEmissiveByLod(
            twilightGlowTint.mul(BiomeUniforms.crystallineNebula.noteColor).mul(totalGlow).mul(circadianGlowMult)
        );
        (capMat as any).emissiveIntensityNode = float(1.0); // Resetting multiplier since we multiply inside node

        // 2. Gills
        const gillMat = getCachedProceduralMaterial('mushroom_gill_wind', 0xFFFFFF, () => {
            const m = (foliageMaterials.mushroomGills as MeshStandardNodeMaterial).clone();
            const defPos = deform(positionLocal);
            m.positionNode = applyStandardDeformationWithLod(defPos);
            (m as any).emissiveIntensityNode = totalGlow.mul(0.3);
            applyFoliageLodMaterialFade(m);
            return m;
        }) as MeshStandardNodeMaterial;

        // 3. Spots
        const spotMat = getCachedProceduralMaterial('mushroom_spot_wind', 0xFFFFFF, () => {
            const m = (foliageMaterials.mushroomSpots as MeshStandardNodeMaterial).clone();
            const defPos = deform(positionLocal);
            m.positionNode = applyStandardDeformationWithLod(defPos);
            applyFoliageLodMaterialFade(m);
            return m;
        }) as MeshStandardNodeMaterial;
        const spotPulse = sin(uTime.mul(3.0)).mul(0.1).add(0.3);
        const spotAudio = uAudioHigh.mul(0.8); // 🎨 PALETTE: Make spots pop more on highs
        (spotMat as any).emissiveIntensityNode = flashIntensity.add(spotPulse).add(spotAudio);

        // Face Hiding Logic
        // If hasFace < 0.5, scale vertices to 0
        const faceScale = step(0.5, hasFace);
        const faceDeform = (pos: any) => {
            return deform(pos).mul(faceScale);
        };

        // 4. Eye
        const eyeMat = (foliageMaterials.eye as MeshStandardNodeMaterial).clone();
        eyeMat.positionNode = faceDeform(positionLocal);

        // 5. Pupil
        const pupilMat = (foliageMaterials.pupil as MeshStandardNodeMaterial).clone();
        pupilMat.positionNode = faceDeform(positionLocal);

        // 6. Mouth
        const mouthMat = (foliageMaterials.clayMouth as MeshStandardNodeMaterial).clone();
        mouthMat.positionNode = faceDeform(positionLocal);

        // 7. Cheek
        const cheekMat = (foliageMaterials.mushroomCheek as MeshStandardNodeMaterial).clone();
        cheekMat.positionNode = faceDeform(positionLocal);

        return [stemMat, capMat, gillMat, spotMat, eyeMat, pupilMat, mouthMat, cheekMat];
    }
