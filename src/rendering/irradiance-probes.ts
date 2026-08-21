/**
 * Lightweight GI — an irradiance probe volume (SH L1) that follows the player.
 *
 * Candy World is lit as hemisphere ambient + one directional sun, so anything
 * that is not facing the sky reads flat: cave undersides, the inside of a dense
 * grove, the sugar caves. This adds the *one* missing term — a soft, coloured
 * bounce — without a second render pass, a G-buffer, or a ray budget.
 *
 * ## Why probes rather than screen-space
 *
 * SSGI reacts to whatever happens to be on screen, so it flickers on a camera
 * cut and vanishes for anything off-screen — exactly the surfaces that need it
 * here. A probe volume is stable under motion, costs four texture fetches in
 * the fragment shader, and is a plain `Data3DTexture`, which the GLSL node
 * backend supports as well as WGSL. The bake is CPU-side and analytic, so it
 * runs the same on either backend.
 *
 * ## Why it is candy-first
 *
 * The bake is deliberately *not* a physically-correct gather. It sums three
 * pastel sources — sky openness, ground bounce off the pale-mint terrain, and
 * every registered local light treated as a coloured bounce donor — and then
 * pushes the result back toward `CONFIG.lighting.gi.pastelSaturation`. Real
 * multi-bounce converges toward grey; this converges toward *tint*. Interiors
 * pick up the cyan of a crystal rib or the pink of a mushroom spot instead of
 * a dirty grey wash, which is the look the world is after.
 *
 * ## Shape
 *
 * - `gridX × gridY × gridZ` probes, spaced `cellSize` apart, centred on the
 *   camera and snapped to the cell grid so the volume does not swim.
 * - Each probe stores SH L1: `L0` (vec3) plus `L1x/L1y/L1z` (vec3 each),
 *   encoded into four RGBA8 3D textures. `tex0.a` carries sky visibility.
 * - The bake is amortised: `probesPerFrame` probes per frame, nearest to the
 *   camera first, cycling forever so the day/night tint follows along.
 *
 * Quality: off on `low` (WebGL and CI/headless both clamp to `low`), low-res on
 * `medium`, denser on `high`. See `resolveGiSettings()`.
 *
 * @see docs/IRRADIANCE_PROBES.md
 */
import * as THREE from 'three';
import { clamp, float, max, min, smoothstep, texture3D, uniform, vec3 } from 'three/tsl';
import type { Node } from 'three/webgpu';
import { CONFIG } from '../core/config/defaults.ts';
import { resolveGiSettings, type GiSettings } from '../core/config/postfx.ts';
import { getUrlFlag, hasUrlFlag } from '../core/config/url-flags.ts';
import { forEachLocalLight } from './lights.ts';

/**
 * Terrain height at a world XZ. Injected rather than imported so this module
 * stays off the WASM ground-system's import chain — the bake only needs a
 * heightfield, and headless suites can hand it a synthetic one.
 */
export type GroundSampler = (x: number, z: number) => number;

/** Current sky / sun state, pushed from the game loop each frame. */
export interface GiEnvironment {
    /** Hemisphere sky colour — the overhead term. */
    sky: THREE.Color;
    /** Hemisphere ground colour — tints the sunless side of the bounce. */
    ground: THREE.Color;
    sun: THREE.Color;
    sunIntensity: number;
    /** Normalised direction *toward* the sun. */
    sunDirection: THREE.Vector3;
}

interface Donor {
    x: number;
    y: number;
    z: number;
    r: number;
    g: number;
    b: number;
    /** Squared reach, precomputed. */
    reachSq: number;
    reach: number;
    intensity: number;
}

/** RGBA8 texel store for one SH band, backed by a plain (non-shared) buffer. */
type BandData = Uint8Array<ArrayBuffer>;

