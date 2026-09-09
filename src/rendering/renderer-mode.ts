/**
 * Renderer backend selection for Candy World.
 *
 * **This phase: WebGPU is the only backend.** `resolveRendererBackend()` always
 * returns `webgpu`, and a failed WebGPU boot probe hard-fails instead of
 * starting a WebGL renderer — a silent GL render is what hid the Chrome-vs-Edge
 * adapter failure we are trying to surface.
 *
 * The WebGL selection inputs below are therefore **inert**, kept so the restore
 * wave can re-enable them in one place rather than re-deriving them:
 *   - `?renderer=webgl` / `?renderer=webgl2` / `?webgl` — warn, then ignored
 *   - `?webglLite=1` / `?lite` — no longer imply a WebGL boot; `?lite` still
 *     only trims world density (see `shouldPreferLightWorldLoad()`)
 *   - `localStorage candy.renderer` — ignored while the phase is active
 *
 * @see docs/WEBGPU_CONTEXT.md
 */

export type RendererBackend = 'webgpu' | 'webgl';

export const RENDERER_STORAGE_KEY = 'candy.renderer';

export function isRendererBackend(value: string): value is RendererBackend {
    return value === 'webgl' || value === 'webgpu';
}

export function getStoredRendererPreference(): RendererBackend | null {
    try {
        const value = window.localStorage.getItem(RENDERER_STORAGE_KEY);
        return value != null && isRendererBackend(value) ? value : null;
    } catch {
        return null;
    }
}

export function setStoredRendererPreference(backend: RendererBackend): void {
    try {
        window.localStorage.setItem(RENDERER_STORAGE_KEY, backend);
    } catch {
        // Storage may be disabled in hardened test browsers.
    }
}

/** True while WebGPU is the only backend that may boot the world. */
export const WEBGPU_REQUIRED = true;

export function resolveRendererBackend(search: string = window.location.search): RendererBackend {
    let params: URLSearchParams;
    try {
        params = new URLSearchParams(search);
    } catch {
        return 'webgpu';
    }

    const explicit = params.get('renderer')?.toLowerCase();
    const askedForWebGL =
        explicit === 'webgl' ||
        explicit === 'webgl2' ||
        params.has('webgl') ||
        params.has('webglLite');

    if (askedForWebGL || getStoredRendererPreference() === 'webgl') {
        console.warn(
            '[RendererMode] WebGL selection is disabled this phase — WebGPU is required to enter the ' +
                'world, and a failed probe hard-fails rather than booting WebGL. See docs/WEBGPU_CONTEXT.md.'
        );
    }

    // Always force WebGPU resolution for the current probe phase.
    return 'webgpu';
}

export function publishRendererBreadcrumbs(
    backend: RendererBackend,
    activeBackend: RendererBackend,
    fallbackReason: string | null = null
): void {
    const canvas = document.querySelector('#glCanvas') as HTMLCanvasElement | null;
    const target = window as Window & {
        rendererType?: RendererBackend;
        currentRenderer?: RendererBackend;
        usingWebGPU?: boolean;
        usingWebGL?: boolean;
        rendererFallbackReason?: string | null;
        setRenderer?: (backend: RendererBackend) => void;
    };

    target.rendererType = activeBackend;
    target.currentRenderer = activeBackend;
    target.usingWebGPU = activeBackend === 'webgpu';
    target.usingWebGL = activeBackend === 'webgl';
    target.rendererFallbackReason = fallbackReason;

    if (canvas) {
        canvas.dataset.renderer = activeBackend;
        canvas.dataset.webglVersion = activeBackend === 'webgl' ? '2' : '';
        canvas.dataset.rendererRequested = backend;
    }
}

export function switchRendererPreference(backend: RendererBackend): void {
    if (backend === 'webgl' && WEBGPU_REQUIRED) {
        // Reloading into a preference the boot path ignores would look like a
        // no-op bug from the debug panel. Refuse it out loud instead.
        console.warn(
            '[RendererMode] Cannot switch to WebGL this phase — WebGPU is required to enter the world.'
        );
        return;
    }
    setStoredRendererPreference(backend);
    const url = new URL(window.location.href);
    url.searchParams.set('renderer', backend);
    window.location.assign(url.toString());
}

export function installRendererHotSwitch(): void {
    (window as Window & { setRenderer?: (backend: RendererBackend) => void }).setRenderer =
        switchRendererPreference;
}

export async function captureCanvasScreenshot(
    canvas: HTMLCanvasElement,
    rect?: { x?: number; y?: number; width?: number; height?: number }
): Promise<string> {
    const dataUrl = canvas.toDataURL('image/png');
    if (!rect) return dataUrl;

    const x = rect.x ?? 0;
    const y = rect.y ?? 0;
    const width = rect.width ?? canvas.width - x;
    const height = rect.height ?? canvas.height - y;

    if (x === 0 && y === 0 && width === canvas.width && height === canvas.height) {
        return dataUrl;
    }

    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
            const cropCanvas = document.createElement('canvas');
            cropCanvas.width = width;
            cropCanvas.height = height;
            const ctx = cropCanvas.getContext('2d');
            if (!ctx) {
                reject(new Error('2D canvas context unavailable for screenshot crop'));
                return;
            }
            ctx.drawImage(img, x, y, width, height, 0, 0, width, height);
            resolve(cropCanvas.toDataURL('image/png'));
        };
        img.onerror = () => reject(new Error('Failed to decode screenshot for cropping'));
        img.src = dataUrl;
    });
}
