/**
 * Renderer backend selection for Candy World.
 *
 * Priority (first match wins):
 *   1. URL param  ?renderer=webgl|webgpu  (also accepts webgl2)
 *   2. localStorage candy.renderer
 *   3. default    webgpu (auto-falls back to WebGL when unavailable)
 */

export type RendererBackend = 'webgpu' | 'webgl';

export const RENDERER_STORAGE_KEY = 'candy.renderer';

export function isRendererBackend(value: string): value is RendererBackend {
  return value === 'webgl' || value === 'webgpu';
}

export function getStoredRendererPreference(): RendererBackend | null {
  try {
    const value = window.localStorage.getItem(RENDERER_STORAGE_KEY);
    return isRendererBackend(value) ? value : null;
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
  const params = new URLSearchParams(search);
  const explicit = params.get('renderer')?.toLowerCase();

  if (explicit === 'webgl' || explicit === 'webgl2' || params.has('webgl')) return 'webgl';
  if (explicit === 'webgpu' || params.has('webgpu')) return 'webgpu';

  return getStoredRendererPreference() ?? 'webgpu';
}

export function publishRendererBreadcrumbs(
  backend: RendererBackend,
  activeBackend: RendererBackend,
  fallbackReason: string | null = null,
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
  rect?: { x?: number; y?: number; width?: number; height?: number },
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
