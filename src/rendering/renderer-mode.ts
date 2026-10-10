/**
 * Renderer backend selection for Candy World.
 *
 * WebGPU is the default. When it cannot be brought up — `navigator.gpu` is
 * missing, `requestAdapter()` resolves null, or any later probe stage fails —
 * `createRenderer()` boots `WebGPURenderer({ forceWebGL: true })` (Three's GLSL
 * node backend on WebGL2) instead of hard-failing. The fallback is never
 * silent: the renderer badge, `window.rendererFallbackReason` and
 * `window.webgpuProbe` all name it. See docs/WEBGPU_CONTEXT.md.
 *
 * Explicit WebGL2 selection (first match wins):
 *   - `?renderer=webgl` / `?renderer=webgl2` / `?webgl` / `?webglLite=1`
 *   - `?renderer=webgpu` — prefer WebGPU (still falls back if unavailable)
 *   - `localStorage candy.renderer` — persisted by `window.setRenderer()`
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

export function resolveRendererBackend(search: string = window.location.search): RendererBackend {
    let params: URLSearchParams;
    try {
        params = new URLSearchParams(search);
    } catch {
        return 'webgpu';
    }

    const explicit = params.get('renderer')?.toLowerCase();
    if (explicit === 'webgl' || explicit === 'webgl2') return 'webgl';
    if (explicit === 'webgpu') return 'webgpu';
    if (params.has('webgl') || params.has('webglLite')) return 'webgl';

    return getStoredRendererPreference() ?? 'webgpu';
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
