import * as THREE from 'three';
import { color, time, uv, float, vec2, mix, sin, uniform, UniformNode } from 'three/tsl';
import { registerReactiveMaterial, attachReactivity, CandyPresets } from './common.ts';

/**
 * Creates a bioluminescent waterfall connecting two points.
 * @param {THREE.Vector3} startPos - Top position
 * @param {THREE.Vector3} endPos - Bottom position
 * @param {number} width - Width of the waterfall
 */
export function createWaterfall(startPos: THREE.Vector3, endPos: THREE.Vector3, width: number = 5.0): THREE.Group {
    const group = new THREE.Group();
    group.name = 'Waterfall';

    const height = startPos.y - endPos.y;
    const midY = (startPos.y + endPos.y) / 2;

    // Use a CylinderGeometry with open ends, scaled flat.
    const geo = new THREE.CylinderGeometry(width, width * 1.5, height, 32, 16, true);

    // --- PALETTE: Unified Material Pipeline (SeaJelly Variant) ---
    // Use SeaJelly preset for wet, translucent, viscous look
    const mat = CandyPresets.SeaJelly(0x00FFFF, {
        transmission: 0.9,
        thickness: 1.2,
        roughness: 0.1,
        ior: 1.33,
        subsurfaceStrength: 0.5,
        subsurfaceColor: 0xCCFFFF,
        animateMoisture: true,
        thicknessDistortion: 0.6,
        side: THREE.DoubleSide
    });

    // Custom Flow & Reactivity Nodes
    const speed = 2.0;
    const flowUV = uv().add(vec2(0, time.mul(speed).negate())); // Scroll UV Y

    // Create a procedural ripple/foam pattern
    // We mix two sine waves for a more organic feel
    const ripple1 = sin(flowUV.y.mul(15.0).add(flowUV.x.mul(5.0))).mul(0.5).add(0.5);
    const ripple2 = sin(flowUV.y.mul(25.0).sub(flowUV.x.mul(10.0)).add(time)).mul(0.5).add(0.5);
    const foam = ripple1.mul(ripple2);

    // Dynamic Uniforms for Reactivity
    const uPulseIntensity = uniform(0.0); // Controlled by audio
    const uBaseEmission = float(0.2);     // Always slightly glowing

    // Color Gradient: Cyan (top) -> Purple (bottom)
    const gradient = mix(color(0xFF00FF), color(0x00FFFF), uv().y);

    // Modify the base color node from the preset (SeaJelly uses solid color usually)
    // We mix the gradient into the base color
    mat.colorNode = mix(mat.colorNode, gradient, 0.5);

    // Add foam brightness to emission
    // Pulse adds extra glow on beat
    const emission = gradient.mul(uBaseEmission.add(uPulseIntensity)).mul(foam.add(0.2));
    mat.emissiveNode = emission;

    // Modify roughness based on foam (foam is rougher)
    // Safety check: wrap in float() if roughnessNode is missing or primitive
    // In TSL, roughnessNode is usually a Node. If undefined, we can default.
    const currentRoughness = mat.roughnessNode || float(mat.roughness);
    mat.roughnessNode = currentRoughness.add(foam.mul(0.5));

    // -----------------------------------------------------------

    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(startPos.x, midY, startPos.z);

    // Store uniforms for JS access
    mesh.userData.uPulseIntensity = uPulseIntensity;

    // Register for reactivity
    registerReactiveMaterial(mat);
    group.add(mesh);

    // Add Splash Particles at bottom
    const splashCount = 8; // Increased count
    const splashGroup = new THREE.Group();
    // Use a shared geometry/material for splashes
    const splashGeo = new THREE.SphereGeometry(width * 0.15, 8, 8);
    // Use a "Sugar" material for splashes (frosted look)
    const splashMat = CandyPresets.Sugar(0xFFFFFF, { roughness: 0.4, bumpStrength: 0.2 });

    for (let i = 0; i < splashCount; i++) {
        const splash = new THREE.Mesh(splashGeo, splashMat);
        splash.position.set(startPos.x + (Math.random()-0.5)*width, endPos.y, startPos.z + (Math.random()-0.5)*width);
        splash.userData = {
            velocity: new THREE.Vector3((Math.random()-0.5)*2, Math.random()*8 + 2, (Math.random()-0.5)*2),
            originalY: endPos.y,
            originalPos: new THREE.Vector3().copy(splash.position)
        };
        splashGroup.add(splash);
    }
    group.add(splashGroup);

    // Attach custom animation for splashes
    group.userData.type = 'waterfall';
    group.userData.splashes = splashGroup.children;

    // --- AUDIO REACTIVITY ---
    attachReactivity(group, { minLight: 0.0, maxLight: 1.0, type: 'flora' }); // Reacts to lower channels (Bass/Melody)

    // @ts-ignore - dynamic property assignment
    group.reactToNote = (note: any, colorVal: any, velocity: number) => {
        // 1. Visual Pulse (TSL Uniform)
        // Bump intensity: base 0.0 -> adds up to 2.0 based on velocity
        (mesh.userData.uPulseIntensity as UniformNode<number>).value = 0.5 + (velocity * 2.0);

        // 2. Splash Explosion (Particle "Juice")
        if (velocity > 0.5) {
            group.userData.splashes.forEach((s: THREE.Object3D) => {
                if (Math.random() > 0.5) return; // Only affect some particles
                s.userData.velocity.y += velocity * 5.0; // Shoot up
                s.userData.velocity.x += (Math.random()-0.5) * velocity;
                s.userData.velocity.z += (Math.random()-0.5) * velocity;
            });
        }
    };

    // Custom animate function to decay pulse and move particles
    // @ts-ignore
    group.onAnimate = (delta: number, time: number) => {
        // Decay pulse
        const pulse = mesh.userData.uPulseIntensity as UniformNode<number>;
        if (pulse.value > 0.01) {
            pulse.value = THREE.MathUtils.lerp(pulse.value, 0.0, delta * 5.0);
        }

        // Animate splashes
        group.userData.splashes.forEach((s: THREE.Object3D) => {
            s.position.addScaledVector(s.userData.velocity, delta);
            s.userData.velocity.y -= 20.0 * delta; // Heavy gravity

            // Floor collision / Reset
            if (s.position.y < s.userData.originalY) {
                s.position.y = s.userData.originalY;
                // Bounce with damping
                s.userData.velocity.y = Math.abs(s.userData.velocity.y) * 0.4;

                // If velocity is too low, reset to random splash
                if (s.userData.velocity.y < 1.0) {
                     s.position.x = startPos.x + (Math.random()-0.5)*width;
                     s.position.z = startPos.z + (Math.random()-0.5)*width;
                     s.userData.velocity.set((Math.random()-0.5)*2, Math.random()*8 + 2, (Math.random()-0.5)*2);
                }
            }
        });
    };

    return group;
}
