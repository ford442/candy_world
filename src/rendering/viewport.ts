/**
 * The one owner of canvas size, pixel ratio and camera aspect.
 *
 * Before this, `init.ts` and both post-processing graphs each added their own
 * `window` resize listener, and the pixel ratio was set once at boot, so
 * dragging the window to a monitor with a different `devicePixelRatio` kept
 * the old one. Now a single listener resizes the renderer, re-applies the
 * tier-scaled pixel ratio and fans out to subscribers (post-FX), and a
 * `matchMedia('(resolution: Ndppx)')` watch re-runs it when the DPR changes.
 *
 * The canvas lives directly in `<body>`, whose height is its content, so there
 * is no viewport-sized container a `ResizeObserver` could watch: it would miss
 * height-only window resizes. The window is the size source, as it always was.
 */

export interface ViewportRenderer {
    setSize(width: number, height: number, updateStyle?: boolean): void;
    setPixelRatio(ratio: number): void;
    getPixelRatio(): number;
}

export interface ViewportCamera {
    aspect: number;
    updateProjectionMatrix(): void;
}

export type ViewportListener = (width: number, height: number, pixelRatio: number) => void;

/** Pure: the pixel ratio to render at for this DPR and cap. */
export function resolvePixelRatio(devicePixelRatio: number, maxPixelRatio: number): number {
    const dpr = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1;
    return Math.min(dpr, maxPixelRatio);
}

/** The media query that stops matching when the window's DPR changes. */
export function devicePixelRatioQuery(devicePixelRatio: number): string {
    return `(resolution: ${devicePixelRatio}dppx)`;
}

interface ViewportState {
    renderer: ViewportRenderer;
    camera: ViewportCamera;
    maxPixelRatio: number;
}

let state: ViewportState | null = null;
let dprQuery: MediaQueryList | null = null;
/** The DPR `dprQuery` was built for. */
let watchedDpr = 0;
const listeners = new Set<ViewportListener>();

function watchDevicePixelRatio(): void {
    dprQuery?.removeEventListener('change', onDevicePixelRatioChange);
    dprQuery = null;
    if (typeof window.matchMedia !== 'function') return;
    // A query for the *current* DPR fires `change` once, when it stops
    // matching; re-arm for the new value each time.
    watchedDpr = window.devicePixelRatio;
    dprQuery = window.matchMedia(devicePixelRatioQuery(watchedDpr));
    dprQuery.addEventListener('change', onDevicePixelRatioChange);
}

function onDevicePixelRatioChange(): void {
    watchDevicePixelRatio();
    syncViewport();
}

/**
 * Size the renderer and camera to the window and start tracking it. Called
 * once from `initScene()`; a second call replaces the targets.
 */
export function installViewport(
    renderer: ViewportRenderer,
    camera: ViewportCamera,
    maxPixelRatio: number
): void {
    const first = state === null;
    state = { renderer, camera, maxPixelRatio };
    if (first) {
        window.addEventListener('resize', syncViewport);
        watchDevicePixelRatio();
    }
    syncViewport();
}

/** Apply the current window size and DPR now. Safe before `installViewport` (no-op). */
export function syncViewport(): void {
    if (!state) return;
    const { renderer, camera, maxPixelRatio } = state;
    const width = window.innerWidth;
    const height = window.innerHeight;
    const ratio = resolvePixelRatio(window.devicePixelRatio, maxPixelRatio);
    // Belt and braces for the media query: a zoom always fires `resize`, so
    // re-arm here too if the DPR moved without a `change` event.
    if (window.devicePixelRatio !== watchedDpr) watchDevicePixelRatio();

    if (renderer.getPixelRatio() !== ratio) renderer.setPixelRatio(ratio);
    renderer.setSize(width, height);
    if (height > 0) {
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
    }

    for (const listener of listeners) {
        try {
            listener(width, height, ratio);
        } catch (err) {
            console.warn('[Viewport] Resize listener threw:', err);
        }
    }
}

/** Run `listener` after every resize / DPR change. Returns an unsubscribe function. */
export function onViewportResize(listener: ViewportListener): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

/** @internal tests */
export function __resetViewportForTests(): void {
    if (state && typeof window !== 'undefined') {
        window.removeEventListener('resize', syncViewport);
    }
    dprQuery?.removeEventListener('change', onDevicePixelRatioChange);
    dprQuery = null;
    watchedDpr = 0;
    state = null;
    listeners.clear();
}
