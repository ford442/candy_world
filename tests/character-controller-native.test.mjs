#!/usr/bin/env node
/**
 * Native-assist ABI test for updatePhysicsCPP (emscripten/physics.cpp), #1822.
 *
 * `updatePhysicsCPP` is an obstacle/trampoline assist only. TS's
 * `resolveCharacterMovement` (src/systems/physics/character-controller.ts)
 * owns gravity, ground/air acceleration, ground Y-snap, coyote time, jump
 * buffering and jump. This test drives the real compiled single-threaded
 * module (public/candy_native_st.{js,wasm}), not a mock, and asserts:
 *
 *   1. With no obstacles, native never claims ground contact from terrain,
 *      never snaps Y to groundY + 1.8f, and leaves vy alone under jump=1.
 *   2. XZ input (TS's already speed-scaled target velocity) is used as-is:
 *      no second `* speed`, no smoothing.
 *   3. A regular mushroom cap reports contact (onGround === 1) without
 *      snapping Y or zeroing vy.
 *   4. A trampoline mushroom still reports onGround === 2 with a bounce vy,
 *      the one case where native may author vy.
 *   5. A mushroom stem still pushes the player's XZ out to stemR + radius.
 *
 * Runs in plain Node, with no browser. The Emscripten glue's default loader
 * fetch()es the .wasm, and Node's fetch has no file:// support, so the bytes
 * are supplied through `instantiateWasm` (the same approach as
 * tests/parity.mjs).
 *
 * SKIPS CLEANLY (exit 0) when public/candy_native_st.{js,wasm} are absent.
 * Build them with `npm run build:emcc` (requires emsdk).
 *
 * Run: npm run test:character-native
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const WASM_JS = path.join(REPO_ROOT, 'public', 'candy_native_st.js');
const WASM_BIN = path.join(REPO_ROOT, 'public', 'candy_native_st.wasm');

if (!fs.existsSync(WASM_JS) || !fs.existsSync(WASM_BIN)) {
    console.log('[test:character-native] SKIPPED — public/candy_native_st.{js,wasm} not found.');
    console.log('[test:character-native] Build them with `npm run build:emcc` (requires emsdk).');
    process.exit(0);
}

let passCount = 0;
let failCount = 0;
function check(name, ok, details = '') {
    if (ok) {
        console.log(`  ok - ${name}`);
        passCount++;
    } else {
        console.log(`  FAIL - ${name}${details ? `: ${details}` : ''}`);
        failCount++;
    }
}

async function loadNativeModule() {
    const mod = await import(pathToFileURL(WASM_JS).href);
    const factory = mod.default;
    const wasmBytes = fs.readFileSync(WASM_BIN);
    return factory({
        instantiateWasm(imports, successCallback) {
            WebAssembly.instantiate(wasmBytes, imports).then(({ instance, module }) => {
                successCallback(instance, module);
            });
            return {};
        },
    });
}

function runScenarios(M, delta) {
    const out = {};
    // 1+2. No obstacles, seeded squarely inside the OLD landing
    // window (getGroundHeight(0,0) === 2.3, so the removed
    // `nextY < groundY + 1.8f` snap used to fire anywhere below
    // y=4.1 while falling): native must not author ground
    // contact, snap Y, zero vy, or fire a jump from terrain
    // alone anymore. y=4.0 falling at vy=-2 lands nextY ~= 3.97,
    // inside that old [-, 4.1) window, so this genuinely
    // exercises the removed behavior rather than merely being
    // too far from the ground to trigger it either way.
    M._initPhysics(0, 4.0, 0);
    M._setPlayerState(0, 4.0, 0, 0, -2, 0);
    out.noObstacleOnGround = M._updatePhysicsCPP(delta, 0, 0, 6, 1, 0, 0, 1.0);
    out.noObstacleVy = M._getPlayerVY();
    out.noObstacleY = M._getPlayerY();

    // 2b. XZ input is TS's already speed-scaled target velocity and
    // must be used as-is: the pre-ABI code multiplied it by `speed`
    // a second time (targetVX = inputX * speed) and smoothed it.
    M._initPhysics(0, 4.0, 0);
    M._setPlayerState(0, 4.0, 0, 0, 0, 0);
    M._updatePhysicsCPP(delta, 3.0, -1.5, 6, 0, 0, 0, 1.0);
    out.moveX = M._getPlayerX();
    out.moveZ = M._getPlayerZ();

    // 2c. Regular (non-trampoline) mushroom cap: contact is
    // reported, but Y is not snapped to capTop + 1.8f.
    M._initPhysics(0, 0, 0);
    M._addCollisionObject(0, 0, 0, 0, 0.5, 3.0, 1.0, 2.0, 0);
    M._setPlayerState(0, 3.2, 0, 0, -1, 0);
    out.capOnGround = M._updatePhysicsCPP(delta, 0, 0, 6, 1, 0, 0, 1.0);
    out.capY = M._getPlayerY();
    out.capVy = M._getPlayerVY();

    // 3. Trampoline mushroom (type 0, param3 > 0.5): bounce impulse
    // is still native's to author.
    M._initPhysics(0, 0, 0);
    M._addCollisionObject(0, 0, 0, 0, 0.5, 3.0, 0.5, 2.0, 1);
    M._setPlayerState(0, 3.2, 0, 0, -5, 0);
    out.trampolineOnGround = M._updatePhysicsCPP(delta, 0, 0, 6, 0, 0, 0, 1.0);
    out.trampolineVy = M._getPlayerVY();

    // 4. Non-trampoline mushroom stem: still pushes XZ away.
    M._initPhysics(0, 0, 0);
    M._addCollisionObject(0, 0, 0, 0, 1.0, 3.0, 1.0, 2.0, 0);
    M._setPlayerState(0.3, 0.5, 0, 0, 0, 0);
    M._updatePhysicsCPP(delta, 0, 0, 6, 0, 0, 0, 1.0);
    out.pushedX = M._getPlayerX();
    out.pushedZ = M._getPlayerZ();

    return out;
}

async function main() {
    let M;
    try {
        M = await loadNativeModule();
    } catch (err) {
        check('candy_native_st loads and instantiates', false, String((err && err.stack) || err));
    }

    if (M) {
        check('candy_native_st loads and instantiates', true);
        const DELTA = 1 / 60;
        const results = runScenarios(M, DELTA);

        check(
            'no obstacles, inside the old landing window: native reports no ground contact (terrain Y-snap removed)',
            results.noObstacleOnGround === 0,
            `onGround=${results.noObstacleOnGround}`
        );
        check(
            'no obstacles, inside the old landing window, jump=1: vy untouched (no snap-to-zero, no jump gate)',
            Math.abs(results.noObstacleVy - -2) < 1e-3,
            `vy=${results.noObstacleVy}`
        );
        check(
            'no obstacles, jump=1: Y only advances by the seeded vy (no groundY + 1.8f snap)',
            Math.abs(results.noObstacleY - (4.0 - 2 * DELTA)) < 1e-4,
            `y=${results.noObstacleY}`
        );
        check(
            'XZ input used as-is: displacement == input * delta (no second speed multiply, no smoothing)',
            Math.abs(results.moveX - 3.0 * DELTA) < 1e-5 &&
                Math.abs(results.moveZ - -1.5 * DELTA) < 1e-5,
            `x=${results.moveX}, z=${results.moveZ}`
        );
        check(
            'regular mushroom cap: reports contact (onGround === 1) without snapping Y or zeroing vy',
            results.capOnGround === 1 &&
                Math.abs(results.capY - (3.2 - DELTA)) < 1e-4 &&
                Math.abs(results.capVy - -1) < 1e-4,
            `onGround=${results.capOnGround}, y=${results.capY}, vy=${results.capVy}`
        );
        check(
            'trampoline mushroom: reports bounce contact (onGround === 2)',
            results.trampolineOnGround === 2,
            `onGround=${results.trampolineOnGround}`
        );
        check(
            'trampoline mushroom: bounce vy applied',
            results.trampolineVy > 0,
            `vy=${results.trampolineVy}`
        );
        check(
            'stem push: player pushed to stemR + playerRadius from stem center',
            Math.abs(Math.hypot(results.pushedX, results.pushedZ) - 1.5) < 1e-3,
            `x=${results.pushedX}, z=${results.pushedZ}`
        );
    }

    console.log('');
    console.log(`Passed: ${passCount}, Failed: ${failCount}`);
    process.exit(failCount > 0 ? 2 : 0);
}

main().catch((err) => {
    console.error('[test:character-native] runner error:', err);
    process.exit(2);
});
