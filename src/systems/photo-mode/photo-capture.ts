import * as THREE from 'three';

export interface CaptureStamp {
    seed: number;
    x: number;
    y: number;
    z: number;
    preset?: string;
}

export interface CaptureOptions {
    renderer:
        | THREE.WebGLRenderer
        | {
              domElement: HTMLCanvasElement;
              getSize: (target: THREE.Vector2) => THREE.Vector2;
              setSize: (w: number, h: number, updateStyle?: boolean) => void;
              getPixelRatio: () => number;
              setPixelRatio: (v: number) => void;
          };
    renderFrame: () => void;
    scale?: number;
    watermark?: boolean;
    stamp?: CaptureStamp;
    filename?: string;
}

function downloadDataUrl(dataUrl: string, filename: string): void {
    const link = document.createElement('a');
    link.href = dataUrl;
    link.download = filename;
    link.rel = 'noopener';
    document.body.appendChild(link);
    link.click();
    link.remove();
}

async function compositeStamp(
    sourceDataUrl: string,
    stamp: CaptureStamp,
    watermark: boolean
): Promise<string> {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const el = new Image();
        el.onload = () => resolve(el);
        el.onerror = reject;
        el.src = sourceDataUrl;
    });

    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return sourceDataUrl;

    ctx.drawImage(img, 0, 0);

    if (watermark) {
        const pad = Math.max(12, Math.floor(img.width * 0.012));
        const fontSize = Math.max(14, Math.floor(img.width * 0.014));
        ctx.font = `600 ${fontSize}px Inter, ui-sans-serif, system-ui, sans-serif`;
        ctx.textBaseline = 'bottom';
        ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
        ctx.strokeStyle = 'rgba(59, 16, 32, 0.55)';
        ctx.lineWidth = 3;

        const lines = [
            'Candy World',
            `seed ${stamp.seed}`,
            `x ${stamp.x.toFixed(1)}  y ${stamp.y.toFixed(1)}  z ${stamp.z.toFixed(1)}`,
        ];
        if (stamp.preset) lines.push(stamp.preset);

        let y = img.height - pad;
        for (let i = lines.length - 1; i >= 0; i--) {
            ctx.strokeText(lines[i], pad, y);
            ctx.fillText(lines[i], pad, y);
            y -= fontSize + 4;
        }
    }

    return canvas.toDataURL('image/png');
}

/** Render one frame at `scale`× the window and read it back as a PNG data URL. */
async function renderFrameDataUrl(options: CaptureOptions, scale: number): Promise<string> {
    const renderer = options.renderer;
    const prevSize = new THREE.Vector2();
    renderer.getSize(prevSize);
    const prevRatio = renderer.getPixelRatio();

    const width = Math.floor(window.innerWidth * scale);
    const height = Math.floor(window.innerHeight * scale);

    renderer.setPixelRatio(1);
    renderer.setSize(width, height, false);

    try {
        options.renderFrame();

        const backend = (
            renderer as {
                backend?: { device?: { queue?: { onSubmittedWorkDone?: () => Promise<void> } } };
            }
        ).backend;
        if (backend?.device?.queue?.onSubmittedWorkDone) {
            await backend.device.queue.onSubmittedWorkDone();
        }

        return renderer.domElement.toDataURL('image/png');
    } finally {
        renderer.setPixelRatio(prevRatio);
        renderer.setSize(prevSize.x, prevSize.y, false);
    }
}

/**
 * Render one frame at upscaled resolution and export PNG.
 */
export async function capturePhotoPng(options: CaptureOptions): Promise<string> {
    const scale = Math.min(Math.max(options.scale ?? 2, 1), 3);
    let dataUrl = await renderFrameDataUrl(options, scale);

    const stamp: CaptureStamp = options.stamp ?? {
        seed: 0,
        x: 0,
        y: 0,
        z: 0,
    };

    if (options.watermark !== false) {
        dataUrl = await compositeStamp(dataUrl, stamp, true);
    }

    const filename = options.filename ?? `candy-world-${stamp.seed}-${Date.now()}.png`;
    downloadDataUrl(dataUrl, filename);
    return dataUrl;
}

/**
 * Render one frame as a small JPEG (a shared world's thumbnail, #1975):
 * no watermark, no download, at most `maxWidth` pixels wide.
 */
export async function capturePhotoThumbnail(
    options: Pick<CaptureOptions, 'renderer' | 'renderFrame'>,
    maxWidth = 640
): Promise<Blob> {
    const source = await renderFrameDataUrl(options, 1);
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const el = new Image();
        el.onload = () => resolve(el);
        el.onerror = reject;
        el.src = source;
    });
    const width = Math.min(maxWidth, img.width);
    const height = Math.round((img.height / img.width) * width);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('No 2D canvas for the thumbnail');
    ctx.drawImage(img, 0, 0, width, height);
    return new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
            (blob) => (blob ? resolve(blob) : reject(new Error('Thumbnail encoding failed'))),
            'image/jpeg',
            0.85
        );
    });
}
