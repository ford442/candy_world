/**
 * Three 0.171 registers only `srgb` and `srgb-linear`. Selecting any other
 * `outputColorSpace` makes the output transform call
 * `ColorManagement.getPrimaries()` on an undefined entry and throw a
 * TypeError mid-render (#1972). Call {@link ensureOutputColorSpace} before
 * assigning `renderer.outputColorSpace`.
 */

import { ColorManagement } from 'three';
import {
    DisplayP3ColorSpace,
    DisplayP3ColorSpaceImpl,
    LinearDisplayP3ColorSpace,
    LinearDisplayP3ColorSpaceImpl,
} from 'three/addons/math/ColorSpaces.js';

let p3Registered = false;

/** Register Display P3 (and its linear twin) with Three. Idempotent. */
export function registerDisplayP3(): void {
    if (p3Registered) return;
    ColorManagement.define({
        [DisplayP3ColorSpace]: DisplayP3ColorSpaceImpl,
        [LinearDisplayP3ColorSpace]: LinearDisplayP3ColorSpaceImpl,
    });
    p3Registered = true;
}

/**
 * The color space to assign to `renderer.outputColorSpace`: `requested` once
 * Three knows it (registering P3 on demand), otherwise `srgb`.
 */
export function ensureOutputColorSpace(requested: string): string {
    if (requested === DisplayP3ColorSpace) registerDisplayP3();
    try {
        ColorManagement.getPrimaries(requested);
        return requested;
    } catch {
        console.warn(`[ColorSpace] '${requested}' is not registered with Three — using srgb`);
        return 'srgb';
    }
}
