// src/foliage/foliage-reactivity.ts
// Reactivity system for foliage objects - handles animated/interactive foliage registration

import * as THREE from 'three';
import { _scratchVec1 } from './material-core.ts';

// --- Reactive Objects Registry ---
export const reactiveObjects: THREE.Object3D[] = [];
let reactivityCounter = 0; 
export const reactiveMaterials: THREE.Material[] = [];
export const _foliageReactiveColor = new THREE.Color(); 

export function registerReactiveMaterial(mat: THREE.Material) { 
    reactiveMaterials.push(mat); 
}

export function pickAnimation(types: string[]) { 
    return types[Math.floor(Math.random() * types.length)]; 
}

export function attachReactivity<T extends THREE.Object3D>(group: T, options: any = {}): T {
    reactiveObjects.push(group);
    group.userData.reactivityType = options.type || group.userData.reactivityType || 'flora';
    if (typeof group.userData.reactivityId === 'undefined') group.userData.reactivityId = reactivityCounter++;
    const light = options.lightPreference || {};
    group.userData.minLight = (typeof light.min !== 'undefined') ? light.min : (group.userData.minLight ?? 0.0);
    group.userData.maxLight = (typeof light.max !== 'undefined') ? light.max : (group.userData.maxLight ?? 1.0);
    return group;
}

export function cleanupReactivity(object: THREE.Object3D) {
    const index = reactiveObjects.indexOf(object);
    if (index > -1) reactiveObjects.splice(index, 1);
}

// --- VALIDATION HELPERS ---

export function validateFoliageMaterials(foliageMaterials: { [key: string]: THREE.Material | THREE.Material[] }) {
    // Lazy import to avoid circular dependencies
    const getFallbackMaterial = () => {
        return new THREE.MeshStandardMaterial({ color: 0xFF00FF });
    };
    const required = ['lightBeam', 'mushroomCap', 'opticTip', 'lotusRing', 'flowerStem'];
    let safe = true;
    required.forEach(key => {
        if (!foliageMaterials[key]) {
            console.error(`[Foliage] Missing material: ${key}. Using fallback.`);
            foliageMaterials[key] = getFallbackMaterial();
            safe = false;
        }
    });
    return safe;
}

export function validateNodeGeometries(scene: THREE.Object3D) {
    // Aggregate warnings to avoid spamming the console when many small geometries are missing attributes.
    const missingPosition: any[] = [];

    function inferVertexCount(geo: THREE.BufferGeometry) {
        if (!geo) return 0;
        if (geo.index) return geo.index.count;
        let maxCount = 0;
        for (const key in geo.attributes) {
            if (Object.prototype.hasOwnProperty.call(geo.attributes, key)) {
                const a = geo.attributes[key];
                if (a && a.count > maxCount) maxCount = a.count;
            }
        }
        return maxCount;
    }

    function getObjectPath(obj: THREE.Object3D | null) {
        const parts = [];
        let cur = obj;
        while (cur) {
            const name = cur.name || cur.type || cur.uuid;
            parts.unshift(name);
            cur = cur.parent;
        }
        return parts.join('/') || (obj ? obj.uuid : '');
    }

    scene.traverse((obj: THREE.Object3D) => {
        if ((obj as THREE.Mesh).isMesh || (obj as THREE.Points).isPoints) {
            const geo = (obj as THREE.Mesh).geometry;
            if (geo) {
                // Attempt to auto-patch a missing position attribute when we can infer a vertex count.
                if (!geo.attributes.position) {
                    const preAttrKeys = Object.keys(geo.attributes || {}).join(', ') || '(none)';
                    const inferred = inferVertexCount(geo);
                    if (inferred > 0) {
                        const positions = new Float32Array(inferred * 3);
                        geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
                    } else {
                        try {
                            // ⚡ OPTIMIZATION: Reuse scratch vector to prevent GC spikes during validation
                            const worldPos = _scratchVec1;
                            obj.getWorldPosition(worldPos);
                            const positions = new Float32Array(3);
                            positions[0] = worldPos.x; positions[1] = worldPos.y; positions[2] = worldPos.z;
                            geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));

                            const normals = new Float32Array(3);
                            normals[0] = 0; normals[1] = 1; normals[2] = 0;
                            geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));

                            obj.userData._patchedByValidate = true;

                            const name = obj.name || 'Unnamed';
                            const type = obj.userData?.type || 'Unknown Type';
                            const attrKeys = Object.keys(geo.attributes || {}).join(', ') || '(none)';
                            const geoType = geo.type || geo.constructor?.name || 'UnknownGeo';

                            let anc = obj.parent;
                            let ancestorType = null;
                            let ancestorName = null;
                            let depth = 0;
                            while (anc && depth < 10) {
                                if (anc && anc.userData && anc.userData.type) {
                                    ancestorType = anc.userData.type;
                                    ancestorName = anc.name || anc.userData.type;
                                    break;
                                }
                                anc = anc && anc.parent;
                                depth++;
                            }
                            missingPosition.push({ name, type, obj, geoType, attrKeys, path: getObjectPath(obj), patched: true, ancestorType, ancestorName, preAttrKeys });
                        } catch (err) {
                            const name = obj.name || 'Unnamed';
                            const type = obj.userData?.type || 'Unknown Type';
                            const attrKeys = Object.keys(geo.attributes || {}).join(', ') || '(none)';
                            const geoType = geo.type || geo.constructor?.name || 'UnknownGeo';
                            missingPosition.push({ name, type, obj, geoType, attrKeys, path: getObjectPath(obj), preAttrKeys });
                        }
                    }
                }

                if (!geo.attributes.normal) {
                    const count = geo.attributes.position ? geo.attributes.position.count : inferVertexCount(geo);
                    if (count > 0) {
                        const normals = new Float32Array(count * 3);
                        for (let i = 0; i < count * 3; i += 3) { normals[i] = 0; normals[i + 1] = 1; normals[i + 2] = 0; }
                        geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
                    }
                }
            }
        }
    });

    if (missingPosition.length > 0) {
        const header = `[TSL] ${missingPosition.length} geometries missing 'position' attribute.`;
        const examples = missingPosition.slice(0, 10).map(m => `${m.path} -> ${m.name}(${m.type}) [${m.geoType}] attrs: ${m.attrKeys}${m.patched ? ' (patched)' : ''}${m.ancestorType ? ` ancestor:${m.ancestorType}` : ''}`);
        const patchedCount = missingPosition.filter(m => m.patched).length;
        const more = missingPosition.length > 10 ? ` + ${missingPosition.length - 10} more` : '';
        let msg = `${header} Examples: ${examples.join('; ')}${more}.`;
        if (patchedCount > 0) {
            msg += ` Note: ${patchedCount} were auto-patched with minimal position/normal data; consider fixing the source constructor.`;
        }
        console.warn(msg);
    }
}
