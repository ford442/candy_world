import * as THREE from 'three';
import { WebGPURenderer } from 'three/webgpu';

export interface WebGPULimits {
    maxStorageBufferBindingSize: number;
    maxComputeWorkgroupSizeX: number;
    maxVertexBuffers: number;
    maxVertexAttributes: number;
    maxBindGroups: number;
}

export class GPUContext {
    private static instance: GPUContext;

    private _device: GPUDevice | null = null;
    private _adapter: GPUAdapter | null = null;
    private _renderer: WebGPURenderer | null = null;
    private _limits: WebGPULimits | null = null;
    private _ready = false;
    private _initPromise: Promise<void> | null = null;

    private constructor() {}

    public static getInstance(): GPUContext {
        if (!GPUContext.instance) {
            GPUContext.instance = new GPUContext();
        }
        return GPUContext.instance;
    }

    public isReady(): boolean {
        return this._ready && this._device !== null;
    }

    public getDevice(): GPUDevice | null {
        return this._device;
    }

    public getAdapter(): GPUAdapter | null {
        return this._adapter;
    }

    public getRenderer(): WebGPURenderer | null {
        return this._renderer;
    }

    public getLimits(): WebGPULimits | null {
        return this._limits;
    }

    /**
     * Initializes the WebGPU context with a shared device via WebGPURenderer.
     * Configures context options, awaits initialization, and extracts the adapter/device.
     * Sets up device lost handling on the render path.
     */
    public async init(canvas: HTMLCanvasElement): Promise<WebGPURenderer> {
        if (this._initPromise) {
            await this._initPromise;
            if (this._renderer) return this._renderer;
            throw new Error('GPUContext initialization previously failed.');
        }

        this._initPromise = this._initInternal(canvas);
        await this._initPromise;
        return this._renderer!;
    }

    private async _initInternal(canvas: HTMLCanvasElement): Promise<void> {
        // Instantiate WebGPURenderer with explicit parameters.
        // powerPreference: 'high-performance' helps avoid fallback to integrated GPUs when discrete is available.
        this._renderer = new WebGPURenderer({
            canvas,
            antialias: true,
            parameters: {
                powerPreference: 'high-performance',
                requiredLimits: {
                    maxStorageBufferBindingSize: 134217728, // 128 MB (required by compute-particles/library)
                    maxComputeWorkgroupSizeX: 256
                }
            }
        });

        // Initialize the renderer backend and wait for device creation.
        await this._renderer.init();

        const backend = (this._renderer as any).backend;
        if (!backend || !backend.device || !backend.adapter) {
            this._ready = false;
            throw new Error('WebGPUBackend failed to initialize device or adapter.');
        }

        this._device = backend.device;
        this._adapter = backend.adapter;

        // Cache limits for other components (e.g., webgpu-limits.ts, compute)
        this._limits = {
            maxStorageBufferBindingSize: this._device!.limits.maxStorageBufferBindingSize,
            maxComputeWorkgroupSizeX: this._device!.limits.maxComputeWorkgroupSizeX,
            maxVertexBuffers: this._device!.limits.maxVertexBuffers,
            maxVertexAttributes: this._device!.limits.maxVertexAttributes,
            maxBindGroups: this._device!.limits.maxBindGroups
        };

        this._ready = true;
        console.log('[GPUContext] Device and renderer initialized successfully');

        // Manage device lost recovery
        this._device!.lost.then((info: GPUDeviceLostInfo) => {
            console.error(`[GPUContext] WebGPU Device Lost: ${info.message} (Reason: ${info.reason})`);
            this._ready = false;
            this._device = null;
            this._adapter = null;
            this._renderer = null;

            // Device lost recovery: Soft disable GPU compute, force reload of the UI/app
            // so we never get a silent black canvas.
            this.handleDeviceLost(info);
        });
    }

    private handleDeviceLost(info: GPUDeviceLostInfo) {
        // Create an assertive ARIA-compliant recovery modal over the canvas
        const overlay = document.createElement('div');
        overlay.style.position = 'absolute';
        overlay.style.top = '0';
        overlay.style.left = '0';
        overlay.style.width = '100vw';
        overlay.style.height = '100vh';
        overlay.style.backgroundColor = 'rgba(0, 0, 0, 0.8)';
        overlay.style.color = 'white';
        overlay.style.display = 'flex';
        overlay.style.flexDirection = 'column';
        overlay.style.justifyContent = 'center';
        overlay.style.alignItems = 'center';
        overlay.style.zIndex = '9999';
        overlay.setAttribute('role', 'dialog');
        overlay.setAttribute('aria-modal', 'true');
        overlay.setAttribute('aria-labelledby', 'device-lost-title');

        const content = document.createElement('div');
        content.style.textAlign = 'center';
        content.style.maxWidth = '600px';
        content.style.padding = '2rem';
        content.style.background = '#222';
        content.style.borderRadius = '8px';

        const title = document.createElement('h2');
        title.id = 'device-lost-title';
        title.innerText = 'Graphics Device Lost';
        title.style.color = '#ff6b6b';

        const desc = document.createElement('p');
        desc.innerText = `The WebGPU device was lost. This can happen due to system resource pressure or if the graphics driver was updated.\n\nReason: ${info.message}`;
        desc.style.marginBottom = '1.5rem';

        const btn = document.createElement('button');
        btn.innerText = 'Reload Game';
        btn.style.padding = '10px 20px';
        btn.style.fontSize = '16px';
        btn.style.cursor = 'pointer';
        btn.style.background = '#339af0';
        btn.style.color = 'white';
        btn.style.border = 'none';
        btn.style.borderRadius = '4px';
        btn.onclick = () => window.location.reload();

        content.appendChild(title);
        content.appendChild(desc);
        content.appendChild(btn);
        overlay.appendChild(content);

        document.body.appendChild(overlay);
        btn.focus();
    }
}

export const gpuContext = GPUContext.getInstance();
