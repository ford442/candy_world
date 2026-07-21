/**
 * @file src/world/sky-island-graph.ts
 * @brief Connectivity graph for stacked sky islands (#1363).
 *
 * Nodes = islands / cloud hops / lift pads.
 * Edges = vine ladders, cloud hops, music-reactive lift pads.
 * Debug viz via `?debugIslands=1`.
 */

import * as THREE from 'three';

export type SkyIslandEdgeKind = 'vine_ladder' | 'cloud_hop' | 'lift_pad' | 'approach';

export interface SkyIslandNode {
    id: string;
    layerId: string;
    x: number;
    y: number;
    z: number;
    kind: 'island' | 'cloud' | 'pad' | 'ground';
}

export interface SkyIslandEdge {
    id: string;
    from: string;
    to: string;
    kind: SkyIslandEdgeKind;
}

const _nodes = new Map<string, SkyIslandNode>();
const _edges: SkyIslandEdge[] = [];

let _debugEnabled = false;
let _scene: THREE.Scene | null = null;
let _edgeLines: THREE.LineSegments | null = null;
let _nodeMarkers: THREE.InstancedMesh | null = null;

function isDebugFlagEnabled(): boolean {
    try {
        return new URLSearchParams(window.location.search).get('debugIslands') === '1';
    } catch {
        return false;
    }
}

export function clearSkyIslandGraph(): void {
    _nodes.clear();
    _edges.length = 0;
    disposeDebugMeshes();
}

export function registerSkyIslandNode(node: SkyIslandNode): void {
    _nodes.set(node.id, node);
}

export function registerSkyIslandEdge(edge: SkyIslandEdge): void {
    const existing = _edges.findIndex(e => e.id === edge.id);
    if (existing >= 0) _edges[existing] = edge;
    else _edges.push(edge);
}

export function getSkyIslandNodes(): readonly SkyIslandNode[] {
    return Array.from(_nodes.values());
}

export function getSkyIslandEdges(): readonly SkyIslandEdge[] {
    return _edges;
}

/** Validate that every edge references known nodes and Y increases along climb edges. */
export function validateSkyIslandGraph(): { ok: boolean; errors: string[] } {
    const errors: string[] = [];
    for (const edge of _edges) {
        const from = _nodes.get(edge.from);
        const to = _nodes.get(edge.to);
        if (!from) errors.push(`edge ${edge.id}: missing from node ${edge.from}`);
        if (!to) errors.push(`edge ${edge.id}: missing to node ${edge.to}`);
        if (from && to && edge.kind === 'vine_ladder' && to.y <= from.y) {
            errors.push(`edge ${edge.id}: vine ladder should climb (to.y ${to.y} <= from.y ${from.y})`);
        }
    }
    return { ok: errors.length === 0, errors };
}

/**
 * Sample a synthetic traversal path: ground → lowest island → highest.
 * Used by unit tests as a #1265 regression guard (platform Y preserved).
 */
export function buildTraversalWaypoints(): Array<{ x: number; y: number; z: number; id: string }> {
    const islands = Array.from(_nodes.values())
        .filter(n => n.kind === 'island' || n.kind === 'cloud')
        .sort((a, b) => a.y - b.y);
    if (islands.length === 0) return [];
    const path: Array<{ x: number; y: number; z: number; id: string }> = [
        { x: islands[0].x, y: 2.0, z: islands[0].z, id: 'spawn_ground' },
    ];
    for (const n of islands) {
        path.push({ x: n.x, y: n.y, z: n.z, id: n.id });
    }
    // Return descent
    for (let i = islands.length - 2; i >= 0; i--) {
        path.push({ x: islands[i].x, y: islands[i].y, z: islands[i].z, id: `return:${islands[i].id}` });
    }
    path.push({ x: islands[0].x, y: 2.0, z: islands[0].z, id: 'return_ground' });
    return path;
}

function disposeDebugMeshes(): void {
    if (_edgeLines && _scene) {
        _scene.remove(_edgeLines);
        _edgeLines.geometry.dispose();
        (_edgeLines.material as THREE.Material).dispose();
        _edgeLines = null;
    }
    if (_nodeMarkers && _scene) {
        _scene.remove(_nodeMarkers);
        _nodeMarkers.geometry.dispose();
        (_nodeMarkers.material as THREE.Material).dispose();
        _nodeMarkers = null;
    }
}

/** Init debug overlay when `?debugIslands=1`. Call after scene exists. */
export function initSkyIslandDebug(scene: THREE.Scene): void {
    _scene = scene;
    _debugEnabled = isDebugFlagEnabled();
    if (!_debugEnabled) return;
    rebuildSkyIslandDebug();
    (window as any).__skyIslandGraph = {
        nodes: () => getSkyIslandNodes(),
        edges: () => getSkyIslandEdges(),
        validate: validateSkyIslandGraph,
        waypoints: buildTraversalWaypoints,
    };
    console.log('[SkyIslands] debug viz enabled (?debugIslands=1)');
}

export function rebuildSkyIslandDebug(): void {
    if (!_debugEnabled || !_scene) return;
    disposeDebugMeshes();

    const nodes = getSkyIslandNodes();
    const edges = getSkyIslandEdges();
    if (nodes.length === 0) return;

    // Edge lines
    const positions: number[] = [];
    const colors: number[] = [];
    const kindColor = (kind: SkyIslandEdgeKind): THREE.Color => {
        switch (kind) {
            case 'vine_ladder': return new THREE.Color(0x32CD32);
            case 'cloud_hop': return new THREE.Color(0x00FFFF);
            case 'lift_pad': return new THREE.Color(0xFF69B4);
            default: return new THREE.Color(0xFFD700);
        }
    };
    for (const edge of edges) {
        const from = _nodes.get(edge.from);
        const to = _nodes.get(edge.to);
        if (!from || !to) continue;
        positions.push(from.x, from.y + 0.5, from.z, to.x, to.y + 0.5, to.z);
        const c = kindColor(edge.kind);
        colors.push(c.r, c.g, c.b, c.r, c.g, c.b);
    }
    if (positions.length > 0) {
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
        const mat = new THREE.LineBasicMaterial({ vertexColors: true, depthTest: false });
        _edgeLines = new THREE.LineSegments(geo, mat);
        _edgeLines.renderOrder = 9998;
        _edgeLines.frustumCulled = false;
        _scene.add(_edgeLines);
    }

    // Node markers
    const markerGeo = new THREE.SphereGeometry(0.45, 8, 8);
    const markerMat = new THREE.MeshBasicMaterial({ color: 0xFF69B4, depthTest: false });
    _nodeMarkers = new THREE.InstancedMesh(markerGeo, markerMat, nodes.length);
    _nodeMarkers.renderOrder = 9999;
    _nodeMarkers.frustumCulled = false;
    const dummy = new THREE.Object3D();
    nodes.forEach((n, i) => {
        dummy.position.set(n.x, n.y + 0.6, n.z);
        dummy.updateMatrix();
        _nodeMarkers!.setMatrixAt(i, dummy.matrix);
    });
    _nodeMarkers.instanceMatrix.needsUpdate = true;
    _scene.add(_nodeMarkers);
}