interface ProbeVolume {
    settings: GiSettings;
    /** Probe count per axis. */
    nx: number;
    ny: number;
    nz: number;
    /** World position of probe (0,0,0). */
    origin: THREE.Vector3;
    /** Encoded SH bands. `data[0]` also carries sky visibility in alpha. */
    data: [BandData, BandData, BandData, BandData];
    textures: [THREE.Data3DTexture, THREE.Data3DTexture, THREE.Data3DTexture, THREE.Data3DTexture];
    /** Probe indices ordered nearest-to-centre — the bake walks this. */
    order: Int32Array;
    cursor: number;
    /** Probes baked since the volume last moved. Caps at `order.length`. */
    baked: number;
}

let _volume: ProbeVolume | null = null;
let _enabled = false;
let _debugMesh: THREE.InstancedMesh | null = null;
let _scene: THREE.Scene | null = null;

/** Live master gain. 0 restores the pre-GI look exactly — the term drops out. */
const uGiIntensity = uniform(0);
/** How much of the directional (L1) band survives. */
const uGiDirectionality = uniform(0);
/** Encode/decode scale shared by all four bands. */
const uGiRange = uniform(1);
/** World-space corner of the sampling box (probe 0 minus half a cell). */
const uGiOrigin = uniform(new THREE.Vector3());
/** Reciprocal box extent, so the shader multiplies instead of dividing. */
const uGiInvSize = uniform(new THREE.Vector3(1, 1, 1));
const uGiEdgeFade = uniform(0.12);

// Scratch — the bake runs every frame, so it must not allocate.
const _scratchColor = new THREE.Color();
const _scratchHsl = { h: 0, s: 0, l: 0 };
const _scratchProbePos = new THREE.Vector3();
const _scratchDonorPos = new THREE.Vector3();
const _sh = new Float32Array(12);
const _donors: Donor[] = [];
let _donorCount = 0;
let _breadcrumbTick = 0;

/** Set by `initIrradianceProbes()`. Flat ground until then. */
let _sampleGround: GroundSampler = () => 0;

const _env: GiEnvironment = {
    sky: new THREE.Color(0x87ceeb),
    ground: new THREE.Color(0x98fb98),
    sun: new THREE.Color(0xfffaf0),
    sunIntensity: 0.9,
    sunDirection: new THREE.Vector3(0.5, 1, 0.4).normalize(),
};

function cfg() {
    return CONFIG.lighting.gi;
}

/**
 * One-line startup breadcrumbs, matching `lights.ts` / `shadow-cascades.ts`.
 * `utils/log.ts` is not usable here — it reads `import.meta.env`, which the
 * headless suite (plain node, no bundler) does not define.
 */
function note(message: string): void {
    // eslint-disable-next-line no-console -- startup breadcrumb, same as sibling lighting modules
    console.log(`[GI] ${message}`);
}

/** `?gi=debug` (or `?debug=1`) draws a gizmo per probe, tinted by its bake. */
function probeDebugRequested(): boolean {
    return hasUrlFlag('debug') || getUrlFlag('gi') === 'debug';
}

// ---------------------------------------------------------------------------
// Volume allocation
// ---------------------------------------------------------------------------

function makeBandTexture(nx: number, ny: number, nz: number, data: BandData): THREE.Data3DTexture {
    const tex = new THREE.Data3DTexture(data, nx, ny, nz);
    tex.format = THREE.RGBAFormat;
    tex.type = THREE.UnsignedByteType;
    tex.colorSpace = THREE.NoColorSpace;
    // Trilinear across probes is the whole point — it is what makes a 10³ grid
    // read as a smooth gradient rather than as blocks.
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.wrapR = THREE.ClampToEdgeWrapping;
    tex.unpackAlignment = 1;
    tex.generateMipmaps = false;
    tex.needsUpdate = true;
    return tex;
}

/**
 * Probe indices sorted by distance from the volume centre.
 *
 * The bake budget is spent nearest-first so that after a volume shift the
 * probes around the player settle within a frame or two and the far corners
 * catch up later, where the error is invisible behind fog.
 */
