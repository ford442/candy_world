// src/utils/tsl-diagnostics.js
import * as THREE from 'three';

/**
 * Checks if a value is a valid TSL Node.
 */
function isNode(val) {
    return val && (val.isNode === true || typeof val.build === 'function');
}

/**
 * Recursively validates a TSL Node tree.
 * Returns an array of error strings.
 */
function validateNodeTree(node, path = 'root', visited = new Set()) {
    if (!node || typeof node !== 'object') return [];
    if (visited.has(node)) return []; // Avoid cycles
    visited.add(node);

    const errors = [];

    // 1. Check generic inputs (common in MathNode, OperatorNode)
    const inputs = ['a', 'b', 'c', 'x', 'y', 'z', 'value', 'node'];
    
    // Check specific known node structures that fail with raw numbers
    // Example: A node that is the result of 'mul' or 'add' usually has 'a' and 'b' inputs
    if (node.isMathNode || node.isOperatorNode) {
        if (node.a !== undefined && !isNode(node.a) && typeof node.a !== 'string') {
             // Strings are sometimes allowed for swizzling "xyz", but numbers usually crash generic nodes
             if (typeof node.a === 'number') errors.push(`${path}.a is a RAW NUMBER (${node.a}). Should be float(${node.a}).`);
        }
        if (node.b !== undefined && !isNode(node.b) && typeof node.b !== 'string') {
             if (typeof node.b === 'number') errors.push(`${path}.b is a RAW NUMBER (${node.b}). Should be float(${node.b}).`);
        }
    }

    // 2. Traversal
    for (const key of Object.keys(node)) {
        const val = node[key];
        // Only traverse properties that look like they hold nodes
        if (inputs.includes(key) || key === 'nodes' || key === 'params') {
            if (Array.isArray(val)) {
                val.forEach((child, i) => errors.push(...validateNodeTree(child, `${path}.${key}[${i}]`, visited)));
            } else if (isNode(val)) {
                errors.push(...validateNodeTree(val, `${path}.${key}`, visited));
            }
        }
    }

    return errors;
}

/**
 * Scans a Material for TSL errors.
 */
export function diagnoseMaterial(material, name = 'Unknown') {
    if (!material.isNodeMaterial) return [];

    const criticalSlots = [
        'colorNode', 'positionNode', 'normalNode', 'emissiveNode', 
        'roughnessNode', 'metalnessNode', 'opacityNode', 'sizeNode'
    ];

    const errors = [];

    criticalSlots.forEach(slot => {
        if (material[slot]) {
            const slotErrors = validateNodeTree(material[slot], slot);
            if (slotErrors.length > 0) {
                errors.push(...slotErrors.map(e => `[${name}] ${e}`));
            }
        }
    });

    return errors;
}

/**
 * GLOBAL DEBUGGER
 * Call window.scanForTSLErrors() in console.
 */
export function installDiagnostics(scene) {
    window.scanForTSLErrors = () => {
        console.group("🔍 TSL Deep Scan...");
        let foundErrors = false;
        
        scene.traverse(obj => {
            if (obj.material) {
                const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
                materials.forEach(mat => {
                    const errs = diagnoseMaterial(mat, `${obj.name || obj.type} (Mat: ${mat.name || mat.type})`);
                    if (errs.length > 0) {
                        foundErrors = true;
                        console.error(`❌ Issues in object:`, obj);
                        errs.forEach(e => console.warn(e));
                    }
                });
            }
        });

        if (!foundErrors) console.log("✅ No mixed-type TSL errors detected.");
        console.groupEnd();
    };
    
    console.log("🚑 TSL Diagnostics installed. Run 'window.scanForTSLErrors()' to check materials.");
}
