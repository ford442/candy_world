import * as THREE from 'three';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import { texture, vec4, color, vec3, uv, mx_noise_float, positionLocal, mix, smoothstep, normalLocal } from 'three/tsl';
import { fluidSystem } from '../systems/fluid_system.ts';
import { uTime } from './index.ts';

export function createFluidFog(width = 100, depth = 100) {
    // High resolution grid to allow for vertex displacement based on fluid density/velocity
    const geometry = new THREE.PlaneGeometry(width, depth, 128, 128);
    geometry.rotateX(-Math.PI / 2); // Flat on ground

    // ⚡ OPTIMIZATION: Use MeshStandardNodeMaterial for lighting integration instead of flat Basic material
    // This allows the fog to receive shadows, react to weather colors, and fit the "Cute Clay" aesthetic.
    const material = new MeshStandardNodeMaterial();
    material.transparent = true;
    material.depthWrite = false;
    material.blending = THREE.AdditiveBlending;
    material.side = THREE.DoubleSide;

    // Base colors matching the "Mint/Pink" Candy World palette
    const mistColor = color(0x44FFCC);
    const hotColor = color(0xFF66B2); // Mix in pink for high density areas

    // TSL Logic
    // Sample the fluid texture from the C++ solver.
    // The texture is RedFormat, so .r contains the density value (0.0 to 1.0+)
    const densityRaw = texture(fluidSystem.texture);
    const density = densityRaw.r;

    // Apply some slow ambient noise to the UVs to make the fog feel alive even when still
    const noiseUV = uv().add(uTime.mul(0.05));
    const ambientNoise = mx_noise_float(noiseUV.mul(10.0));

    // Add procedural billowing based on density
    // High density areas will bulge upwards physically
    const heightDisplacement = density.mul(3.0).add(ambientNoise.mul(0.5));

    // Smoothstep the density to create defined edges rather than a linear fade
    const clampedDensity = smoothstep(0.0, 1.0, density.mul(2.0));

    // Mix colors based on density (hotter pink in the dense centers, mint on the edges)
    const finalColor = mix(mistColor, hotColor, clampedDensity);

    // Alpha depends on density with some noise breakup
    // Reduce alpha at edges of the geometry
    const edgeFadeX = uv().x.sub(0.5).abs().mul(2.0).oneMinus();
    const edgeFadeY = uv().y.sub(0.5).abs().mul(2.0).oneMinus();
    const edgeFade = edgeFadeX.mul(edgeFadeY).clamp(0.0, 1.0);

    const alpha = density.mul(2.5).add(ambientNoise.mul(0.2)).mul(edgeFade).clamp(0.0, 0.8);

    // Apply final nodes
    material.colorNode = finalColor;
    material.opacityNode = alpha;

    // Vertex displacement: Bulge up based on density
    const newPos = positionLocal.add(normalLocal.mul(heightDisplacement));
    material.positionNode = newPos;

    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.y = 0.2; // Slightly above ground
    mesh.userData.type = 'fluid_fog';

    // Frustum culling bound expansion due to vertex displacement
    mesh.geometry.computeBoundingBox();
    if (mesh.geometry.boundingBox) {
        mesh.geometry.boundingBox.max.y += 5.0; // Allow for up to 5 units of vertical displacement
        mesh.geometry.boundingBox.min.y -= 1.0;
        mesh.geometry.computeBoundingSphere();
    }

    return mesh;
}
