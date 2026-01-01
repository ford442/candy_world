import * as THREE from 'three';

/**
 * Checks if a value is a valid TSL Node.
 */
function isNode(val) {
    return val && (val.isNode === true || typeof val.build === 'function');
}

/**
 * Recursively validates a TSL Node tree.
 */
function validateNodeTree(node, path = 'root', visited = new Set()) {
    if (!node || typeof node !== 'object') return [];
    if (visited.has(node)) return []; 
    visited.add(node);

    const errors = [];

    // Check specific known node structures that fail with raw numbers
    // MathNode and OperatorNode expect their inputs (a, b) to be Nodes or specific types, not raw numbers in some contexts
    if (node.isMathNode || node.isOperatorNode) {
        if (node.a !== undefined && !isNode(node.a) && typeof node.a === 'number') {
             errors.push(`${path}.a is a RAW NUMBER (${node.a}). Wrap it in float(${node.a}).`);
        }
        if (node.b !== undefined && !isNode(node.b) && typeof node.b === 'number') {
             errors.push(`${path}.b is a RAW NUMBER (${node.b}). Wrap it in float(${node.b}).`);
        }
    }

    // Traversal
    for (const key of Object.keys(node)) {
        const val = node[key];
        // Only traverse properties that look like they hold nodes
        if (['a', 'b', 'c', 'x', 'y', 'z', 'value', 'node', 'nodes', 'params'].includes(key)) {
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
    if (!material || !material.isNodeMaterial) return [];

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
                        console.error(`❌ Issues in object: ${obj.name || 'Unnamed'}`, errs);
                    }
                });
            }
        });

        if (!foundErrors) console.log("✅ No mixed-type TSL errors detected.");
        console.groupEnd();
    };
    
    // Auto-run once shortly after install
    // setTimeout(() => window.scanForTSLErrors(), 1000); 
}
