/**
 * @file asset-streaming-scheduler.ts
 * @description Task scheduling, priority queue management, and batch processing for asset streaming
 * 
 * Provides:
 * - Priority-based asset request queuing
 * - Batch asset loading coordination
 * - Scheduling optimization and metrics
 */

import {
    AssetPriority,
    AssetRequest,
    AssetBatch,
    LoadedAsset,
    LoadingProgress
} from './asset-streaming-types.ts';

// ============================================================================
// SCHEDULER CONSTANTS & TYPES
// ============================================================================

/**
 * Scheduler result for processing status
 */
interface SchedulerResult {
    processedCount: number;
    remainingCount: number;
    timeElapsed: number;
}

// ============================================================================
// ASSET SCHEDULER
// ============================================================================

/**
 * Manages task scheduling, priority queues, and batch processing
 * for the asset streaming system.
 */
export class AssetScheduler {
    private loadingQueue: AssetRequest[] = [];
    private activeLoadCount: number = 0;
    private maxConcurrentLoads: number = 6;
    private batchSize: number = 10;

    constructor(maxConcurrentLoads: number = 6, batchSize: number = 10) {
        this.maxConcurrentLoads = maxConcurrentLoads;
        this.batchSize = batchSize;
    }

    // ========================================================================
    // QUEUE MANAGEMENT
    // ========================================================================

    /**
     * Add an asset request to the loading queue.
     */
    enqueueAsset(request: AssetRequest): void {
        this.loadingQueue.push(request);
        this.sortQueue();
    }

    /**
     * Add multiple asset requests to the loading queue.
     */
    enqueueBatch(requests: AssetRequest[]): void {
        this.loadingQueue.push(...requests);
        this.sortQueue();
    }

    /**
     * Remove an asset request from the queue by ID.
     */
    dequeueAsset(id: string): AssetRequest | undefined {
        const index = this.loadingQueue.findIndex(r => r.id === id);
        if (index !== -1) {
            return this.loadingQueue.splice(index, 1)[0];
        }
        return undefined;
    }

    /**
     * Get the next asset to load based on priority.
     */
    getNextAsset(): AssetRequest | undefined {
        if (this.loadingQueue.length === 0) return undefined;
        
        if (this.activeLoadCount < this.maxConcurrentLoads) {
            this.activeLoadCount++;
            return this.loadingQueue.shift();
        }
        
        return undefined;
    }

    /**
     * Mark an asset load as complete.
     */
    completeLoad(): void {
        this.activeLoadCount = Math.max(0, this.activeLoadCount - 1);
    }

    /**
     * Get current queue statistics.
     */
    getQueueStats(): {
        totalQueued: number;
        activeLoads: number;
        capacity: number;
    } {
        return {
            totalQueued: this.loadingQueue.length,
            activeLoads: this.activeLoadCount,
            capacity: this.maxConcurrentLoads
        };
    }

    // ========================================================================
    // PRIORITY MANAGEMENT
    // ========================================================================

    /**
     * Re-prioritize an asset in the queue.
     */
    reprioritizeAsset(id: string, newPriority: AssetPriority): boolean {
        const request = this.loadingQueue.find(r => r.id === id);
        if (request) {
            request.priority = newPriority;
            this.sortQueue();
            return true;
        }
        return false;
    }

    /**
     * Get the priority of an asset in the queue.
     */
    getAssetPriority(id: string): AssetPriority | undefined {
        return this.loadingQueue.find(r => r.id === id)?.priority;
    }

    /**
     * Clear the entire queue.
     */
    clearQueue(): void {
        this.loadingQueue = [];
        this.activeLoadCount = 0;
    }

    /**
     * Get queue size.
     */
    getQueueSize(): number {
        return this.loadingQueue.length;
    }

    /**
     * Check if queue has items.
     */
    hasQueuedItems(): boolean {
        return this.loadingQueue.length > 0;
    }

    // ========================================================================
    // BATCH PROCESSING
    // ========================================================================

    /**
     * Get next batch of assets to process.
     * Returns up to batchSize items without exceeding concurrent load limit.
     */
    getNextBatch(): AssetRequest[] {
        const batch: AssetRequest[] = [];
        const availableSlots = this.maxConcurrentLoads - this.activeLoadCount;
        const batchToTake = Math.min(this.batchSize, availableSlots, this.loadingQueue.length);

        for (let i = 0; i < batchToTake; i++) {
            const item = this.loadingQueue.shift();
            if (item) {
                batch.push(item);
                this.activeLoadCount++;
            }
        }

        return batch;
    }

    /**
     * Process a batch of assets with a callback.
     * Returns scheduling metrics.
     */
    async processBatch(
        batch: AssetRequest[],
        processor: (request: AssetRequest) => Promise<LoadedAsset>
    ): Promise<SchedulerResult> {
        const startTime = performance.now();
        let processedCount = 0;
        let failedCount = 0;

        for (const request of batch) {
            try {
                const asset = await processor(request);
                request.resolve(asset);
                processedCount++;
            } catch (error) {
                failedCount++;
                const err = error instanceof Error ? error : new Error(String(error));
                request.reject(err);
            } finally {
                this.completeLoad();
            }
        }

        const timeElapsed = performance.now() - startTime;

        return {
            processedCount,
            remainingCount: this.loadingQueue.length,
            timeElapsed
        };
    }

