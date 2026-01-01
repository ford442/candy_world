// src/utils/debug-helpers.js

import * as THREE from 'three';

/**
 * Recursively checks if a value is a valid TSL Node.
 */
function isValidTSLNode(node) {
    if (node === undefined || node === null) return true; // Optional nodes are fine
    if (typeof node === 'number') return true; // TSL handles raw numbers
    if (node.isNode === true) return true; 
    if (typeof node.build === 'function') return true; // Proxy nodes
    if (node.isVector2 || node.isVector3 || node.isColor) return true; 
    return false;
}

/**
 * Validates a single material.
 */
function validateMaterial(mat, objName) {
    if (!mat || !mat.isNodeMaterial) return [];
    
    const errors = [];
    const criticalProps = [
        'positionNode', 'colorNode', 'normalNode', 
        'roughnessNode', 'metalnessNode', 'emissiveNode'
    ];

    criticalProps.forEach(prop => {
        const node = mat[prop];
        if (node !== undefined && node !== null) {
            // Check for plain objects that aren't nodes
            if (typeof node === 'object' && !isValidTSLNode(node)) {
                errors.push(`[${objName}] material.${prop} is invalid (Found Object/Array but not Node).`);
            }
            // Check for NaN
            if (typeof node === 'number' && isNaN(node)) {
                errors.push(`[${objName}] material.${prop} is NaN.`);
            }
        }
    });
    return errors;
}

/**
 * Scans the entire scene for TSL errors.
 * Call this from the browser console via: window.debugScene()
 */
export function validateSceneMaterials(scene) {
    console.group("🔍 [Debug] Validating Scene Materials...");
    let issuesFound = 0;
    const errors = [];

    scene.traverse((obj) => {
        if (!obj.isMesh && !obj.isPoints) return;
        
        const mat = obj.material;
        if (Array.isArray(mat)) {
            mat.forEach((m, i) => {
                const errs = validateMaterial(m, `${obj.name || obj.type}[${i}]`);
                errors.push(...errs);
            });
        } else {
            const errs = validateMaterial(mat, obj.name || obj.type);
            errors.push(...errs);
        }
    });

    if (errors.length === 0) {
        console.log("✅ No obvious TSL structure errors found.");
    } else {
        console.warn(`⚠️ Found ${errors.length} issues:`);
        errors.forEach(e => console.error(e));
        issuesFound = errors.length;
    }
    console.groupEnd();
    return issuesFound;
}

/**
 * Patches the renderer to expose debug tools to window.
 */
export function enableRendererDebug(renderer, scene) {
    renderer.debug.checkShaderErrors = true;
    
    // Expose tools to global window scope for console access
    window.renderer = renderer;
    window.scene = scene;
    
    window.debugScene = () => {
        if (!scene) {
            console.error("Scene not captured. Pass scene to enableRendererDebug.");
            return;
        }
        validateSceneMaterials(scene);
    };

    console.log("🔧 [Debug] Tools enabled. Run 'window.debugScene()' in console to scan materials.");
}
