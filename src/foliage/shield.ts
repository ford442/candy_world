
import * as THREE from 'three';
import {
    createUnifiedMaterial,
    uTime,
    uAudioLow
} from './common.ts';
import {
    vec3,
    sin,
    cos,
    positionLocal,
    timerLocal
} from 'three/tsl';

/**
 * Creates the "Arpeggio Shield" - a crystalline barrier.
 * It is attached to the player visually.
 */
export function createShield(): THREE.Mesh {
    const geometry = new THREE.IcosahedronGeometry(1.2, 0); // Low poly crystal look

    // TSL Animation: Rotate and Breathe
    // We modify positionLocal for the vertex shader

    // 1. Rotation (Y-axis spin)
    const speed = 1.0;
    const angle = uTime.mul(speed);
    const c = cos(angle);
    const s = sin(angle);

    // Rotate around Y
    // x' = x*c + z*s
    // z' = -x*s + z*c
    const rotX = positionLocal.x.mul(c).add(positionLocal.z.mul(s));
    const rotZ = positionLocal.x.negate().mul(s).add(positionLocal.z.mul(c));
    const rotPos = vec3(rotX, positionLocal.y, rotZ);

    // 2. Pulse (Audio Reactive)
    // Expand based on Bass (Kick)
    const pulse = uAudioLow.mul(0.2).add(1.0); // 1.0 to 1.2 scale
    const finalPos = rotPos.mul(pulse);

    const material = createUnifiedMaterial(0x00FFFF, {
        deformationNode: finalPos,
        roughness: 0.1,
        metalness: 0.1,
        transmission: 0.6,    // See-through
        thickness: 0.5,       // Refraction depth
        ior: 1.6,             // Crystal-like refraction
        iridescenceStrength: 1.0,
        iridescenceFresnelPower: 2.0,
        sheen: 1.0,
        sheenColor: 0xFF00FF, // Magenta sheen on Cyan base
        side: THREE.FrontSide, // Only render outside for efficiency? Or Double for thickness?
                               // Transmission usually works best with FrontSide + Thickness
        animatePulse: true     // Adds subtle emissive pulse
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.renderOrder = 10; // Render after opaque objects for transparency

    return mesh;
}
