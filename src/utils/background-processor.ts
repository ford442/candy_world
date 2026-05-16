/**
 * Time-Budgeted Background Processor
 *
 * Safely processes a queue of expensive tasks over multiple frames
 * using requestAnimationFrame to maintain a target framerate.
 */

export interface DeferredTask {
    id: string;
    execute: () => void | Promise<void>;
}

export class BackgroundProcessor {
    private queue: DeferredTask[] = [];
    private isRunning: boolean = false;
    private maxMsPerFrame: number;
    private onCompleteCallback: (() => void) | null = null;
    private onProgressCallback: ((completed: number, total: number) => void) | null = null;
    private totalTasks: number = 0;
    private completedTasks: number = 0;

    constructor(maxMsPerFrame: number = 8) {
        this.maxMsPerFrame = maxMsPerFrame; // 8ms gives us plenty of room to hit 60fps (16ms)
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
        requestAnimationFrame(this.processQueue.bind(this));
    }

    /**
     * Stop processing immediately (pauses execution)
     */
    public stop(): void {
        this.isRunning = false;
    }

    /**
     * Internal processing loop
     */
    private async processQueue(): Promise<void> {
        if (!this.isRunning) return;

        if (this.queue.length === 0) {
            this.isRunning = false;
            console.log('[BackgroundProcessor] Queue complete');
            if (this.onCompleteCallback) this.onCompleteCallback();
            return;
        }

        const frameStart = performance.now();

        // Process tasks until we run out of time budget
        while (this.queue.length > 0) {
            const timeElapsed = performance.now() - frameStart;

            // If we've exceeded our budget for this frame, yield to next frame
            if (timeElapsed >= this.maxMsPerFrame) {
                break;
            }

            const task = this.queue.shift();
            if (task) {
                try {
                    // Note: If task returns a Promise, we await it.
                    // This pauses the loop for async operations, which is fine,
                    // though it means we yield control anyway.
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
        }

        // Schedule the next chunk
        if (this.queue.length > 0) {
            requestAnimationFrame(this.processQueue.bind(this));
        } else {
            this.isRunning = false;
            console.log('[BackgroundProcessor] Queue complete');
            if (this.onCompleteCallback) this.onCompleteCallback();
        }
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
