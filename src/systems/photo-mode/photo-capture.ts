import * as THREE from 'three';
import { getWorldSeed } from '../../world/world-seed.ts';

export interface CaptureStamp {
    seed: number;
    x: number;
    y: number;
    z: number;
    preset?: string;
}

export interface CaptureOptions {
    renderer: THREE.WebGLRenderer | { domElement: HTMLCanvasElement; getSize: (target: THREE.Vector2) => THREE.Vector2; setSize: (w: number, h: number, updateStyle?: boolean) => void; getPixelRatio: () => number; setPixelRatio: (v: number) => void };
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

/**
 * Render one frame at upscaled resolution and export PNG.
 */
export async function capturePhotoPng(options: CaptureOptions): Promise<string> {
    const scale = Math.min(Math.max(options.scale ?? 2, 1), 3);
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
        let dataUrl = renderer.domElement.toDataURL('image/png');

        const stamp: CaptureStamp = options.stamp ?? {
            seed: getWorldSeed(),
            x: 0,
            y: 0,
            z: 0,
        };

        if (options.watermark !== false) {
            dataUrl = await compositeStamp(dataUrl, stamp, true);
        }

        const filename =
            options.filename ??
            `candy-world-${stamp.seed}-${Date.now()}.png`;
        downloadDataUrl(dataUrl, filename);
        return dataUrl;
    } finally {
        renderer.setPixelRatio(prevRatio);
        renderer.setSize(prevSize.x, prevSize.y, false);
    }
}
