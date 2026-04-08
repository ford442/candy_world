// src/foliage/stars.ts

import * as THREE from 'three';
import { color, float, vec3, vec4, time, positionLocal, attribute, uniform, mix, sin, cos, UniformNode, pow, step, smoothstep } from 'three/tsl';
import { PointsNodeMaterial } from 'three/webgpu';
import { uAudioLow, uAudioHigh } from './index.ts';

// Global uniforms
// Removed uStarPulse to fix unison pulsing bug and use direct audio reactivity
export const uStarColor = uniform(color(0xFFFFFF));
export const uStarOpacity = uniform(0.0); // Controls visibility (Day/Night)

export function createStars(count: number = 1500): THREE.Points {
    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const offsets = new Float32Array(count);
    const colors = new Float32Array(count * 3);
    const normals = new Float32Array(count * 3);

    const radius = 400;

    for (let i = 0; i < count; i++) {
        // Random point on sphere
        const u = Math.random();
        const v = Math.random();
        const theta = 2 * Math.PI * u;
        const phi = Math.acos(2 * v - 1);

        const r = radius * (0.9 + Math.random() * 0.2);
        const x = r * Math.sin(phi) * Math.cos(theta);
        const y = r * Math.sin(phi) * Math.sin(theta);
        const z = r * Math.cos(phi);

        positions[i * 3] = x;
        positions[i * 3 + 1] = Math.abs(y);
        positions[i * 3 + 2] = z;

        normals[i * 3] = 0; normals[i * 3 + 1] = 1; normals[i * 3 + 2] = 0;

        sizes[i] = Math.random() * 2.5 + 0.3;
        offsets[i] = Math.random() * 100;
        
        // Base natural star colors (White/Blueish/Yellowish)
        const colorType = Math.random();
        if (colorType < 0.7) {
            colors[i * 3] = 1.0; colors[i * 3 + 1] = 1.0; colors[i * 3 + 2] = 1.0;
        } else if (colorType < 0.85) {
            colors[i * 3] = 0.8; colors[i * 3 + 1] = 0.9; colors[i * 3 + 2] = 1.0;
        } else {
            colors[i * 3] = 1.0; colors[i * 3 + 1] = 0.9; colors[i * 3 + 2] = 0.7;
        }
    }

    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    geo.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
    geo.setAttribute('offset', new THREE.BufferAttribute(offsets, 1));
    geo.setAttribute('starColor', new THREE.BufferAttribute(colors, 3));

    const mat = new PointsNodeMaterial({
        size: 1.5,
        transparent: true,
        opacity: 0.0, // Driven by uStarOpacity in TSL
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        fog: false
    });

    // We assign TSL nodes to properties of PointsNodeMaterial
    const aOffset = attribute('offset', 'float');
    const aSize = attribute('size', 'float');
    const aStarColor = attribute('starColor', 'vec3');

    // --- PALETTE: Juicy Star Logic ---

    // 1. Twinkle (High Frequency / Hi-Hats)
    // Driven by Time + Offset + AudioHigh
    // This creates the "glitter" effect
    // PALETTE: Vary speed per star for natural feel
    const speedVar = float(3.0).add(sin(aOffset.mul(0.5)).mul(1.5)); // 1.5 to 4.5 speed
    const twinkleSpeed = time.mul(speedVar).add(aOffset);
    const rawTwinkle = sin(twinkleSpeed).mul(0.5).add(0.5); // 0..1 sine wave

    // Add rare gold sparkles (moved up to use for twinkle intensity)
    const isGold = step(0.9, sin(aOffset.mul(2.0))); // Occasional gold

    // Sharpen the twinkle (Power curve) -> Spikes of brightness
    // 🎨 PALETTE: Make the twinkle curve more extreme for non-gold stars, and extra flashy for gold
    const twinklePower = mix(float(5.0), float(3.0), isGold); // Gold has wider twinkle
    const sharpTwinkle = pow(rawTwinkle, twinklePower);

    // Scale twinkle intensity by Audio Highs (Cymbals/Melody)
    // 🎨 PALETTE: Non-linear audio reactivity - highs make them pop exponentially
    const audioTwinkle = uAudioHigh.pow(float(2.0)).mul(5.0);
    // Base twinkle + Audio Twinkle. Gold stars get an extra boost.
    const baseTwinkleMul = mix(float(0.5), float(1.5), isGold);
    const activeTwinkle = sharpTwinkle.mul(baseTwinkleMul.add(audioTwinkle));

    // 2. Randomized Pulse (Low Frequency / Kick)
    // Replaced wave with purely random phase based on offset to break unison
    // This creates a "twinkle chaos" instead of a sweeping wave
    const pulseSpeed = float(0.5).add(sin(aOffset).mul(0.2)); // Slight speed variation
    const pulsePhase = time.mul(pulseSpeed).add(aOffset); // Offset is large (0-100)
    const randomPulse = sin(pulsePhase).mul(0.5).add(0.5); // 0..1

    // Apply Kick energy to the random pulse
    // 🎨 PALETTE: Stars pulse individually to the beat, organically reacting to the kick
    const kickImpact = smoothstep(0.2, 0.8, uAudioLow).pow(float(1.5));
    const kickPulse = kickImpact.mul(randomPulse).mul(3.0);

    // 🎨 PALETTE: Randomize "Twinkle" offset so they don't pulse in unison to the music
    // Even high-hat twinks look better broken up
    const offsetHigh = sin(aOffset.mul(10.0)).mul(0.5).add(0.5); // 0..1
    const randomizedAudioHigh = uAudioHigh.mul(mix(float(0.5), float(1.5), offsetHigh));
    const audioHighTwinkle = randomizedAudioHigh.pow(float(2.0)).mul(5.0);
    const audioHighPulse = sharpTwinkle.mul(baseTwinkleMul.add(audioHighTwinkle));

    // Total Intensity = Base + Twinkle + Pulse
    const intensity = float(0.4).add(audioHighPulse).add(kickPulse);

    // 3. Color Shift (Neon/Magic)
    // Shift towards Cyan/Magenta/Gold on high energy
    const baseColorVec = vec3(aStarColor.x, aStarColor.y, aStarColor.z);

    // Magic colors
    const colorCyan = vec3(0.0, 1.0, 1.0);
    const colorMagenta = vec3(1.0, 0.0, 1.0);
    const colorGold = vec3(1.0, 0.8, 0.0);

    // Pick target color based on star's unique offset
    // Sine of offset gives -1..1. Map to mix factors.
    const selector = sin(aOffset);
    // Mix Cyan vs Magenta/Gold
    // If selector > 0 use Cyan/Magenta, else Gold
    const magicMix = mix(colorCyan, colorMagenta, selector.mul(0.5).add(0.5));
    const targetColor = mix(magicMix, colorGold, isGold);

    // Mix based on audio high (energy)
    // Stronger highs = More neon color
    // 🎨 PALETTE: More vibrant color shift during high energy
    const colorShiftFactor = smoothstep(0.1, 0.9, uAudioHigh).pow(float(1.2));
    const finalRGB = mix(baseColorVec, targetColor, colorShiftFactor);

    // 🎨 PALETTE: Make opacity breathe with the music organically
    // Use the star's unique offset to create a phase offset for the pulse so they don't pulse in perfect unison
    // We add a subtle glow pulse when high energy drops, mixing with base visibility
    const opacityPhase = time.mul(2.0).add(aOffset);
    const pulseOffset = sin(opacityPhase).mul(0.5).add(0.5); // 0 to 1
    const audioOpacity = uStarOpacity.mul(float(1.0).add(smoothstep(0.0, 1.0, uAudioLow).mul(pulseOffset).mul(0.5)));

    // Final Output
    mat.colorNode = vec4(finalRGB, audioOpacity).mul(mat.color);
    mat.sizeNode = aSize.mul(intensity.max(0.4)); // Keep min size 0.4 so they don't disappear

    // 4. Star Warp/Dance (Existing logic preserved but tuned)
    const pos = positionLocal;
    // Warp outwards on Kick (Low)
    const warpFactor = uAudioLow.mul(10.0);
    const warpedPos = pos.add(pos.normalize().mul(warpFactor));

    // Gentle Rotation
    const angle = time.mul(0.015); // Slightly slower rotation
    const rotatedX = warpedPos.x.mul(cos(angle)).sub(warpedPos.z.mul(sin(angle)));
    const rotatedZ = warpedPos.x.mul(sin(angle)).add(warpedPos.z.mul(cos(angle)));

    mat.positionNode = vec3(rotatedX, warpedPos.y, rotatedZ);

    const stars = new THREE.Points(geo, mat);
    stars.userData.isStars = true;

    return stars;
}
