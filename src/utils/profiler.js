
export class Profiler {
    constructor() {
        this.enabled = false;
        this.measures = new Map(); // label -> duration
        this.frameStart = 0;
        this.frameHistory = [];

        // Config
        this.logThresholdMs = 34; // Log if frame > 34ms (~30fps)
        this.maxBars = 10;

        // UI
        this.canvas = document.createElement('canvas');
        this.canvas.style.cssText = 'position:fixed; bottom:10px; right:10px; z-index:9999; pointer-events:none; display:none; background:rgba(0,0,0,0.8); border-radius:8px;';
        this.canvas.width = 300;
        this.canvas.height = 200;
        document.body.appendChild(this.canvas);
        this.ctx = this.canvas.getContext('2d');
    }

    toggle() {
        this.enabled = !this.enabled;
        this.canvas.style.display = this.enabled ? 'block' : 'none';
        console.log(`[Profiler] ${this.enabled ? 'Enabled' : 'Disabled'}`);
    }

    startFrame() {
        if (!this.enabled) return;
        this.measures.clear();
        this.frameStart = performance.now();
    }

    /**
     * Measure a synchronous function
     */
    measure(label, fn) {
        if (!this.enabled) return fn();

        const start = performance.now();
        const result = fn();
        const end = performance.now();

        const duration = end - start;
        const existing = this.measures.get(label) || 0;
        this.measures.set(label, existing + duration);

        return result;
    }

    endFrame() {
        if (!this.enabled) return;

        const totalTime = performance.now() - this.frameStart;

        // Lag Spike Logger
        if (totalTime > this.logThresholdMs) {
            console.warn(`⚠️ LAG SPIKE: ${totalTime.toFixed(1)}ms`);
            const sorted = [...this.measures.entries()].sort((a,b) => b[1] - a[1]);
            console.table(sorted.map(([name, time]) => ({
                System: name,
                'Time (ms)': time.toFixed(2),
                '% of Frame': ((time/totalTime)*100).toFixed(1) + '%'
            })));
        }

        this.drawUI(totalTime);
    }

    drawUI(totalTime) {
        const ctx = this.ctx;
        const w = this.canvas.width;
        const h = this.canvas.height;

        // Clear
        ctx.clearRect(0, 0, w, h);

        // Title
        ctx.fillStyle = '#fff';
        ctx.font = '12px monospace';
        ctx.fillText(`Frame: ${totalTime.toFixed(1)}ms (${(1000/totalTime).toFixed(0)} FPS)`, 10, 20);

        // Draw Bars
        let y = 40;
        const maxBarWidth = w - 20;
        const sorted = [...this.measures.entries()].sort((a,b) => b[1] - a[1]);

        sorted.forEach(([label, time]) => {
            if (y > h - 10) return;

            const percent = Math.min(time / totalTime, 1.0);
            const barWidth = Math.max(1, percent * maxBarWidth);

            // Color coding
            if (time > 10) ctx.fillStyle = '#ff4444'; // Red if > 10ms
            else if (time > 4) ctx.fillStyle = '#ffbb33'; // Orange
            else ctx.fillStyle = '#00C851'; // Green

            ctx.fillRect(10, y, barWidth, 14);

            // Text Label
            ctx.fillStyle = '#fff';
            ctx.fillText(`${label}: ${time.toFixed(1)}ms`, 14, y + 11);

            y += 20;
        });
    }
}

export const profiler = new Profiler();