function buildBakeOrder(nx: number, ny: number, nz: number): Int32Array {
    const total = nx * ny * nz;
    const order = new Int32Array(total);
    const dist = new Float32Array(total);
    const cx = (nx - 1) * 0.5;
    const cy = (ny - 1) * 0.5;
    const cz = (nz - 1) * 0.5;
    for (let i = 0; i < total; i++) {
        const x = i % nx;
        const y = Math.floor(i / nx) % ny;
        const z = Math.floor(i / (nx * ny));
        dist[i] = (x - cx) ** 2 + (y - cy) ** 2 + (z - cz) ** 2;
        order[i] = i;
    }
    const sorted = Array.from(order).sort((a, b) => dist[a] - dist[b]);
    order.set(sorted);
    return order;
}

function allocateVolume(settings: GiSettings): ProbeVolume {
    const { gridX: nx, gridY: ny, gridZ: nz } = settings;
    const texels = nx * ny * nz * 4;
    const band = (): BandData => new Uint8Array(new ArrayBuffer(texels));
    const data: ProbeVolume['data'] = [band(), band(), band(), band()];
    // Neutral seed: zero irradiance, L1 bands at their signed midpoint. A probe
    // that has not been baked yet therefore contributes nothing rather than a
    // colour pop.
    for (let band = 1; band < 4; band++) data[band].fill(128);

    return {
        settings,
        nx,
        ny,
        nz,
        origin: new THREE.Vector3(),
        data,
        textures: [
            makeBandTexture(nx, ny, nz, data[0]),
            makeBandTexture(nx, ny, nz, data[1]),
            makeBandTexture(nx, ny, nz, data[2]),
            makeBandTexture(nx, ny, nz, data[3]),
        ],
        order: buildBakeOrder(nx, ny, nz),
        cursor: 0,
        baked: 0,
    };
}

// ---------------------------------------------------------------------------
// Bake
// ---------------------------------------------------------------------------

/**
 * Collect local lights near the volume as bounce donors.
 *
 * Every point light, spot light and decorative fill in the registry is already
 * a saturated candy colour placed next to something worth lighting, which makes
 * the registry the cheapest possible stand-in for "surfaces that bleed colour".
 * No extra authoring: a grove of luminous flowers registers fills today, and
 * they become the grove's bounce for free.
 */
function gatherDonors(volume: ProbeVolume): void {
    const c = cfg();
    const maxDonors = Math.max(0, Math.floor(c.maxDonors));
    const halfX = (volume.nx - 1) * 0.5 * volume.settings.cellSize;
    const halfY = (volume.ny - 1) * 0.5 * volume.settings.cellSize;
    const halfZ = (volume.nz - 1) * 0.5 * volume.settings.cellSize;
    const cx = volume.origin.x + halfX;
    const cy = volume.origin.y + halfY;
    const cz = volume.origin.z + halfZ;

    _donorCount = 0;
    forEachLocalLight((snap) => {
        if (_donorCount >= maxDonors) return;
        if (snap.intensity <= 0) return;

        if (snap.parent) {
            snap.parent.updateMatrixWorld();
            if (snap.gpu) {
                _scratchDonorPos.setFromMatrixPosition(snap.parent.matrixWorld);
            } else {
                _scratchDonorPos.set(snap.localX, snap.localY, snap.localZ);
                _scratchDonorPos.applyMatrix4(snap.parent.matrixWorld);
            }
        } else {
            _scratchDonorPos.set(0, 0, 0);
        }

        const reach = Math.max(0.5, (snap.distance || 10) * c.donorRadiusScale);
        // Cheap volume-vs-sphere reject: only donors that can reach a probe.
        if (Math.abs(_scratchDonorPos.x - cx) > halfX + reach) return;
        if (Math.abs(_scratchDonorPos.y - cy) > halfY + reach) return;
        if (Math.abs(_scratchDonorPos.z - cz) > halfZ + reach) return;

        let donor = _donors[_donorCount];
        if (!donor) {
            donor = { x: 0, y: 0, z: 0, r: 0, g: 0, b: 0, reach: 0, reachSq: 0, intensity: 0 };
            _donors[_donorCount] = donor;
        }
        donor.x = _scratchDonorPos.x;
        donor.y = _scratchDonorPos.y;
        donor.z = _scratchDonorPos.z;
        donor.r = ((snap.color >> 16) & 255) / 255;
        donor.g = ((snap.color >> 8) & 255) / 255;
        donor.b = (snap.color & 255) / 255;
        donor.reach = reach;
        donor.reachSq = reach * reach;
        donor.intensity = snap.intensity;
        _donorCount += 1;
    });
}

