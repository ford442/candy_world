/**
 * The player's HDR output preference, readable before the renderer exists.
 *
 * The boot probe decides the swap-chain format once (`rgba16float` +
 * `toneMapping: { mode: 'extended' }`, or the 8-bit preferred format), so the
 * mode has to be known before `probeWebGPU()` runs, long before the lazy
 * accessibility menu that edits it has loaded. It is stored on its own
 * (`localStorage candy.hdr`) rather than in the accessibility settings blob,
 * and lives in `core/platform/` (a leaf chunk) so boot can read it.
 *
 * - `mode`: `auto` (extended range whenever the display reports
 *   `(dynamic-range: high)` and the browser configures it) or `off` (always
 *   the SDR swap chain). A change applies on the next load: the canvas format
 *   and every pipeline that targets it are fixed at boot.
 * - `peak`: highlight ceiling as a multiple of SDR white. Applied live through
 *   {@link onHdrPeakChange}; the post graph rolls highlights off toward it.
 *
 * URL overrides for testing: `?hdr=off|auto`, `?hdrPeak=<1..8>`.
 *
 * See docs/WEBGPU_CONTEXT.md#hdr-output.
 */

export type HdrMode = 'auto' | 'off';

export interface HdrPreference {
    readonly mode: HdrMode;
    /** Highlight ceiling, in multiples of SDR white (1.0). */
    readonly peak: number;
}

export const HDR_STORAGE_KEY = 'candy.hdr';

/** Range of the peak slider. 1 is SDR white; 4 is roughly 800 nits on a 200-nit white. */
export const HDR_PEAK_MIN = 1;
export const HDR_PEAK_MAX = 8;
export const HDR_PEAK_DEFAULT = 4;

/** Fraction of the peak below which the post graph leaves colour untouched. */
export const HDR_ROLLOFF_KNEE = 0.75;

export const DEFAULT_HDR_PREFERENCE: HdrPreference = Object.freeze({
    mode: 'auto',
    peak: HDR_PEAK_DEFAULT,
});

export function isHdrMode(value: unknown): value is HdrMode {
    return value === 'auto' || value === 'off';
}

export function clampHdrPeak(value: unknown): number {
    const n = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(n)) return HDR_PEAK_DEFAULT;
    return Math.min(HDR_PEAK_MAX, Math.max(HDR_PEAK_MIN, n));
}

function readStored(): Partial<HdrPreference> {
    try {
        const raw = window.localStorage.getItem(HDR_STORAGE_KEY);
        if (!raw) return {};
        const parsed = JSON.parse(raw) as { mode?: unknown; peak?: unknown };
        return {
            ...(isHdrMode(parsed.mode) ? { mode: parsed.mode } : {}),
            ...(parsed.peak !== undefined ? { peak: clampHdrPeak(parsed.peak) } : {}),
        };
    } catch {
        return {};
    }
}

function readSearch(search: string | undefined): Partial<HdrPreference> {
    let params: URLSearchParams;
    try {
        params = new URLSearchParams(search ?? window.location.search);
    } catch {
        return {};
    }
    const out: { mode?: HdrMode; peak?: number } = {};
    const mode = params.get('hdr')?.toLowerCase();
    if (mode === 'off' || mode === '0' || mode === 'false') out.mode = 'off';
    else if (mode === 'auto' || mode === 'on' || mode === '1') out.mode = 'auto';
    const peak = params.get('hdrPeak');
    if (peak !== null) out.peak = clampHdrPeak(peak);
    return out;
}

/** Stored preference, with `?hdr=` / `?hdrPeak=` on top. Never throws. */
export function readHdrPreference(search?: string): HdrPreference {
    return { ...DEFAULT_HDR_PREFERENCE, ...readStored(), ...readSearch(search) };
}

const peakListeners = new Set<(peak: number) => void>();

/**
 * Persist a change. A new `peak` reaches {@link onHdrPeakChange} listeners at
 * once; a new `mode` only takes effect on the next load.
 */
export function writeHdrPreference(change: Partial<HdrPreference>): HdrPreference {
    const next: HdrPreference = {
        ...DEFAULT_HDR_PREFERENCE,
        ...readStored(),
        ...(isHdrMode(change.mode) ? { mode: change.mode } : {}),
        ...(change.peak !== undefined ? { peak: clampHdrPeak(change.peak) } : {}),
    };
    try {
        window.localStorage.setItem(HDR_STORAGE_KEY, JSON.stringify(next));
    } catch {
        // Storage may be disabled; the live peak still applies for this session.
    }
    if (change.peak !== undefined) {
        for (const listener of peakListeners) {
            try {
                listener(next.peak);
            } catch (err) {
                console.warn('[HDR] peak listener threw:', err);
            }
        }
    }
    return next;
}

/** Subscribe to live peak changes. Returns an unsubscribe function. */
export function onHdrPeakChange(listener: (peak: number) => void): () => void {
    peakListeners.add(listener);
    return () => peakListeners.delete(listener);
}

/**
 * Highlight roll-off on the brightest channel, the CPU twin of the TSL node in
 * `src/foliage/hdr-nodes.ts`. Identity up to `knee * peak`, then an
 * exponential shoulder that meets the identity with slope 1 and approaches
 * `peak` asymptotically. Scaling all channels by the same factor keeps hue.
 */
export function hdrRolloff(value: number, peak: number, knee = HDR_ROLLOFF_KNEE): number {
    const k = peak * knee;
    if (value <= k) return value;
    const span = peak - k;
    if (span <= 0) return peak;
    return k + span * (1 - Math.exp(-(value - k) / span));
}

/** @internal tests */
export function __resetHdrPreferenceForTests(): void {
    peakListeners.clear();
}
