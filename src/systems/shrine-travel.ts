// src/systems/shrine-travel.ts
//
// Effect of the `shrine_master` unlock (#1976 slice A): shrines the player has
// activated are remembered, and with Shrine Master an activated shrine carries
// the player to the next one.

import type * as THREE from 'three';
import { announce } from '../ui/announcer.ts';
import { showToast } from '../utils/toast.ts';
import { placePlayerOnGround } from './player-spawn.ts';
import { unlockSystem } from './unlocks.ts';

export interface ShrineSite {
    x: number;
    z: number;
}

const STORAGE_KEY = 'candy_world_visited_shrines';
/** Two sites closer than this are the same shrine. */
const SAME_SITE_M = 1.0;
/** Arrival offset, so the player does not land inside the monolith. */
const ARRIVAL_OFFSET_M = 3.5;

function isSameSite(a: ShrineSite, b: ShrineSite): boolean {
    return Math.hypot(a.x - b.x, a.z - b.z) < SAME_SITE_M;
}

/** The shrine after `from` in visiting order, wrapping; null when there is nowhere else to go. */
export function pickNextShrine(visited: readonly ShrineSite[], from: ShrineSite): ShrineSite | null {
    const at = visited.findIndex((s) => isSameSite(s, from));
    if (at < 0) return visited[0] ?? null;
    if (visited.length < 2) return null;
    return visited[(at + 1) % visited.length];
}

function loadVisited(): ShrineSite[] {
    try {
        if (typeof localStorage === 'undefined') return [];
        const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
        if (!Array.isArray(parsed)) return [];
        return parsed.filter(
            (s): s is ShrineSite => Number.isFinite(s?.x) && Number.isFinite(s?.z)
        );
    } catch {
        return [];
    }
}

let _visited: ShrineSite[] = loadVisited();
let _camera: THREE.Camera | null = null;

/** The camera to carry along when travelling (set at boot; injected to keep this a leaf). */
export function setShrineTravelCamera(camera: THREE.Camera | null): void {
    _camera = camera;
}

function saveVisited(): void {
    try {
        if (typeof localStorage !== 'undefined') {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(_visited));
        }
    } catch {
        /* private mode */
    }
}

export function getVisitedShrines(): readonly ShrineSite[] {
    return _visited;
}

export function isShrineVisited(site: ShrineSite): boolean {
    return _visited.some((s) => isSameSite(s, site));
}

/** Remember an activated shrine. Returns true the first time. */
export function recordShrineVisit(site: ShrineSite): boolean {
    if (isShrineVisited(site)) return false;
    _visited.push({ x: site.x, z: site.z });
    saveVisited();
    return true;
}

/** Shrine Master only: carry the player from `from` to the next visited shrine. */
export function travelToNextShrine(from: ShrineSite): boolean {
    if (!unlockSystem.isUnlocked('shrine_master')) return false;
    const next = pickNextShrine(_visited, from);
    if (!next || !_camera) {
        announce('No other shrine to travel to yet. Activate more shrines.', 'polite');
        return false;
    }
    placePlayerOnGround(_camera, next.x + ARRIVAL_OFFSET_M, next.z + ARRIVAL_OFFSET_M);
    showToast('Shrine Travel', '⛩️', 2500);
    announce('Traveled to the next shrine.', 'polite');
    return true;
}

/** Test hook. */
export function resetShrineTravel(): void {
    _visited = [];
    saveVisited();
}
