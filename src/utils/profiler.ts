/**
 * Performance profiler utility
 * Tracks frame timing and displays a debug overlay
 */

interface Measure {
    label: string;
    start: number;
    end?: number;
    duration?: number;
}

interface FrameData {
    frameTime: number;
    measures: Map<string, number>;
}

/**
 * Profiler class for measuring performance
 */
export class Profiler {
    /** Whether profiling is enabled */
    public enabled: boolean;
    
    /** Map of current measurements by label (label -> duration in ms) */
    public measures: Map<string, number>;
    
    /** Start time of current frame */
    public frameStart: number;
    
    /** History of frame times for averaging */
    public frameHistory: number[];
    
    /** Canvas element for debug UI */
    public canvas: HTMLCanvasElement | null;
    
    /** Canvas 2D context */
    public ctx: CanvasRenderingContext2D | null;

    constructor() {
        this.enabled = false;
        this.measures = new Map<string, number>();
        this.frameStart = 0;
        this.frameHistory = [];
        this.canvas = null;
        this.ctx = null;
    }

    /**
     * Toggle profiler on/off
     */
    toggle(): void {
        this.enabled = !this.enabled;
        if (this.enabled) {
            this.setupCanvas();
        } else {
            this.cleanupCanvas();
        }
    }

    /**
     * Mark the start of a new frame
     */
    startFrame(): void {
        if (!this.enabled) return;
        this.frameStart = performance.now();
        this.measures.clear();
    }

    /**
     * Measure the execution time of a function
     * @param label - Label for this measurement
     * @param fn - Function to measure
     * @returns The result of the function
     */
    measure<T>(label: string, fn: () => T): T {
        if (!this.enabled) return fn();
        
        const start = performance.now();
        const result = fn();
        const end = performance.now();
        
        this.measures.set(label, end - start);
        return result;
    }

    /**
     * Mark the end of the current frame and update history
     */
    endFrame(): void {
        if (!this.enabled || this.frameStart === 0) return;
        
        const frameTime = performance.now() - this.frameStart;
        this.frameHistory.push(frameTime);
        
        // Keep last 60 frames
        if (this.frameHistory.length > 60) {
            this.frameHistory.shift();
        }
        
        this.drawUI();
    }

    /**
     * Draw the profiler debug UI
     */
    drawUI(): void {
        if (!this.ctx || !this.canvas) return;
        
        const ctx = this.ctx;
        const width = this.canvas.width;
        const height = this.canvas.height;
        
        // Clear canvas
        ctx.clearRect(0, 0, width, height);
        
        // Calculate average frame time
        const avgFrameTime = this.frameHistory.reduce((a, b) => a + b, 0) / this.frameHistory.length;
        const fps = Math.round(1000 / avgFrameTime);
        
        // Draw background
        ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
        ctx.fillRect(10, 10, 200, 80 + this.measures.size * 20);
        
        // Draw FPS
        ctx.fillStyle = fps >= 55 ? '#00ff00' : fps >= 30 ? '#ffff00' : '#ff0000';
        ctx.font = 'bold 16px monospace';
        ctx.fillText(`FPS: ${fps}`, 20, 30);
        
        // Draw frame time
        ctx.fillStyle = '#ffffff';
        ctx.fillText(`Frame: ${avgFrameTime.toFixed(2)}ms`, 20, 50);
        
        // Draw measurements
        let y = 70;
        this.measures.forEach((duration, label) => {
            ctx.fillStyle = '#aaaaaa';
            ctx.font = '12px monospace';
            ctx.fillText(`${label}: ${duration.toFixed(2)}ms`, 20, y);
            y += 20;
        });
    }

    /**
     * Setup the debug canvas
     */
    private setupCanvas(): void {
        this.canvas = document.createElement('canvas');
        this.canvas.id = 'profiler-canvas';
        this.canvas.width = 220;
        this.canvas.height = 200;
        this.canvas.style.position = 'fixed';
        this.canvas.style.top = '10px';
        this.canvas.style.right = '10px';
        this.canvas.style.zIndex = '9999';
        this.canvas.style.pointerEvents = 'none';
        
        const ctx = this.canvas.getContext('2d');
        if (ctx) {
            this.ctx = ctx;
        }
        
        document.body.appendChild(this.canvas);
    }

    /**
     * Remove the debug canvas
     */
    private cleanupCanvas(): void {
        if (this.canvas && this.canvas.parentNode) {
            this.canvas.parentNode.removeChild(this.canvas);
        }
        this.canvas = null;
        this.ctx = null;
    }
}

/** Singleton profiler instance */
export const profiler = new Profiler();
