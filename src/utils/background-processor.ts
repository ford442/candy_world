/**
 * Time-Budgeted Background Processor
 *
 * Safely processes a queue of expensive tasks over multiple frames.
 *
 * Scheduling strategy (priority order):
 *  1. `requestIdleCallback` — preferred: runs during browser idle time so it
 *     cannot steal render-frame budget from the game loop.
 *  2. `requestAnimationFrame` — fallback for browsers without rIC.
 *
 * The per-callback time budget (`maxMsPerFrame`) guards against long-running
 * individual tasks: we measure elapsed time *before* dequeuing each task so
 * that a single expensive factory function (e.g. 25 ms tree geometry) only
 * causes one overrun rather than stacking overruns across entities.
 */

export interface DeferredTask {
    id: string;
    execute: () => void | Promise<void>;
}

// Detect requestIdleCallback at module level to avoid repeated property lookups.
const hasIdleCallback = typeof requestIdleCallback !== 'undefined';

export class BackgroundProcessor {
    private queue: DeferredTask[] = [];
    private isRunning: boolean = false;
    private maxMsPerFrame: number;
    private onCompleteCallback: (() => void) | null = null;
    private onProgressCallback: ((completed: number, total: number) => void) | null = null;
    private totalTasks: number = 0;
    private completedTasks: number = 0;

    constructor(maxMsPerFrame: number = 8) {
        this.maxMsPerFrame = maxMsPerFrame;
    }

    /**
     * Add a task to the queue
     */
    public enqueue(task: DeferredTask): void {
        this.queue.push(task);
        this.totalTasks++;
    }

    /**
     * Set a callback for when the queue is fully processed
     */
    public onComplete(callback: () => void): void {
        this.onCompleteCallback = callback;
    }

    /**
     * Set a callback for progress updates
     */
    public onProgress(callback: (completed: number, total: number) => void): void {
        this.onProgressCallback = callback;
    }

    /**
     * Start processing the queue
     */
    public start(): void {
        if (this.isRunning || this.queue.length === 0) return;
        this.isRunning = true;

        console.log(`[BackgroundProcessor] Starting with ${this.queue.length} tasks`);
        this.scheduleNext();
    }

    /**
     * Stop processing immediately (pauses execution)
     */
    public stop(): void {
        this.isRunning = false;
    }

    /**
     * Schedule the next processing callback using the best available API.
     */
    private scheduleNext(): void {
        if (hasIdleCallback) {
            // idleDeadline.timeRemaining() tells us how long the browser is idle.
            // We cap at maxMsPerFrame so we never hog an entire idle period.
            requestIdleCallback((deadline) => {
                const budget = Math.min(deadline.timeRemaining(), this.maxMsPerFrame);
                this.processChunk(budget);
            }, { timeout: 1000 }); // 1 s timeout ensures progress even under load
        } else {
            requestAnimationFrame(() => {
                this.processChunk(this.maxMsPerFrame);
            });
        }
    }

    /**
     * Process tasks until the given time budget (ms) is consumed.
     */
    private async processChunk(budgetMs: number): Promise<void> {
        if (!this.isRunning) return;

        if (this.queue.length === 0) {
            this.complete();
            return;
        }

        const chunkStart = performance.now();

        while (this.queue.length > 0) {
            // Check budget BEFORE starting the next task so a single slow task
            // only overruns once rather than accumulating overruns.
            if (performance.now() - chunkStart >= budgetMs) {
                break;
            }

            const task = this.queue.shift();
            if (!task) continue;

            try {
                const result = task.execute();
                if (result instanceof Promise) {
                    await result;
                }
                this.completedTasks++;

                if (this.onProgressCallback) {
                    this.onProgressCallback(this.completedTasks, this.totalTasks);
                }
            } catch (e) {
                console.error(`[BackgroundProcessor] Error executing task ${task.id}:`, e);
            }
        }

        if (this.queue.length > 0) {
            this.scheduleNext();
        } else {
            this.complete();
        }
    }

    private complete(): void {
        this.isRunning = false;
        console.log('[BackgroundProcessor] Queue complete');
        if (this.onCompleteCallback) this.onCompleteCallback();
    }

    /**
     * Clear all pending tasks
     */
    public clear(): void {
        this.queue = [];
        this.totalTasks = 0;
        this.completedTasks = 0;
        this.isRunning = false;
    }
}

// Global instance for convenience
export const globalBackgroundProcessor = new BackgroundProcessor(8);
