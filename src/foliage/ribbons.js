
import * as THREE from 'three';
import {
    color, float, vec3, Fn, uniform, positionLocal, uv,
    mix, sin, cos, time, timerLocal
} from 'three/tsl';
import { CandyPresets } from './common.js';

/**
 * Creates a "Note Trail Ribbon" system.
 * It follows a target (e.g., player) and creates a trailing ribbon.
 * Since dynamic geometry update is CPU intensive, we use a fixed circular buffer of vertices
 * and update a window of them each frame.
 */
export class MelodyRibbon {
    constructor(scene, target, maxSegments = 50, width = 0.5) {
        this.scene = scene;
        this.target = target;
        this.maxSegments = maxSegments;
        this.width = width;

        this.segmentCount = 0;
        this.writeIndex = 0;

        // Geometry: Triangle Strip
        // Each segment has 2 vertices (top, bottom).
        // Total vertices = maxSegments * 2
        this.geometry = new THREE.BufferGeometry();

        const positions = new Float32Array(maxSegments * 2 * 3);
        const uvs = new Float32Array(maxSegments * 2 * 2);
        const indices = []; // Not needed for drawMode = TriangleStrip if supported, else we need indexed triangles

        // Three.js doesn't support TriangleStrip easily in WebGPU yet without index trickery or drawRange?
        // Actually, indexed triangles are safer.
        // For N segments (N-1 quads), we need:
        // Quad i: Verts 2*i, 2*i+1, 2*(i+1), 2*(i+1)+1

        for (let i = 0; i < maxSegments - 1; i++) {
            const v0 = i * 2;
            const v1 = i * 2 + 1;
            const v2 = (i + 1) * 2;
            const v3 = (i + 1) * 2 + 1;

            // Triangle 1
            indices.push(v0, v1, v2);
            // Triangle 2
            indices.push(v2, v1, v3);
        }

        this.geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        this.geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
        this.geometry.setIndex(indices);

        // Material: Glowing, shifting color
        // We use TSL for a scrolling gradient effect along UVs
        const mat = CandyPresets.Gummy(0x00FFFF, {
            side: THREE.DoubleSide,
            transparent: true,
            opacity: 0.8,
            transmission: 0.5
        });

        // Dynamic color based on UV.x (length) and Time
        // UV.x will be the segment index normalized
        const t = timerLocal(1.0);
        const hue = t.mul(0.2).add(uv().x).fract(); // Cycle colors
        // Simple HSL to RGB approximation or just mix
        const col1 = vec3(0.0, 1.0, 1.0); // Cyan
        const col2 = vec3(1.0, 0.0, 1.0); // Magenta
        const finalColor = mix(col1, col2, sin(hue.mul(6.28)).mul(0.5).add(0.5));

        mat.colorNode = finalColor;
        mat.emissiveNode = finalColor.mul(1.0); // Glow

        // Fade out at tail (uv.x near 0 assuming we shift UVs, or just based on index)
        // We'll manage UVs manually. Let's say UV.x goes from 0 (tail) to 1 (head).
        mat.opacityNode = uv().x.pow(2.0).mul(0.8); // Fade tail

        this.mesh = new THREE.Mesh(this.geometry, mat);
        this.mesh.frustumCulled = false; // Always render
        this.scene.add(this.mesh);

        // Local buffer for path points
        this.path = [];
        this.lastPos = new THREE.Vector3();
    }

    update(t) {
        if (!this.target) return;

        const currentPos = new THREE.Vector3();
        this.target.getWorldPosition(currentPos);

        // Only add point if moved enough
        if (currentPos.distanceToSquared(this.lastPos) > 0.01) {
            this.path.push(currentPos.clone());
            if (this.path.length > this.maxSegments) {
                this.path.shift();
            }
            this.lastPos.copy(currentPos);
            this.updateGeometry();
        }
    }

    updateGeometry() {
        const positions = this.geometry.attributes.position.array;
        const uvs = this.geometry.attributes.uv.array;

        // Rebuild geometry from path
        // We extrude a ribbon perpendicular to the camera? Or just Up?
        // Let's assume Up vector for simplicity (vertical ribbon)
        const up = new THREE.Vector3(0, 1, 0);

        for (let i = 0; i < this.path.length; i++) {
            const p = this.path[i];
            const i2 = i * 2;

            // Top vertex
            positions[i2 * 3] = p.x;
            positions[i2 * 3 + 1] = p.y + this.width;
            positions[i2 * 3 + 2] = p.z;

            // Bottom vertex
            positions[(i2 + 1) * 3] = p.x;
            positions[(i2 + 1) * 3 + 1] = p.y - this.width;
            positions[(i2 + 1) * 3 + 2] = p.z;

            // UVs: x = progress (0 to 1), y = 0 or 1
            const progress = i / (this.maxSegments - 1);
            uvs[i2 * 2] = progress;
            uvs[i2 * 2 + 1] = 1;

            uvs[(i2 + 1) * 2] = progress;
            uvs[(i2 + 1) * 2 + 1] = 0;
        }

        // Degenerate triangles for the rest of the buffer if path is short
        // Or just set drawRange?
        this.geometry.setDrawRange(0, (this.path.length - 1) * 6);

        this.geometry.attributes.position.needsUpdate = true;
        this.geometry.attributes.uv.needsUpdate = true;
        this.geometry.computeBoundingSphere();
    }
}
