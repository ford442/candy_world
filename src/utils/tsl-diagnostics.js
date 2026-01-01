import * as THREE from 'three';

// Helper to check if something is a valid TSL Node
function isNode(val) {
    return val && (val.isNode === true || typeof val.build === 'function');
}

// Recursively checks a Node tree for raw numbers mixed with Nodes
function validateNodeTree(node, path, visited = new Set()) {
    if (!node || typeof node !== 'object') return [];
    if (visited.has(node)) return [];
    visited.add(node);

    const errors = [];

    // CRITICAL CHECK: Math/Operator nodes (add, mul, sub) fail if inputs are raw numbers
    if (node.isMathNode || node.isOperatorNode) {
        if (node.a !== undefined && !isNode(node.a) && typeof node.a === 'number') {
             errors.push(`${path}.a is a NUMBER (${node.a}). Wrap in float(${node.a}).`);
        }
        if (node.b !== undefined && !isNode(node.b) && typeof node.b === 'number') {
             errors.push(`${path}.b is a NUMBER (${node.b}). Wrap in float(${node.b}).`);
        }
    }

    // Traverse children
    const checkKeys = ['a', 'b', 'c', 'value', 'node', 'nodes', 'params'];
    checkKeys.forEach(key => {
        const val = node[key];
        if (Array.isArray(val)) {
            val.forEach((child, i) => errors.push(...validateNodeTree(child, `${path}.${key}[${i}]`, visited)));
        } else if (isNode(val)) {
            errors.push(...validateNodeTree(val, `${path}.${key}`, visited));
        }
    });

    return errors;
}

export function diagnoseMaterial(material, objName) {
    if (!material || !material.isNodeMaterial) return [];
    
    const errors = [];
    // Properties that MUST be Nodes in TSL
    const slots = ['colorNode', 'positionNode', 'normalNode', 'emissiveNode', 'roughnessNode', 'metalnessNode', 'opacityNode'];

    slots.forEach(slot => {
        if (material[slot]) {
            // 1. Top-level check: Is the slot itself a number? (Allowed for roughness/metalness, bad for vec3 types)
            if (typeof material[slot] === 'number') {
                if (slot.includes('color') || slot.includes('position') || slot.includes('normal')) {
                    errors.push(`[${objName}] material.${slot} is a raw number (${material[slot]}). Must be a Node.`);
                }
            } 
            // 2. Deep check
            else {
                const treeErrors = validateNodeTree(material[slot], slot);
                if (treeErrors.length > 0) {
                    errors.push(...treeErrors.map(e => `[${objName}] ${e}`));
                }
            }
        }
    });
    return errors;
}

export function installDiagnostics(scene) {
    window.scanForTSLErrors = () => {
        console.group("🔍 TSL Deep Scan...");
        let issues = 0;
        scene.traverse(obj => {
            if (obj.material) {
                const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
                mats.forEach(m => {
                    const errs = diagnoseMaterial(m, obj.name || obj.type);
                    if (errs.length > 0) {
                        issues++;
                        console.error(`❌ ${obj.name || obj.type} (${m.type}):`);
                        errs.forEach(e => console.warn("  " + e));
                    }
                });
            }
        });
        if (issues === 0) console.log("✅ No TSL type-mixing errors found.");
        console.groupEnd();
    };
}
