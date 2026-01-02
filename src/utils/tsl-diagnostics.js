// src/utils/tsl-diagnostics.js

import * as THREE from 'three';

// Helper to check if something is a valid TSL Node
function isNode(val) {
    return val && (val.isNode === true || typeof val.build === 'function');
}

// Iteratively checks a Node tree for raw numbers mixed with Nodes to avoid stack overflow
function validateNodeTree(rootNode, rootPath) {
    const errors = [];
    // Stack for DFS: stores objects { node, path }
    // Using a stack avoids recursion limits on deep shader graphs
    const stack = [{ node: rootNode, path: rootPath }];
    const visited = new Set();

    while (stack.length > 0) {
        const { node, path } = stack.pop();

        if (!node || typeof node !== 'object') continue;
        if (visited.has(node)) continue;
        visited.add(node);

        // CRITICAL CHECK: Math/Operator nodes (add, mul, sub) fail if inputs are raw numbers
        // We check properties 'a' and 'b' specifically for these types
        if (node.isMathNode || node.isOperatorNode || node.isCondNode) {
            if (node.a !== undefined && !isNode(node.a) && typeof node.a === 'number') {
                 errors.push(`${path}.a is a NUMBER (${node.a}). Wrap in float(${node.a}).`);
            }
            if (node.b !== undefined && !isNode(node.b) && typeof node.b === 'number') {
                 errors.push(`${path}.b is a NUMBER (${node.b}). Wrap in float(${node.b}).`);
            }
             if (node.cond !== undefined && !isNode(node.cond) && typeof node.cond === 'number') {
                 errors.push(`${path}.cond is a NUMBER (${node.cond}). Wrap in float(${node.cond}).`);
             }
        }

        // Traverse children
        // We only follow specific keys known to contain child nodes to prune the search
        const checkKeys = ['a', 'b', 'c', 'value', 'node', 'nodes', 'params', 'cond', 'ifNode', 'elseNode'];
        
        for (const key of checkKeys) {
            // Safe access in case of getters throwing errors
            let val;
            try { val = node[key]; } catch (e) { continue; }

            if (!val) continue;

            if (Array.isArray(val)) {
                // Iterate backwards to preserve order when pushing to stack (DFS order)
                for (let i = val.length - 1; i >= 0; i--) {
                    const child = val[i];
                    if (isNode(child)) {
                        stack.push({ node: child, path: `${path}.${key}[${i}]` });
                    }
                }
            } else if (isNode(val)) {
                stack.push({ node: val, path: `${path}.${key}` });
            }
        }
    }

    return errors;
}

export function diagnoseMaterial(material, objName) {
    if (!material || !material.isNodeMaterial) return [];
    
    const errors = [];
    // Properties that MUST be Nodes in TSL
    const slots = ['colorNode', 'positionNode', 'normalNode', 'emissiveNode', 'roughnessNode', 'metalnessNode', 'opacityNode', 'transmissionNode', 'iorNode', 'thicknessNode'];

    slots.forEach(slot => {
        if (material[slot]) {
            // 1. Top-level check: Is the slot itself a number? 
            // (Strictly, standard materials allow numbers for roughness/metalness, but NodeMaterials prefer nodes or will auto-convert constants.
            // However, assigning a number to colorNode is usually an error.)
            if (typeof material[slot] === 'number') {
                if (slot.includes('color') || slot.includes('position') || slot.includes('normal')) {
                    errors.push(`[${objName}] material.${slot} is a raw number (${material[slot]}). Must be a Node.`);
                }
            } 
            // 2. Deep check using Iterative traversal
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
        let checkedMaterials = new Set();

        scene.traverse(obj => {
            if (obj.material) {
                const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
                mats.forEach(m => {
                    // Prevent duplicate scanning of shared materials
                    if (checkedMaterials.has(m)) return;
                    checkedMaterials.add(m);

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
