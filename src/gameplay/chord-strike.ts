import * as THREE from 'three';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import { color, float, vec3, uv, positionLocal, mx_noise_float, mix, smoothstep, normalLocal, sin } from 'three/tsl';
import { uAudioLow, uAudioHigh, createJuicyRimLight, uTime } from '../foliage/material-core.ts';
import { uChromaticIntensity } from '../foliage/chromatic.ts';
import { spawnImpact } from '../foliage/impacts.ts';
import { unlockSystem } from '../systems/unlocks.ts';
import { showToast } from '../utils/toast.js';

export class ChordStrikeSystem {
    mesh: THREE.Mesh;
    active: boolean = false;
    duration: number = 0;
    maxDuration: number = 3.0; // 3 seconds beam
    radius: number = 0;
    maxRadius: number = 20.0;
    position: THREE.Vector3 = new THREE.Vector3();

    constructor() {
        // Create a massive cylinder for the beam
        const geometry = new THREE.CylinderGeometry(1, 1, 500, 32, 16, true);
        geometry.translate(0, 250, 0); // Base at 0

        // High Energy Plasma Material (TSL)
        const material = new MeshStandardNodeMaterial({
            transparent: true,
            side: THREE.DoubleSide,
            blending: THREE.AdditiveBlending,
            depthWrite: false
        });

        const vUv = uv();

        // 1. Noise-based Plasma
        const timeScale = uTime ? uTime.mul(20.0) : float(0.0);
        const noisePos = vec3(vUv.x.mul(10.0), vUv.y.mul(20.0).sub(timeScale), float(0.0));
        const plasma = mx_noise_float(noisePos).add(float(0.5));

        // 2. Audio Pulse
        const coreIntensity = uAudioLow ? uAudioLow.mul(float(1.5)).add(float(1.0)) : float(1.0);

        // 3. Color Gradient
        const colorBottom = color(0x9933FF); // Deep Purple
        const colorTop = color(0x00FFCC); // Cyan
        const baseColor = mix(colorBottom, colorTop, vUv.y);

        // 4. Edges Fade
        // Fade out horizontally at edges for softness
        const horizontalFade = sin(vUv.x.mul(Math.PI)).pow(2.0);
        // Fade out at top
        const verticalFade = float(1.0).sub(smoothstep(0.8, 1.0, vUv.y));

        const finalColor = baseColor.mul(plasma).mul(coreIntensity).mul(horizontalFade).mul(verticalFade);

        // Disable rim light in chord strike at load to prevent circular dependency resolution issues with audio variables
        material.emissiveNode = finalColor;

        // Deformation: Make it ripple
        const rippleTime = uTime ? uTime.mul(5.0) : float(0.0);
        const ripple = mx_noise_float(vec3(vUv.x.mul(5.0), vUv.y.mul(10.0), rippleTime));
        material.positionNode = positionLocal.add(normalLocal.mul(ripple.mul(float(2.0))));

        this.mesh = new THREE.Mesh(geometry, material);
        this.mesh.visible = false;
        this.mesh.frustumCulled = false;
    }

    addToScene(scene: THREE.Scene) {
        scene.add(this.mesh);
    }

    fire(playerPos: THREE.Vector3) {
        if (this.active) return; // Already firing

        // Require 3 Harmony Orbs
        if (!unlockSystem.consume('harmony_orb', 3)) {
            showToast("Need 3 Harmony Orbs! 🔮", "❌");
            return;
        }

        this.active = true;
        this.duration = this.maxDuration;
        this.radius = 0;
        this.position.copy(playerPos);

        // Slightly offset beam to not blind player entirely
        this.position.z -= 5.0;

        this.mesh.position.copy(this.position);
        this.mesh.visible = true;
        this.mesh.scale.set(0.1, 1, 0.1);

        showToast("CHORD STRIKE!! 🎶💥", "⚡");

        // Massive initial impact
        if (uChromaticIntensity) {
            uChromaticIntensity.value = 1.0;
        }
        spawnImpact(playerPos, 'explosion', 0x9933FF);
    }

    update(dt: number, scene: THREE.Scene, player: any) {
        if (!this.active) return;

        this.duration -= dt;

        if (this.duration <= 0) {
            this.active = false;
            this.mesh.visible = false;
            return;
        }

        // Expand radius quickly, then hold
        const expandSpeed = 20.0;
        if (this.radius < this.maxRadius) {
            this.radius += expandSpeed * dt;
            if (this.radius > this.maxRadius) this.radius = this.maxRadius;
        }

        // Add some jitter to the scale based on audio
        // For a more chaotic "superweapon" feel
        // @ts-ignore - uAudioHigh exists and has value
        const jitter = (uAudioHigh as any).value * 0.5;
        this.mesh.scale.set(this.radius + jitter, 1, this.radius + jitter);

        // Screen Shake / Glitch effect while active
        if (uChromaticIntensity) {
            // Sustain trauma
            (uChromaticIntensity as any).value = Math.max((uChromaticIntensity as any).value, 0.3 + Math.random() * 0.2);
        }

        // Physics Push: The beam provides a massive updraft
        // Check if player is near the beam
        const distSq = player.position.distanceToSquared(this.position);
        if (distSq < (this.radius + 5.0) * (this.radius + 5.0)) {
            // Push player up!
            player.velocity.y += 20.0 * dt;
            player.isGrounded = false;
        }

        // Continuous impact particles at base
        if (Math.random() < 0.2) {
            spawnImpact(this.position, 'magic', 0x00FFCC);
        }
    }
}

// Lazy init to avoid TSL initialization order issues
let _chordStrikeSystem: ChordStrikeSystem | null = null;

export const chordStrikeSystem = new Proxy({} as ChordStrikeSystem, {
    get: (target, prop) => {
        if (!_chordStrikeSystem) {
            _chordStrikeSystem = new ChordStrikeSystem();
        }
        return (_chordStrikeSystem as any)[prop];
    },
    set: (target, prop, value) => {
        if (!_chordStrikeSystem) {
            _chordStrikeSystem = new ChordStrikeSystem();
        }
        (_chordStrikeSystem as any)[prop] = value;
        return true;
    }
});
