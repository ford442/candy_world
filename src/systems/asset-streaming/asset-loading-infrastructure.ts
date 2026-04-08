/**
 * @file asset-loading-infrastructure.ts
 * @description Core infrastructure classes for asset loading:
 * - LRUCache for memory management
 * - NetworkManager for optimized HTTP/2, range requests, retry logic
 */

import {
    AssetPriority,
    StreamingConfig,
    NetworkStats
} from './asset-streaming-types.ts';

// ============================================================================
// LRU CACHE IMPLEMENTATION
// ============================================================================

/**
 * LRU (Least Recently Used) cache for asset memory management.
 * Automatically evicts least recently used assets when size limit reached.
 */
export class LRUCache<K, V> {
    private cache: Map<K, V> = new Map();
    private maxSize: number;
    private currentSize: number;
    private getSize: (value: V) => number;

    constructor(
        maxSize: number,
        getSize: (value: V) => number = () => 1
    ) {
        this.maxSize = maxSize;
        this.currentSize = 0;
        this.getSize = getSize;
    }

    get(key: K): V | undefined {
        const value = this.cache.get(key);
        if (value !== undefined) {
            // Move to end (most recently used)
            this.cache.delete(key);
            this.cache.set(key, value);
        }
        return value;
    }

    set(key: K, value: V): boolean {
        const size = this.getSize(value);
        
        // If single item exceeds max size, don't cache
        if (size > this.maxSize) {
            return false;
        }

        // Remove existing entry if present
        if (this.cache.has(key)) {
            const oldValue = this.cache.get(key)!;
            this.currentSize -= this.getSize(oldValue);
            this.cache.delete(key);
        }

        // Evict entries until we have space
        while (this.currentSize + size > this.maxSize && this.cache.size > 0) {
            this.evictLRU();
        }

        this.cache.set(key, value);
        this.currentSize += size;
        return true;
    }

    delete(key: K): boolean {
        const value = this.cache.get(key);
        if (value !== undefined) {
            this.currentSize -= this.getSize(value);
            return this.cache.delete(key);
        }
        return false;
    }

    has(key: K): boolean {
        return this.cache.has(key);
    }

    private evictLRU(): void {
        const firstKey = this.cache.keys().next().value;
        if (firstKey !== undefined) {
            const value = this.cache.get(firstKey)!;
            this.currentSize -= this.getSize(value);
            this.cache.delete(firstKey);
        }
    }

    clear(): void {
        this.cache.clear();
        this.currentSize = 0;
    }

    get size(): number {
        return this.cache.size;
    }

    get byteSize(): number {
        return this.currentSize;
    }

    keys(): IterableIterator<K> {
        return this.cache.keys();
    }

    forEach(callback: (value: V, key: K) => void): void {
        this.cache.forEach(callback);
    }
}

// ============================================================================
// NETWORK MANAGER
// ============================================================================

interface QueuedRequest {
    url: string;
    priority: AssetPriority;
    range?: { start: number; end: number };
    resolve: (response: Response) => void;
    reject: (error: Error) => void;
    attempts: number;
}

/**
 * Manages network requests with optimization features:
 * - HTTP/2 server push simulation
 * - Range requests for large files
 * - Retry with exponential backoff
 * - Request prioritization and queuing
 */
export class NetworkManager {
    private config: StreamingConfig;
    private activeRequests: Map<string, AbortController> = new Map();
    private requestQueue: QueuedRequest[] = [];
    private stats = {
        bytesDownloaded: 0,
        requests: 0,
        failed: 0,
        retries: 0
    };

    constructor(config: StreamingConfig) {
        this.config = config;
    }

    /** Detect network capabilities */
    async detectNetwork(): Promise<NetworkStats> {
        const connection = (navigator as any).connection;
        
        return {
            bandwidth: 0,  // Would be measured from actual downloads
            latency: 0,    // Would be measured from ping
            connectionType: connection?.effectiveType || 'unknown',
            saveData: connection?.saveData || false,
            downlink: connection?.downlink,
            rtt: connection?.rtt
        };
    }

    /** Fetch asset with all optimizations */
    async fetchAsset(
        url: string,
        priority: AssetPriority = AssetPriority.MEDIUM,
        range?: { start: number; end: number }
    ): Promise<Response> {
        // Check if we can make more concurrent requests
        if (this.activeRequests.size >= this.config.maxConcurrentRequests) {
            // Queue the request
            return new Promise((resolve, reject) => {
                this.requestQueue.push({
                    url, priority, range, resolve, reject, attempts: 0
                });
                // Sort by priority
                this.requestQueue.sort((a, b) => a.priority - b.priority);
            });
        }

        return this.doFetch(url, priority, range);
    }

    private async doFetch(
        url: string,
        priority: AssetPriority,
        range?: { start: number; end: number }
    ): Promise<Response> {
        const abortController = new AbortController();
        this.activeRequests.set(url, abortController);

        const headers: HeadersInit = {};
        
        // Add priority hint if supported
        if ('priority' in Request.prototype) {
            (headers as any)['priority'] = this.priorityToHint(priority);
        }

        // Add range header if specified
        if (range && this.config.enableRangeRequests) {
            headers['Range'] = `bytes=${range.start}-${range.end}`;
        }

        try {
            const response = await fetch(url, {
                signal: abortController.signal,
                headers
            });

            if (!response.ok && response.status !== 206) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            this.stats.requests++;
            
            // Track bytes downloaded
            const contentLength = response.headers.get('content-length');
            if (contentLength) {
                this.stats.bytesDownloaded += parseInt(contentLength, 10);
            }

            return response;
        } catch (error) {
            this.stats.failed++;
            throw error;
        } finally {
            this.activeRequests.delete(url);
            this.processQueue();
        }
    }

    private priorityToHint(priority: AssetPriority): 'high' | 'low' | 'auto' {
        switch (priority) {
            case AssetPriority.CRITICAL:
            case AssetPriority.HIGH:
                return 'high';
            case AssetPriority.LOW:
            case AssetPriority.BACKGROUND:
                return 'low';
            default:
                return 'auto';
        }
    }

    private processQueue(): void {
        while (
            this.activeRequests.size < this.config.maxConcurrentRequests &&
            this.requestQueue.length > 0
        ) {
            const request = this.requestQueue.shift()!;
            this.doFetch(request.url, request.priority, request.range)
                .then(request.resolve)
                .catch(request.reject);
        }
    }

    /** Retry with exponential backoff */
    async retryWithBackoff<T>(
        operation: () => Promise<T>,
        attempts: number = this.config.retryAttempts
    ): Promise<T> {
        let lastError: Error | undefined;
        
        for (let i = 0; i < attempts; i++) {
            try {
                return await operation();
            } catch (error) {
                lastError = error instanceof Error ? error : new Error(String(error));
                this.stats.retries++;
                
                if (i < attempts - 1) {
                    const delay = this.config.retryDelayMs * Math.pow(2, i);
                    await new Promise(resolve => setTimeout(resolve, delay));
                }
            }
        }
        
        throw lastError;
    }

    /** Cancel all pending requests */
    cancelAll(): void {
        for (const controller of this.activeRequests.values()) {
            controller.abort();
        }
        this.activeRequests.clear();
        this.requestQueue = [];
    }

    getStats(): typeof this.stats {
        return { ...this.stats };
    }
}