/** Accumulate one directional sample into the scratch SH L1 bands. */
function addSample(
    r: number,
    g: number,
    b: number,
    dx: number,
    dy: number,
    dz: number,
    weight: number
): void {
    const wr = r * weight;
    const wg = g * weight;
    const wb = b * weight;
    _sh[0] += wr;
    _sh[1] += wg;
    _sh[2] += wb;
    _sh[3] += wr * dx;
    _sh[4] += wg * dx;
    _sh[5] += wb * dx;
    _sh[6] += wr * dy;
    _sh[7] += wg * dy;
    _sh[8] += wb * dy;
    _sh[9] += wr * dz;
    _sh[10] += wg * dz;
    _sh[11] += wb * dz;
}

/**
 * Pull the baked irradiance back toward a pastel.
 *
 * Summing several tinted sources drifts toward white/grey, which is the one
 * thing this effect must not do. Magnitude is preserved (it carries the
 * energy); only the chroma is re-saturated, and the same correction is applied
 * to the L1 bands so the directional bleed keeps the tint of the flat term.
 */
function applyPastelGuard(): void {
    const c = cfg();
    const bias = THREE.MathUtils.clamp(c.pastelBias, 0, 1);
    if (bias <= 0) return;

    const r = _sh[0];
    const g = _sh[1];
    const b = _sh[2];
    const mag = Math.max(r, g, b);
    if (mag <= 1e-4) return;

    _scratchColor.setRGB(r / mag, g / mag, b / mag);
    _scratchColor.getHSL(_scratchHsl);
    const targetS = Math.max(_scratchHsl.s, THREE.MathUtils.clamp(c.pastelSaturation, 0, 1));
    _scratchColor.setHSL(
        _scratchHsl.h,
        THREE.MathUtils.lerp(_scratchHsl.s, targetS, bias),
        _scratchHsl.l
    );

    // Per-channel ratio between the pastel-corrected colour and the raw one.
    const kr = r > 1e-5 ? (_scratchColor.r * mag) / r : 1;
    const kg = g > 1e-5 ? (_scratchColor.g * mag) / g : 1;
    const kb = b > 1e-5 ? (_scratchColor.b * mag) / b : 1;
    for (let band = 0; band < 4; band++) {
        _sh[band * 3 + 0] *= kr;
        _sh[band * 3 + 1] *= kg;
        _sh[band * 3 + 2] *= kb;
    }
}

/**
 * Bake one probe into `_sh` and return its sky visibility.
 *
 * Three analytic sources, no rays: sky openness from the terrain height at the
 * probe, a ground bounce arriving from below, and every nearby donor. Cheap
 * enough that the whole volume refreshes a few dozen probes per frame.
 */
