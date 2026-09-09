/**
 * Hero clip animation staging area — `?heroAnim=1`.
 *
 * Loads the tiny test rig (`public/models/hero-clip-test.gltf`, two keyframed
 * TRS clips) near the player spawn and plays one on a loop, so the clip player
 * in `src/systems/animation/clip-player.ts` has a visible surface to verify
 * against. Nothing in the default boot path loads this.
 *
 * Controls (while the flag is on):
 *   J — next clip (crossfades)
 *   K — stop / restart the current clip
 *
 * `window.__heroAnim` exposes `clips()`, `current()`, `rigs()`, `play(name)`
 * and `stop()` for console inspection.
 */

import * as THREE from 'three';
import {
    getHeroRig,
    playHeroClip,
    stopHeroClip,
    unregisterHeroRig,
} from '../systems/animation/clip-player.ts';
import { HERO_TEST_ASSET, loadHeroRig } from '../systems/animation/hero-rig-loader.ts';
import { getUnifiedGroundHeightTyped } from '../systems/physics.core.ts';

/** Registry key for the staged rig. */
const RIG = 'debug.hero';

/** The node the test asset's clips target (see scripts/gen-hero-clip-asset.mjs). */
const ANIMATED_NODE = 'HeroCube';

/** Where the rig stands, relative to the spawn origin. */
const OFFSET = { dx: -4.0, dz: -4.5, lift: 0.9 };

const PEDESTAL_COLOR = 0xfff4f8;

let _enabled = false;
let _scene: THREE.Scene | null = null;
let _root: THREE.Object3D | null = null;
let _pedestal: THREE.Mesh | null = null;
let _keyHandler: ((e: KeyboardEvent) => void) | null = null;

export function isHeroAnimationDemoEnabled(): boolean {
    return _enabled;
}

/**
 * Stage the rig around `origin` (normally the player spawn).
 * Async: the glTF and the loader both stream in. Safe to call twice.
 */
export async function initHeroAnimationDemo(
    scene: THREE.Scene,
    origin: THREE.Vector3
): Promise<void> {
    disposeHeroAnimationDemo();

    _enabled = true;
    _scene = scene;

    const cx = origin.x + OFFSET.dx;
    const cz = origin.z + OFFSET.dz;
    const groundY = getUnifiedGroundHeightTyped(cx, cz);

    // The pedestal goes up immediately so the staging spot is visible even if
    // the asset fetch is slow or fails.
    const pedGeo = new THREE.CylinderGeometry(0.9, 1.0, 0.3, 24);
    _pedestal = new THREE.Mesh(
        pedGeo,
        new THREE.MeshPhysicalMaterial({
            color: PEDESTAL_COLOR,
            roughness: 0.3,
            metalness: 0.0,
            clearcoat: 0.7,
            clearcoatRoughness: 0.2,
        })
    );
    _pedestal.position.set(cx, groundY + 0.15, cz);
    scene.add(_pedestal);

    installKeys();
    exposeDebugHandle();

    let rig;
    try {
        rig = await loadHeroRig({
            name: RIG,
            url: HERO_TEST_ASSET,
            defaultClip: 'bounce',
            prepare: (root) => {
                // The clips animate the node's TRS, so the offset lives on a
                // parent — otherwise the first keyframe would snap it to origin.
                root.scale.setScalar(0.8);
            },
        });
    } catch (e) {
        console.error('[hero-anim] Demo rig failed to load', e);
        return;
    }

    // Another init (or a dispose) landed while the asset was in flight.
    if (!_enabled || _scene !== scene) {
        unregisterHeroRig(RIG);
        return;
    }

    const holder = new THREE.Group();
    holder.name = 'HeroAnimDemo';
    holder.position.set(cx, groundY + OFFSET.lift, cz);
    holder.add(rig.root);
    scene.add(holder);
    _root = holder;

    console.warn(
        `[hero-anim] Debug rig staged — clips: ${rig.clipNames.join(', ')} ` +
            `(skinned: ${rig.isSkinned})`
    );
}

/** Cycle to the next clip on the rig. */
export function cycleHeroAnimationClip(): void {
    const rig = getHeroRig(RIG);
    if (!rig) return;
    const names = rig.clipNames;
    if (names.length === 0) return;
    const i = rig.current ? names.indexOf(rig.current) : -1;
    const next = names[(i + 1) % names.length];
    playHeroClip(RIG, next, { loop: true, fade: 0.25 });
    console.warn(`[hero-anim] → ${next}`);
}

function installKeys(): void {
    if (_keyHandler) return;
    _keyHandler = (e: KeyboardEvent) => {
        if (!_enabled) return;
        const el = document.activeElement as HTMLElement | null;
        if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) {
            return;
        }
        if (e.code === 'KeyJ') {
            cycleHeroAnimationClip();
        } else if (e.code === 'KeyK') {
            const rig = getHeroRig(RIG);
            if (!rig) return;
            if (rig.current) {
                stopHeroClip(RIG, 0.2);
                console.warn('[hero-anim] stopped');
            } else {
                playHeroClip(RIG, rig.clipNames[0], { loop: true, restart: true });
                console.warn(`[hero-anim] → ${rig.clipNames[0]}`);
            }
        }
    };
    window.addEventListener('keydown', _keyHandler);
}

/** Console handle, matching the soft-body / rigid-body sandbox shape. */
function exposeDebugHandle(): void {
    (window as unknown as Record<string, unknown>).__heroAnim = {
        clips: () => getHeroRig(RIG)?.clipNames ?? [],
        current: () => getHeroRig(RIG)?.current ?? null,
        skinned: () => getHeroRig(RIG)?.isSkinned ?? false,
        /**
         * Local TRS of the node the clips actually drive. Note this is *not*
         * the rig root: glTF clips target named nodes inside the scene, and
         * the root itself never moves. Pass a name to inspect another node.
         */
        pose: (name = ANIMATED_NODE) => {
            const node = getHeroRig(RIG)?.root.getObjectByName(name);
            if (!node) return null;
            return {
                node: node.name,
                position: node.position.toArray(),
                quaternion: node.quaternion.toArray(),
                scale: node.scale.toArray(),
            };
        },
        play: (name: string) => playHeroClip(RIG, name, { loop: true }),
        stop: () => stopHeroClip(RIG),
        next: () => cycleHeroAnimationClip(),
    };
}

/** Full teardown — rig, pedestal and the hotkey listener. */
export function disposeHeroAnimationDemo(): void {
    unregisterHeroRig(RIG);

    if (_root) {
        _scene?.remove(_root);
        _root.traverse((o) => {
            const mesh = o as THREE.Mesh;
            if (!mesh.isMesh) return;
            mesh.geometry.dispose();
            const mat = mesh.material;
            if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
            else mat?.dispose();
        });
        _root = null;
    }
    if (_pedestal) {
        _scene?.remove(_pedestal);
        _pedestal.geometry.dispose();
        (_pedestal.material as THREE.Material).dispose();
        _pedestal = null;
    }
    if (_keyHandler) {
        window.removeEventListener('keydown', _keyHandler);
        _keyHandler = null;
    }
    _enabled = false;
    _scene = null;
}
