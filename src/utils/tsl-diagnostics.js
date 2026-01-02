import * as THREE from 'three';

// Helper to check if something is a valid TSL Node
function isNode(val) {
    return val && (val.isNode === true || typeof val.build === 'function');
}

// Helper to check if value is a THREE.js object that shouldn't be wrapped
function isThreeObject(val) {
    return val && (val.isVector2 || val.isVector3 || val.isVector4 || val.isColor || val.isMatrix3 || val.isMatrix4);
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

    // CHECK: Detect improperly nested uniform nodes (e.g., vec3(uniformNode) where uniformNode already wraps a THREE.Color)
    if (node.isVectorNode || node.isColorNode) {
        const val = node.value || node.x; // Check first param
        if (val && isNode(val) && val.isUniformNode) {
            // Check if uniform contains a THREE.js object
            if (val.value && isThreeObject(val.value)) {
                errors.push(`${path} wraps a uniform containing a THREE object. Uniform nodes don't need vec3()/color() wrappers.`);
            }
        }
    }

    // CHECK: Verify getNodeType exists for nodes that should have it
    if (isNode(node) && !node.getNodeType && !node.isUniformNode) {
        errors.push(`${path} is marked as a node but missing getNodeType() method. Type: ${node.type || node.constructor?.name}`);
    }

    // Traverse children
    const checkKeys = ['a', 'b', 'c', 'value', 'node', 'nodes', 'params', 'x', 'y', 'z', 'w'];
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
    const slots = ['colorNode', 'positionNode', 'normalNode', 'emissiveNode', 'roughnessNode', 'metalnessNode', 'opacityNode', 'sizeNode'];

    slots.forEach(slot => {
        if (material[slot]) {
            // 1. Top-level check: Is the slot itself a number? (Allowed for roughness/metalness, bad for vec3 types)
            if (typeof material[slot] === 'number') {
                if (slot.includes('color') || slot.includes('position') || slot.includes('normal')) {
                    errors.push(`[${objName}] material.${slot} is a raw number (${material[slot]}). Must be a Node.`);
                }
            }
            // 2. Check if it's a THREE.js object being used directly
            else if (isThreeObject(material[slot])) {
                errors.push(`[${objName}] material.${slot} is a THREE.js object (${material[slot].constructor.name}). Wrap in appropriate TSL node or use uniform().`);
            }
            // 3. Deep check
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
        let totalMaterials = 0;
        const errorsByType = {};
        
        scene.traverse(obj => {
            if (obj.material) {
                const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
                mats.forEach(m => {
                    if (m.isNodeMaterial) {
                        totalMaterials++;
                        const errs = diagnoseMaterial(m, obj.name || obj.type);
                        if (errs.length > 0) {
                            issues++;
                            const matType = m.type || m.constructor.name;
                            errorsByType[matType] = (errorsByType[matType] || 0) + 1;
                            
                            console.error(`❌ ${obj.name || obj.type} (${matType}):`);
                            console.error(`   UUID: ${obj.uuid}, Position: (${obj.position.x.toFixed(1)}, ${obj.position.y.toFixed(1)}, ${obj.position.z.toFixed(1)})`);
                            errs.forEach(e => console.warn("     " + e));
                        }
                    }
                });
            }
        });
        
        if (issues === 0) {
            console.log(`✅ No TSL type-mixing errors found in ${totalMaterials} node materials.`);
        } else {
            console.error(`⚠️ Found ${issues} materials with errors out of ${totalMaterials} total:`);
            Object.entries(errorsByType).forEach(([type, count]) => {
                console.error(`   - ${type}: ${count} error(s)`);
            });
        }
        console.groupEnd();
        return issues;
    };
    
    // Auto-run scan after a short delay to catch initialization issues
    console.log("🔧 [TSL Diagnostics] Auto-scanning in 2 seconds...");
    setTimeout(() => {
        const errorCount = window.scanForTSLErrors();
        if (errorCount > 0) {
            console.warn("⚠️ [TSL Diagnostics] Errors detected during initialization. Fix these to prevent runtime shader errors.");
        }
    }, 2000);
}
