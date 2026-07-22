import { isCIorHeadless, getJsHeapUsageRatio, getLoadMemoryTier } from '../core/config.ts';
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
 *
 * Under high JS-heap pressure the budget is cut further and we briefly yield
 * so the GC can reclaim memory instead of locking the tab during load.
 */

import { spawnTracker } from '../world/spawn-tracker.ts';

export interface DeferredTask {
    id: string;
    execute: () => void | Promise<void>;
    priority?: number;
    retryCount?: number;
}

// Detect requestIdleCallback at module level to avoid repeated property lookups.
const hasIdleCallback = typeof requestIdleCallback !== 'undefined';

const TASK_TYPE_PREFIX_MAP: Array<{ prefix: string; type: string }> = [
    { prefix: 'map_stream_', type: 'map_entity_deferred' },
    { prefix: 'map_fallback_', type: 'map_entity_deferred' },
    { prefix: 'procedural_deferred_', type: 'procedural_extra_deferred' },
];

const TASK_TYPE_EXACT_MAP: Record<string, string> = {
    deferred_visuals: 'deferred_visuals',
    shader_warmup: 'shader_warmup',
};

function inferFailureTypeFromTaskId(taskId: string): string {
    if (TASK_TYPE_EXACT_MAP[taskId]) return TASK_TYPE_EXACT_MAP[taskId];
    for (const entry of TASK_TYPE_PREFIX_MAP) {
        if (taskId.startsWith(entry.prefix)) return entry.type;
    }
    return 'background_task';
}
import { maybeRecordBackgroundFailure } from '../world/spawn-tracker.ts';

/** Effective per-frame budget under current RAM pressure. */
function memoryAwareBudget(baseMs: number): number {
    const heapRatio = getJsHeapUsageRatio();
    const tier = getLoadMemoryTier();
    let budget = baseMs;
    if (tier === 'critical') budget = Math.min(budget, 4);
    else if (tier === 'low') budget = Math.min(budget, 6);

    if (heapRatio >= 0.8) budget = Math.min(budget, 2);
    else if (heapRatio >= 0.65) budget = Math.min(budget, 4);
    else if (heapRatio >= 0.5) budget = Math.min(budget, Math.max(3, baseMs * 0.5));
    return Math.max(1, budget);
}

/** Brief pause so Chromium can GC when the heap is near the limit. */
function yieldForMemoryPressure(): Promise<void> {
    const heapRatio = getJsHeapUsageRatio();
    if (heapRatio < 0.7) return Promise.resolve();
    return new Promise(resolve => {
        // Two rAFs give the browser a chance to run GC between deferred spawns.
        requestAnimationFrame(() => {
            requestAnimationFrame(() => resolve());
        });
    });
}

export class BackgroundProcessor {
    private queue: DeferredTask[] = [];
    private isRunning: boolean = false;
    private maxMsPerFrame: number;
    private onCompleteCallback: ((completed: number, total: number, failed: number) => void) | null = null;
    private onProgressCallback: ((completed: number, total: number) => void) | null = null;
    private totalTasks: number = 0;
    private completedTasks: number = 0;
    private failedTasks: number = 0;
    private startTimeMs: number = 0;

    constructor(maxMsPerFrame: number = 8) {
        this.maxMsPerFrame = maxMsPerFrame;
    }

    /**
     * Add a task to the queue
     */
    public enqueue(task: DeferredTask): void {
        const priority = task.priority ?? 0;
        if (priority <= 0 || this.queue.length === 0) {
            this.queue.push(task);
        } else {
            const insertAt = this.queue.findIndex(queued => (queued.priority ?? 0) < priority);
            if (insertAt === -1) {
                this.queue.push(task);
            } else {
                this.queue.splice(insertAt, 0, task);
            }
        }
        this.totalTasks++;
    }