    // ========================================================================
    // CONFIGURATION
    // ========================================================================

    /**
     * Set maximum concurrent loads.
     */
    setMaxConcurrentLoads(count: number): void {
        this.maxConcurrentLoads = Math.max(1, count);
    }

    /**
     * Set batch size for batch processing.
     */
    setBatchSize(size: number): void {
        this.batchSize = Math.max(1, size);
    }

    /**
     * Get current configuration.
     */
    getConfig(): { maxConcurrentLoads: number; batchSize: number } {
        return {
            maxConcurrentLoads: this.maxConcurrentLoads,
            batchSize: this.batchSize
        };
    }

    // ========================================================================
    // PRIVATE HELPERS
    // ========================================================================

    /**
     * Sort queue by priority (ascending = highest priority first).
     */
    private sortQueue(): void {
        this.loadingQueue.sort((a, b) => a.priority - b.priority);
    }
}

// ============================================================================
// BATCH COORDINATOR
// ============================================================================

/**
 * Coordinates batch loading operations with progress tracking.
 */
export class BatchCoordinator {
    /**
     * Load a batch of assets with coordinated progress tracking.
     */
    static async loadBatch(
        batch: AssetBatch,
        loadAssetFn: (id: string, priority: AssetPriority) => Promise<LoadedAsset>
    ): Promise<LoadedAsset[]> {
        const { ids, priority, onProgress, onComplete, onError } = batch;
        const results: LoadedAsset[] = [];
        const errors: Error[] = [];
        let loaded = 0;

        const promises = ids.map(async (id) => {
            try {
                const asset = await loadAssetFn(id, priority);
                results.push(asset);
                loaded++;
                onProgress?.(loaded, ids.length);
                return asset;
            } catch (error) {
                const err = error instanceof Error ? error : new Error(String(error));
                errors.push(err);
                throw err;
            }
        });

        try {
            await Promise.all(promises);
        } catch {
            // Errors already tracked in errors array
        }

        if (errors.length > 0 && onError) {
            onError(errors);
        }

        if (onComplete) {
            onComplete(results);
        }

        return results;
    }

    /**
     * Create asset requests from batch specification.
     */
    static createBatchRequests(
        batch: AssetBatch
    ): AssetRequest[] {
        return batch.ids.map(id => ({
            id,
            priority: batch.priority,
            resolve: () => {},
            reject: () => {},
            attempts: 0
        }));
    }
}

// ============================================================================
// PRIORITY QUEUE
// ============================================================================

/**
 * Specialized priority queue for asset requests.
 * Uses a min-heap for efficient priority-based retrieval.
 */
export class PriorityQueue {
    private items: AssetRequest[] = [];

    /**
     * Enqueue an item with a priority.
     */
    enqueue(request: AssetRequest): void {
        this.items.push(request);
        this.bubbleUp(this.items.length - 1);
    }

    /**
     * Dequeue the highest priority (lowest value) item.
     */
    dequeue(): AssetRequest | undefined {
        if (this.items.length === 0) return undefined;
        if (this.items.length === 1) return this.items.pop();

        const top = this.items[0];
        this.items[0] = this.items.pop()!;
        this.bubbleDown(0);
        return top;
    }

    /**
     * Peek at the highest priority item without removing it.
     */
    peek(): AssetRequest | undefined {
        return this.items[0];
    }

    /**
     * Check if queue is empty.
     */
    isEmpty(): boolean {
        return this.items.length === 0;
    }

    /**
     * Get queue size.
     */
    size(): number {
        return this.items.length;
    }

    /**
     * Clear the queue.
     */
    clear(): void {
        this.items = [];
    }

    /**
     * Get all items (unordered).
     */
    getAllItems(): AssetRequest[] {
        return [...this.items];
    }

    // ========================================================================
    // PRIVATE HEAP OPERATIONS
    // ========================================================================

    private bubbleUp(index: number): void {
        while (index > 0) {
            const parentIndex = Math.floor((index - 1) / 2);
            if (this.items[index].priority >= this.items[parentIndex].priority) break;

            [this.items[index], this.items[parentIndex]] = [this.items[parentIndex], this.items[index]];
            index = parentIndex;
        }
    }

    private bubbleDown(index: number): void {
        while (true) {
            let swapIndex: number | null = null;
            const leftChild = 2 * index + 1;
            const rightChild = 2 * index + 2;

            if (leftChild < this.items.length &&
                this.items[leftChild].priority < this.items[index].priority) {
                swapIndex = leftChild;
            }

            if (rightChild < this.items.length &&
                this.items[rightChild].priority < (swapIndex === null ? this.items[index].priority : this.items[leftChild].priority)) {
                swapIndex = rightChild;
            }

            if (swapIndex === null) break;

            [this.items[index], this.items[swapIndex]] = [this.items[swapIndex], this.items[index]];
            index = swapIndex;
        }
    }
}
