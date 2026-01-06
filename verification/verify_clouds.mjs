
import * as THREE from 'three';
import { createCloud } from '../src/foliage/clouds.js';
import { MeshStandardNodeMaterial } from 'three/webgpu';

// Minimal verification script for Node Materials
console.log("☁️ Verifying Cloud Material TSL Logic...");

try {
    const cloudGroup = createCloud({ scale: 1.0, puffCount: 1 });
    const puff = cloudGroup.children[0];
    const material = puff.material;

    if (!material.isNodeMaterial) {
        throw new Error("Cloud material is not a NodeMaterial!");
    }

    if (!material.positionNode) {
        throw new Error("Missing vertex displacement (positionNode) - Fluff effect not applied.");
    }

    if (!material.emissiveNode) {
         throw new Error("Missing emissiveNode - Lighting/Rim effect not applied.");
    }

    console.log("✅ Cloud Material Verified:");
    console.log("   - Type: NodeMaterial");
    console.log("   - Displacement: Active");
    console.log("   - Emissive: Active");

} catch (err) {
    console.error("❌ Verification Failed:", err);
    process.exit(1);
}