function bakeProbe(px: number, py: number, pz: number): number {
    const c = cfg();
    _sh.fill(0);

    const groundY = _sampleGround(px, pz);
    const above = py - groundY;
    // Below the terrain (sugar caves) openness is 0; a couple of units above it
    // has already opened up. The band is soft so cave mouths blend.
    const skyVis = THREE.MathUtils.clamp(THREE.MathUtils.smoothstep(above, -1.5, 5.0), 0, 1);
    const interior = 1 - skyVis;

    // 1. Sky — the overhead pastel, gated by openness.
    addSample(
        _env.sky.r * c.skyStrength,
        _env.sky.g * c.skyStrength,
        _env.sky.b * c.skyStrength,
        0,
        1,
        0,
        skyVis
    );

    // 2. Ground bounce — sun landing on pale-mint terrain and coming back up.
    //    This is the term that tints the underside of every cap and canopy.
    const groundAlbedo = _scratchColor.setHex(c.groundAlbedo);
    const bounceFalloff = 1 / (1 + Math.max(0, above) / Math.max(0.5, c.groundFalloff));
    const sunOnGround = Math.max(0, _env.sunDirection.y) * _env.sunIntensity;
    const bounce = c.groundBounce * bounceFalloff * skyVis;
    if (bounce > 1e-4) {
        addSample(
            groundAlbedo.r * (_env.sun.r * sunOnGround + _env.ground.r),
            groundAlbedo.g * (_env.sun.g * sunOnGround + _env.ground.g),
            groundAlbedo.b * (_env.sun.b * sunOnGround + _env.ground.b),
            0,
            -1,
            0,
            bounce
        );
    }

    // 3. Donors — registered local lights read as coloured bouncing surfaces.
    for (let i = 0; i < _donorCount; i++) {
        const d = _donors[i];
        const dx = d.x - px;
        const dy = d.y - py;
        const dz = d.z - pz;
        const distSq = dx * dx + dy * dy + dz * dz;
        if (distSq >= d.reachSq) continue;
        const dist = Math.sqrt(distSq) || 1e-4;
        // Smooth window rather than inverse-square: bounce is a soft wash, and
        // a 1/r² spike next to a probe would alias badly at this grid density.
        const t = 1 - distSq / d.reachSq;
        const atten = t * t * d.intensity * c.donorStrength;
        addSample(d.r, d.g, d.b, dx / dist, dy / dist, dz / dist, atten);
    }

    // 4. Interior fill — sugar caves read dim and icy, never black.
    if (interior > 1e-3 && c.caveFillStrength > 0) {
        const fill = _scratchColor.setHex(c.caveFill);
        const w = interior * c.caveFillStrength;
        addSample(fill.r, fill.g, fill.b, 0, 0, 0, w);
    }

    applyPastelGuard();
    return skyVis;
}

/** Write the scratch SH bands into the encoded texture data for one probe. */
function writeProbe(volume: ProbeVolume, index: number, skyVis: number): void {
    const range = Math.max(1e-3, cfg().range);
    const o = index * 4;

    volume.data[0][o + 0] = encodeUnsigned(_sh[0], range);
    volume.data[0][o + 1] = encodeUnsigned(_sh[1], range);
    volume.data[0][o + 2] = encodeUnsigned(_sh[2], range);
    volume.data[0][o + 3] = Math.round(THREE.MathUtils.clamp(skyVis, 0, 1) * 255);

    for (let band = 1; band < 4; band++) {
        const base = band * 3;
        volume.data[band][o + 0] = encodeSigned(_sh[base + 0], range);
        volume.data[band][o + 1] = encodeSigned(_sh[base + 1], range);
        volume.data[band][o + 2] = encodeSigned(_sh[base + 2], range);
        volume.data[band][o + 3] = 255;
    }
}

function encodeUnsigned(v: number, range: number): number {
    return Math.round(THREE.MathUtils.clamp(v / range, 0, 1) * 255);
}

