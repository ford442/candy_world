import * as THREE from 'three';
import { createCloud } from './clouds.ts';
import { cloudBatcher } from './cloud-batcher.ts';

/**
 * Generates a procedural cloud layer for the background sky.
 * These clouds are non-interactive and purely visual, handled by the batcher.
 *
 * @param scene The THREE.Scene to add the cloud logic objects to (optional, for hierarchy)
 * @returns Array of generated cloud objects
 */
export function generateCloudLayer(scene: THREE.Scene): THREE.Object3D[] {
    const generatedClouds: THREE.Object3D[] = [];
    // Increase count for a dense layer
    const CLOUD_COUNT = 150;
    const RADIUS = 800;
    const MIN_HEIGHT = 100;
    const HEIGHT_RANGE = 60;

    console.log("[Procedural Sky] Generating cloud layer...");

    // Noise helper (simple sine/cos combination for clustering)
    function getNoise(x: number, z: number): number {
        const scale1 = 0.003;
        const scale2 = 0.01;
        const val = Math.sin(x * scale1) * Math.cos(z * scale1) * 0.7 +
                    Math.sin(x * scale2 + 2.0) * Math.cos(z * scale2 + 1.5) * 0.3;
        return (val + 1.0) * 0.5; // 0.0 to 1.0
    }

    // Drift Logic for background clouds
    // We can reuse the same update function for all background clouds to save memory
    const backgroundCloudUpdate = (dt: number, time: number) => {
        // Slow drift
        // We can access 'this' if we bind or use the object passed to loop
        // But here we'll rely on the cloud.userData which CloudBatcher uses?
        // Actually CloudBatcher calls `cloud.userData.onAnimate(dt, time)`
    };

    for (let i = 0; i < CLOUD_COUNT; i++) {
        // Random position in a large disk
        const angle = Math.random() * Math.PI * 2;
        // Use square root for uniform disk distribution
        const r = Math.sqrt(Math.random()) * RADIUS;

        const x = Math.cos(angle) * r;
        const z = Math.sin(angle) * r;

        // Use noise to determine density/size
        const density = getNoise(x, z);

        // Threshold: Only spawn where noise is high enough to form clusters
        // This creates "banks" of clouds instead of uniform noise
        if (density < 0.35) continue;

        // Create Cloud Logic Object
        // For background clouds, we use fewer puffs per cloud for performance,
        // but larger scale to fill space.
        const scale = 4.0 + density * 6.0; // Massive clouds (4x to 10x)
        const puffCount = Math.floor(8 + density * 8); // 8 to 16 puffs

        const cloud = createCloud({
            scale: scale,
            puffCount: puffCount,
            tier: 2 // Cosmetic tier
        });

        // Set Position
        // Higher density clouds are slightly lower (heavier) for layering effect
        const y = MIN_HEIGHT + Math.random() * HEIGHT_RANGE - (density * 20.0);
        cloud.position.set(x, y, z);

        // Random Rotation
        cloud.rotation.y = Math.random() * Math.PI * 2;
        cloud.rotation.x = (Math.random() - 0.5) * 0.2; // Slight tilt

        // Assign Drift Logic
        // Background clouds drift very slowly along wind (fixed here for simplicity)
        cloud.userData.velocity = new THREE.Vector3(1.0, 0, 0.5);

        cloud.userData.onAnimate = (dt: number, time: number) => {
             // Simple linear drift
             // Wrap around world bounds if needed, or just let them drift (they are far)
             // For now, static is safer for batcher optimization (sleeping clouds)
             // cloud.position.x += dt * 1.0;
        };

        // Register immediately with batcher
        cloudBatcher.register(cloud, { scale, puffCount });

        // Add to return list
        generatedClouds.push(cloud);

        // Optional: Add to scene if we want them to be part of the graph (e.g. for debug)
        // scene.add(cloud);
    }

    console.log(`[Procedural Sky] Generated ${generatedClouds.length} background clouds.`);
    return generatedClouds;
}
