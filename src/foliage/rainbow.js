import * as THREE from 'three';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import { color, float, uv, mix, vec3, Fn, uniform, sin, time, positionWorld, smoothstep } from 'three/tsl';

export const uRainbowOpacity = uniform(0.0);

export function createRainbow() {
    // Large Ring Geometry
    const innerRadius = 80;
    const outerRadius = 90;
    const geometry = new THREE.RingGeometry(innerRadius, outerRadius, 64, 1, 0, Math.PI);

    // Position it: Center at (0, -10, -50) so it arcs over the world
    // We'll let the caller position it, but default logic needs to be upright.

    // TSL Material
    const material = new MeshStandardNodeMaterial();
    material.transparent = true;
    material.side = THREE.DoubleSide;
    material.depthWrite = false;
    material.blending = THREE.AdditiveBlending;

    // Rainbow Gradient
    // UV.x goes 0->1 along the arc
    // UV.y goes 0->1 from inner to outer radius

    // Colors
    const cRed = color(0xFF0000);
    const cOrange = color(0xFFA500);
    const cYellow = color(0xFFFF00);
    const cGreen = color(0x008000);
    const cBlue = color(0x0000FF);
    const cIndigo = color(0x4B0082);
    const cViolet = color(0xEE82EE);

    // Multi-stop gradient helper
    // 0.0-0.16: Red->Orange
    // 0.16-0.33: Orange->Yellow
    // ...

    // We use smoothstep logic for bands, or just a simple mix chain.
    // For TSL, it's easier to map uv.y (width of band) to spectrum if we want stripes across the width.
    // Usually rainbows have colors arranged RADIALLY (inner to outer).
    // So we use UV.y.

    const t = uv().y;

    let col = mix(cRed, cOrange, smoothstep(float(0.0), float(0.16), t));
    col = mix(col, cYellow, smoothstep(float(0.16), float(0.33), t));
    col = mix(col, cGreen, smoothstep(float(0.33), float(0.5), t));
    col = mix(col, cBlue, smoothstep(float(0.5), float(0.66), t));
    col = mix(col, cIndigo, smoothstep(float(0.66), float(0.83), t));
    col = mix(col, cViolet, smoothstep(float(0.83), float(1.0), t));

    // Soften edges
    const edgeAlpha = smoothstep(float(0.0), float(0.2), t).mul(smoothstep(float(1.0), float(0.8), t));

    // Soften ends of the arc
    const arcAlpha = smoothstep(float(0.0), float(0.1), uv().x).mul(smoothstep(float(1.0), float(0.9), uv().x));

    // Beat pulse?
    const pulse = sin(time.mul(float(2.0))).mul(float(0.1)).add(float(0.9));

    material.colorNode = col;
    material.opacityNode = uRainbowOpacity.mul(edgeAlpha).mul(arcAlpha).mul(pulse);
    material.emissiveNode = col.mul(float(0.5)); // Slight glow

    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'Rainbow';

    // Default transform: upright facing Z
    // RingGeometry creates a flat ring on XY plane.
    // We want it arcing over the ground.
    // Default is perfect. Just need to ensure it's high enough.

    return mesh;
}