function encodeSigned(v: number, range: number): number {
    return Math.round(THREE.MathUtils.clamp(v / (2 * range) + 0.5, 0, 1) * 255);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Allocate the probe volume for this session.
 *
 * Must run before unified materials are built — `getIrradianceNode()` returns
 * null once the volume is absent, and a material compiled without the term can
 * never gain it. Safe to call twice (the second call is a no-op).
 *
 * @param sampleGround terrain height at a world XZ — drives sky openness and
 *                     the ground-bounce falloff.
 */
export function initIrradianceProbes(scene: THREE.Scene, sampleGround: GroundSampler): boolean {
    _scene = scene;
    _sampleGround = sampleGround;
    if (_volume) return true;

    const settings = resolveGiSettings();
    if (!settings.enabled) {
        _enabled = false;
        publishBreadcrumb();
        note('irradiance probes skipped (low tier / CI / ?gi=off).');
        return false;
    }

    _volume = allocateVolume(settings);
    _enabled = true;

    const c = cfg();
    uGiIntensity.value = c.intensity;
    uGiDirectionality.value = c.directionality;
    uGiRange.value = Math.max(1e-3, c.range);
    uGiEdgeFade.value = Math.max(1e-3, c.edgeFade);
    // Seeded from the volume centre so the first frame samples inside the box
    // even if `updateIrradianceProbes()` has not run yet.
    recentreVolume(new THREE.Vector3(0, 0, 0), true);

    const probes = settings.gridX * settings.gridY * settings.gridZ;
    note(
        `irradiance probes ${settings.gridX}×${settings.gridY}×${settings.gridZ} ` +
            `(${probes} probes, ${settings.cellSize}u spacing, ` +
            `${settings.probesPerFrame}/frame → full refresh every ` +
            `${Math.ceil(probes / settings.probesPerFrame)} frames)`
    );
    publishBreadcrumb();
    return true;
}

/** Snap the volume so `centre` sits in the middle, on cell boundaries. */
function recentreVolume(centre: THREE.Vector3, force: boolean): boolean {
    if (!_volume) return false;
    const cell = _volume.settings.cellSize;
    const halfX = (_volume.nx - 1) * 0.5 * cell;
    const halfY = (_volume.ny - 1) * 0.5 * cell;
    const halfZ = (_volume.nz - 1) * 0.5 * cell;

    const ox = Math.round((centre.x - halfX) / cell) * cell;
    const oy = Math.round((centre.y - halfY) / cell) * cell;
    const oz = Math.round((centre.z - halfZ) / cell) * cell;

    if (!force && ox === _volume.origin.x && oy === _volume.origin.y && oz === _volume.origin.z) {
        return false;
    }

    _volume.origin.set(ox, oy, oz);
    // Probe 0 sits at the centre of the first texel, so the sampling box starts
    // half a cell earlier — that is what makes trilinear line up with probes.
    uGiOrigin.value.set(ox - cell * 0.5, oy - cell * 0.5, oz - cell * 0.5);
    uGiInvSize.value.set(1 / (_volume.nx * cell), 1 / (_volume.ny * cell), 1 / (_volume.nz * cell));

    // The volume moved: every probe now stands somewhere else. Restart the bake
    // walk from the camera outwards rather than wherever it happened to be.
    _volume.cursor = 0;
    _volume.baked = 0;
    return true;
}

/**
 * Per-frame bake slice. Cheap by construction: `probesPerFrame` probes, each a
 * handful of arithmetic terms plus one ground-height query.
 *
 * @param centre world position the volume should follow (the camera).
 * @param env    current sky / sun state, so the bake tracks the day cycle.
 */
export function updateIrradianceProbes(centre: THREE.Vector3, env: Partial<GiEnvironment>): void {
    if (!_volume || !_enabled) return;

    if (env.sky) _env.sky.copy(env.sky);
    if (env.ground) _env.ground.copy(env.ground);
    if (env.sun) _env.sun.copy(env.sun);
    if (typeof env.sunIntensity === 'number') _env.sunIntensity = env.sunIntensity;
    if (env.sunDirection) _env.sunDirection.copy(env.sunDirection).normalize();

    recentreVolume(centre, false);
    gatherDonors(_volume);

    const cell = _volume.settings.cellSize;
    const total = _volume.order.length;
    const budget = Math.min(_volume.settings.probesPerFrame, total);

    for (let n = 0; n < budget; n++) {
        const index = _volume.order[_volume.cursor];
        _volume.cursor = (_volume.cursor + 1) % total;

        const x = index % _volume.nx;
        const y = Math.floor(index / _volume.nx) % _volume.ny;
        const z = Math.floor(index / (_volume.nx * _volume.ny));

        const px = _volume.origin.x + x * cell;
        const py = _volume.origin.y + y * cell;
        const pz = _volume.origin.z + z * cell;

        const skyVis = bakeProbe(px, py, pz);
        writeProbe(_volume, index, skyVis);
    }

    if (_volume.baked < total) _volume.baked = Math.min(total, _volume.baked + budget);

    for (let band = 0; band < 4; band++) _volume.textures[band].needsUpdate = true;

    // Refresh the debug breadcrumb about once a second rather than every frame.
    _breadcrumbTick = (_breadcrumbTick + 1) % 60;
    if (_breadcrumbTick === 0) publishBreadcrumb();

    updateProbeDebug();
}

/**
 * The irradiance term for a surface, or null when GI is off this session.
 *
 * Returns *irradiance*, not final colour: callers multiply by albedo so the
 * bounce stays a tint on the material rather than a wash over it.
 */
export function getIrradianceNode(worldPos: Node, worldNormal: Node): Node | null {
    if (!_volume || !_enabled) return null;

    const uvw = vec3(worldPos).sub(uGiOrigin).mul(uGiInvSize);

    // Distance to the nearest face of the unit box, in normalised units.
    // Negative outside the box, which smoothstep turns into a hard zero.
    const toEdge = min(min(uvw.x, uvw.y), uvw.z);
    const toFarEdge = min(min(float(1).sub(uvw.x), float(1).sub(uvw.y)), float(1).sub(uvw.z));
    const fade = smoothstep(float(0), uGiEdgeFade, min(toEdge, toFarEdge));

    const clamped = clamp(uvw, vec3(0), vec3(1));
    const band0 = texture3D(_volume.textures[0], clamped);
    const band1 = texture3D(_volume.textures[1], clamped);
    const band2 = texture3D(_volume.textures[2], clamped);
    const band3 = texture3D(_volume.textures[3], clamped);

    const l0 = band0.rgb.mul(uGiRange);
    const decodeSigned = (b: typeof band1) => b.rgb.sub(0.5).mul(uGiRange.mul(2));
    const l1x = decodeSigned(band1);
    const l1y = decodeSigned(band2);
    const l1z = decodeSigned(band3);

    const n = vec3(worldNormal);
    const directional = l1x.mul(n.x).add(l1y.mul(n.y)).add(l1z.mul(n.z));
    const irradiance = max(l0.add(directional.mul(uGiDirectionality)), vec3(0));

    return irradiance.mul(uGiIntensity).mul(fade);
}

/**
 * Runtime on/off. Setting the gain to zero removes the term exactly — the
 * shader still samples, but every material lands back on its pre-GI look.
 */
export function setIrradianceEnabled(enabled: boolean): void {
    if (!_volume) return;
    _enabled = enabled;
    uGiIntensity.value = enabled ? cfg().intensity : 0;
    if (_debugMesh) _debugMesh.visible = enabled && probeDebugRequested();
    publishBreadcrumb();
}

export function isIrradianceEnabled(): boolean {
    return _enabled && _volume !== null;
}

export interface GiStats {
    enabled: boolean;
    probes: number;
    gridX: number;
    gridY: number;
    gridZ: number;
    cellSize: number;
    probesPerFrame: number;
    /** Probes baked since the volume last moved. */
    baked: number;
    donors: number;
}

export function getIrradianceStats(): GiStats {
    if (!_volume) {
        return {
            enabled: false,
            probes: 0,
            gridX: 0,
            gridY: 0,
            gridZ: 0,
            cellSize: 0,
            probesPerFrame: 0,
            baked: 0,
            donors: 0,
        };
    }
    return {
        enabled: _enabled,
        probes: _volume.order.length,
        gridX: _volume.nx,
        gridY: _volume.ny,
        gridZ: _volume.nz,
        cellSize: _volume.settings.cellSize,
        probesPerFrame: _volume.settings.probesPerFrame,
        baked: _volume.baked,
        donors: _donorCount,
    };
}

function publishBreadcrumb(): void {
    if (typeof window === 'undefined') return;
    (window as Window & { __candyGI?: GiStats }).__candyGI = getIrradianceStats();
}

export function disposeIrradianceProbes(): void {
    if (_debugMesh) {
        _debugMesh.removeFromParent();
        _debugMesh.geometry.dispose();
        (_debugMesh.material as THREE.Material).dispose();
        _debugMesh = null;
    }
    if (_volume) {
        for (const tex of _volume.textures) tex.dispose();
        _volume = null;
    }
    _enabled = false;
    _donorCount = 0;
    publishBreadcrumb();
}

// --- Debug overlay (?debug=1 / ?gi=debug) ------------------------------------

/**
 * One small sphere per probe, tinted by that probe's flat (L0) band, so the
 * volume's placement and its colour bleed are both visible at a glance.
 */
export function attachProbeDebug(scene: THREE.Scene): void {
    if (!_volume || _debugMesh || !probeDebugRequested()) return;

    const geo = new THREE.SphereGeometry(0.28, 8, 6);
    const mat = new THREE.MeshBasicMaterial({ toneMapped: false });
    const mesh = new THREE.InstancedMesh(geo, mat, _volume.order.length);
    mesh.frustumCulled = false;
    mesh.userData.skipDispose = true;
    mesh.instanceColor = new THREE.InstancedBufferAttribute(
        new Float32Array(_volume.order.length * 3),
        3
    );
    scene.add(mesh);
    _debugMesh = mesh;
    note(`probe gizmos on — ${_volume.order.length} probes.`);
}

const _scratchMatrix = new THREE.Matrix4();

function updateProbeDebug(): void {
    if (!_debugMesh || !_volume) return;
    const range = Math.max(1e-3, cfg().range);
    const cell = _volume.settings.cellSize;

    for (let index = 0; index < _volume.order.length; index++) {
        const x = index % _volume.nx;
        const y = Math.floor(index / _volume.nx) % _volume.ny;
        const z = Math.floor(index / (_volume.nx * _volume.ny));
        _scratchProbePos.set(
            _volume.origin.x + x * cell,
            _volume.origin.y + y * cell,
            _volume.origin.z + z * cell
        );
        _scratchMatrix.makeTranslation(_scratchProbePos.x, _scratchProbePos.y, _scratchProbePos.z);
        _debugMesh.setMatrixAt(index, _scratchMatrix);

        const o = index * 4;
        // Normalised back out of the encoding, then scaled so a dim probe is
        // still legible against the sky.
        _debugMesh.setColorAt(
            index,
            _scratchColor.setRGB(
                (_volume.data[0][o] / 255) * range,
                (_volume.data[0][o + 1] / 255) * range,
                (_volume.data[0][o + 2] / 255) * range
            )
        );
    }
    _debugMesh.instanceMatrix.needsUpdate = true;
    if (_debugMesh.instanceColor) _debugMesh.instanceColor.needsUpdate = true;
}

/**
 * @internal test seam — decode one probe's flat (L0) band back to linear
 * irradiance. Returns that probe's sky visibility. Mirrors the shader's decode.
 */
export function __readProbeL0(index: number, out: THREE.Color): number {
    if (!_volume || index < 0 || index >= _volume.order.length) {
        out.setRGB(0, 0, 0);
        return 0;
    }
    const range = Math.max(1e-3, cfg().range);
    const o = index * 4;
    out.setRGB(
        (_volume.data[0][o] / 255) * range,
        (_volume.data[0][o + 1] / 255) * range,
        (_volume.data[0][o + 2] / 255) * range
    );
    return _volume.data[0][o + 3] / 255;
}

/** @internal test seam — world position of a probe by flat index. */
export function __probeWorldPosition(index: number, out: THREE.Vector3): THREE.Vector3 {
    if (!_volume) return out.set(0, 0, 0);
    const cell = _volume.settings.cellSize;
    const x = index % _volume.nx;
    const y = Math.floor(index / _volume.nx) % _volume.ny;
    const z = Math.floor(index / (_volume.nx * _volume.ny));
    return out.set(
        _volume.origin.x + x * cell,
        _volume.origin.y + y * cell,
        _volume.origin.z + z * cell
    );
}

/** @internal test seam — drops the volume so a suite can re-resolve settings. */
export function __resetIrradianceProbesForTests(): void {
    disposeIrradianceProbes();
    _scene = null;
    _sampleGround = () => 0;
}

/** @internal test seam — the scene the volume is bound to, if any. */
export function __getIrradianceScene(): THREE.Scene | null {
    return _scene;
}
