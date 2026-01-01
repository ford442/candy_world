// src/utils/debug-helpers.js

import * as THREE from 'three';

/**
 * Recursively checks if a value is a valid TSL Node.
 * TSL Nodes usually have isNode=true or a build() method.
 */
function isValidTSLNode(node) {
    if (node === undefined || node === null) return true; // Optional nodes are fine
    if (typeof node === 'number') return true; // TSL handles raw numbers (auto-promotes to float/int)
    if (node.isNode === true) return true; 
    if (typeof node.build === 'function') return true; // Proxy nodes
    
    // If it's a vector/color, TSL might accept it, but safer to wrap in vec3/color
    if (node.isVector2 || node.isVector3 || node.isColor) return true; 

    return false;
}

/**
 * Scans the scene for materials with invalid TSL node assignments.
 * Prints detailed errors to the console to help locate the crash source.
 */
export function validateSceneMaterials(scene) {
    console.group("🔍 [Debug] Validating Scene Materials...");
    let issuesFound = 0;

    scene.traverse((obj) => {
        if (!obj.isMesh) return;
        const mat = obj.material;
        if (!mat || !mat.isNodeMaterial) return;

        const objName = obj.name || obj.userData?.type || 'Unnamed Mesh';
        const matName = mat.name || 'Unnamed Material';

        // 1. Check for 'undefined' generic nodes which crash the builder
        const criticalProps = [
            'positionNode', 'colorNode', 'normalNode', 
            'roughnessNode', 'metalnessNode', 'emissiveNode'
        ];

        for (const prop of criticalProps) {
            const node = mat[prop];
            if (node !== undefined && node !== null) {
                // ERROR: Plain Object assignment (Common mistake with applyGlitch)
                if (typeof node === 'object' && !isValidTSLNode(node)) {
                    console.error(`❌ [${objName}] material.${prop} is INVALID.`);
                    console.error(`   Expected TSL Node, got:`, node);
                    console.error(`   (If this is {uv, position}, you forgot to access .position)`);
                    issuesFound++;
                }
                
                // WARNING: NaN usage
                if (typeof node === 'number' && isNaN(node)) {
                    console.error(`❌ [${objName}] material.${prop} is NaN!`);
                    issuesFound++;
                }
            }
        }
    });

    if (issuesFound === 0) {
        console.log("✅ No obvious TSL material structure errors found.");
    } else {
        console.warn(`⚠️ Found ${issuesFound} potential material issues. Check console errors above.`);
    }
    console.groupEnd();
}

/**
 * Patches the renderer to log generic shader errors more verbosely
 */
export function enableRendererDebug(renderer) {
    renderer.debug.checkShaderErrors = true;
    window.renderer = renderer; // Expose to console
    console.log("🔧 [Debug] Renderer debug mode enabled. Access via 'window.renderer'");
}