    /**
     * Set a callback for when the queue is fully processed.
     * Receives (completed, total, failed) counts.
     */
    public onComplete(callback: (completed: number, total: number, failed: number) => void): void {
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
    public async start(): Promise<void> {
        if (isCIorHeadless()) {
            console.log('[BackgroundProcessor] CI/Headless mode detected, running synchronously.');
            while (this.queue.length > 0) {
                const task = this.queue.shift();
                if (task) {
                    try {
                        const result = task.execute(); if (result instanceof Promise) { await result; }
                        this.completedTasks++;
                    } catch (e) {
                        console.error(`[BackgroundProcessor] Error executing task ${task.id}:`, e);
                        this.failedTasks++;
                    }
                }
            }
            this.onCompleteCallback?.(this.completedTasks, this.totalTasks, this.failedTasks);
            return;
        }
        if (this.isRunning) return;
        if (this.queue.length === 0) {
            this.onCompleteCallback?.(this.completedTasks, this.totalTasks, this.failedTasks);
            return;
        }
        this.isRunning = true;
        this.startTimeMs = performance.now();

        console.log(`[BackgroundProcessor] Starting with ${this.queue.length} tasks`);

        if (isCIorHeadless()) {
            console.log(`[BackgroundProcessor] CI bypass: Synchronously processing ${this.queue.length} tasks...`);

            // We create an async wrapper so we can await the tasks without making start() return a Promise
            const processAllSync = async () => {
                while (this.queue.length > 0) {
                    const task = this.queue.shift()!;
                    try {
                        const result = task.execute();
                        if (result instanceof Promise) {
                            await result;
                        }
                        this.completedTasks++;
                    } catch (e) {
                        console.error(`[BackgroundProcessor] Error executing task ${task.id}:`, e);
                        maybeRecordBackgroundFailure(task.id, e);
                        this.failedTasks++;
                    }
                }
                this.complete();
            };

            processAllSync();
            return;
        }

        this.scheduleNext();
    }

    /** Current number of failed tasks (readable mid-run for progress reporting). */
    public getFailedCount(): number {
        return this.failedTasks;
    }

    /**
     * Estimated milliseconds until the queue drains, based on observed task rate.
     * Returns -1 when no tasks have completed yet (rate unknown).
     */
    public getEstimatedTimeRemainingMs(): number {
        if (this.completedTasks === 0 || this.startTimeMs === 0) return -1;
        const elapsedMs = performance.now() - this.startTimeMs;
        const msPerTask = elapsedMs / this.completedTasks;
        const remaining = this.totalTasks - this.completedTasks;
        return remaining > 0 ? Math.ceil(remaining * msPerTask) : 0;
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
            requestIdleCallback((deadline) => {
                // Guarantee at least 1–2 ms so a forced-timeout callback (timeRemaining≈0)
                // still makes forward progress instead of spinning with zero work done.
                const aware = memoryAwareBudget(this.maxMsPerFrame);
                const budget = Math.max(1, Math.min(deadline.timeRemaining() || aware, aware));
                this.processChunk(budget);
            }, { timeout: getJsHeapUsageRatio() >= 0.65 ? 250 : 500 });
        } else {
            requestAnimationFrame(() => {
                this.processChunk(memoryAwareBudget(this.maxMsPerFrame));
            });
        }
    }

    /**
     * Process tasks until the given time budget (ms) is consumed.
     * Always processes at least one task per call so the queue makes forward
     * progress even when the budget is tight (e.g. forced idle callback).
     */
    private async processChunk(budgetMs: number): Promise<void> {
        if (!this.isRunning) return;

        if (this.queue.length === 0) {
            this.complete();
            return;
        }

        // Under heavy heap pressure, pause a frame before more allocations.
        if (getJsHeapUsageRatio() >= 0.7) {
            await yieldForMemoryPressure();
        }

        const chunkStart = performance.now();
        let processed = 0;
        // On critical heap pressure, process at most one heavy task per slot.
        const maxTasksThisChunk = getJsHeapUsageRatio() >= 0.8 ? 1 : Number.POSITIVE_INFINITY;

        while (this.queue.length > 0) {
            // Check budget only after we've done at least one task, so a forced
            // callback with timeRemaining()=0 still drains one entry per slot
            // rather than spinning forever without touching the queue.
            if (processed > 0 && (processed >= maxTasksThisChunk || performance.now() - chunkStart >= budgetMs)) {
                break;
            }

            const task = this.queue.shift();
            if (!task) continue;

            try {
                const result = task.execute();
                if (result instanceof Promise) {
                    await result;
                }
            } catch (e) {
                if ((task.retryCount || 0) < 1) {
                    task.retryCount = (task.retryCount || 0) + 1;
                    console.warn(`[BackgroundProcessor] Task ${task.id} failed, retrying once. Error:`, e);
                    this.queue.unshift(task);
                    continue;
                }
                console.error(`[BackgroundProcessor] Error executing task ${task.id}:`, e);
                maybeRecordBackgroundFailure(task.id, e);
                this.failedTasks++;
            } finally {
                // Count every dequeued task (success or failure) so the progress
                // counter stays in sync with totalTasks and onComplete fires correctly.
                this.completedTasks++;
                processed++;
                if (this.onProgressCallback) {
                    this.onProgressCallback(this.completedTasks, this.totalTasks);
                }
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
        console.log(`[BackgroundProcessor] Queue complete (${this.completedTasks}/${this.totalTasks}, ${this.failedTasks} failed)`);
        if (this.onCompleteCallback) this.onCompleteCallback(this.completedTasks, this.totalTasks, this.failedTasks);
    }

    /**
     * Clear all pending tasks and reset counters.
     * Call before re-enqueuing a new generation run so totalTasks/completedTasks
     * start fresh and start() is not blocked by a stale isRunning=true state.
     */
    public clear(): void {
        this.queue = [];
        this.totalTasks = 0;
        this.completedTasks = 0;
        this.failedTasks = 0;
        this.startTimeMs = 0;
        this.isRunning = false;
        this.onCompleteCallback = null;
        this.onProgressCallback = null;
    }

    /**
     * Reset counters and running state without dropping queued tasks.
     * Use this when tasks were enqueued before the caller is ready to start()
     * so progress/completion tracking stays accurate.
     */
    public resetCounters(): void {
        this.totalTasks = this.queue.length;
        this.completedTasks = 0;
        this.failedTasks = 0;
        this.startTimeMs = 0;
        this.isRunning = false;
        this.onCompleteCallback = null;
        this.onProgressCallback = null;
    }
}

// Global instance for convenience
export const globalBackgroundProcessor = new BackgroundProcessor(8);
