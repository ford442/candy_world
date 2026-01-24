import * as THREE from 'three';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import { texture, vec4, color } from 'three/tsl';
import { fluidSystem } from '../systems/fluid_system.ts';

export function createFluidFog(width = 100, depth = 100) {
    const geometry = new THREE.PlaneGeometry(width, depth);
    geometry.rotateX(-Math.PI / 2); // Flat on ground

    const material = new MeshBasicNodeMaterial();
    material.transparent = true;
    material.depthWrite = false;
    // Additive blending for "glowing mist" effect
    material.blending = THREE.AdditiveBlending;
    material.side = THREE.DoubleSide; // Visible from below if camera dips

    // TSL Logic
    // Sample the fluid texture from the system
    // The texture is RedFormat, so .r contains the density value (0.0 to 1.0+)
    const density = texture(fluidSystem.texture).r;

    // Color map: "Mint Mist" (Cyan/Greenish) to fit Candy World
    const mistColor = color(0x44FFCC);

    // Alpha depends on density
    // We boost the density value to make the fog more opaque
    const alpha = density.mul(3.0).clamp(0.0, 0.8);

    material.colorNode = vec4(mistColor.rgb, alpha);

    const mesh = new THREE.Mesh(geometry, material);
    // Position it slightly above ground to avoid z-fighting,
    // but low enough to look like ground mist.
    mesh.position.y = 0.2;
    mesh.userData.type = 'fluid_fog';

    return mesh;
}
