// src/utils/geometry-pool.ts
// BufferGeometry object pool — recycles disposed geometry objects so that
// subsequent allocations can reuse pre-existing TypedArray backing memory
// instead of triggering fresh GC-managed heap allocations.
//
// Usage pattern (LOD streaming / chunk lifecycle):
//
//   // Acquire a geometry slot (from pool if available, otherwise brand-new)
//   const geo = geometryPool.acquire('sphere-r1-s16');
//
//   // … populate geo.setAttribute / setIndex as needed …
//
//   // When the chunk is unloaded, return the geometry to the pool
//   geometryPool.release('sphere-r1-s16', geo);
//
// The pool intentionally does NOT dispose the geometry on release —
// it keeps the underlying TypedArray allocations alive so they can be
// reused by the next acquire() call for the same key.  Use
// geometryPool.flush() to free everything when you are sure no further
// reuse will occur (e.g. full scene reset).
//
// For sharing a single immutable geometry among many read-only meshes
// (no LOD churn), prefer the existing GeometryRegistry in geometry-dedup.ts.

import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PoolStats {
    /** Number of acquire() calls served from the pool (reuses). */
    hits: number;
    /** Number of acquire() calls that created a fresh geometry. */
    misses: number;
    /** Total number of geometries currently waiting in the pool. */
    pooledCount: number;
    /** Maximum pool depth ever observed for any single key. */
    peakDepth: number;
    /** Estimated bytes saved through reuse (32 bytes per vertex * vertices reused). */
    estimatedBytesSaved: number;
}

// ---------------------------------------------------------------------------
// GeometryPool
// ---------------------------------------------------------------------------

/**
 * Time-budgeted object pool for `THREE.BufferGeometry` instances.
 *
 * Geometries are keyed by an arbitrary string so callers can maintain
 * separate pools for different shapes/resolutions without cross-contamination.
 * A per-key `maxDepth` caps the pool size to prevent unbounded memory growth
 * when many geometries are released but never re-acquired.
 */
export class GeometryPool {
    /** Keyed pools of recycled geometry objects. */
    private readonly pools: Map<string, THREE.BufferGeometry[]> = new Map();

    /** Maximum number of idle geometries kept per key. */
    private readonly maxDepth: number;

    private stats: PoolStats = {
        hits: 0,
        misses: 0,
        pooledCount: 0,
        peakDepth: 0,
        estimatedBytesSaved: 0,
    };

    /**
     * @param maxDepth Maximum idle geometries kept per key.  32 is a sensible
     *   default for typical chunk-streaming windows (≤ 16 visible chunks × 2
     *   geometry types per chunk).  Set lower to limit memory; set higher if
     *   you have many concurrent geometry types and hot reuse patterns.
     */
    constructor(maxDepth: number = 32) {
        this.maxDepth = maxDepth;
    }

    // -----------------------------------------------------------------------
    // Core API
    // -----------------------------------------------------------------------

    /**
     * Acquire a recycled geometry for `key`, or create a new one via `factory`
     * when the pool for that key is empty.
     *
     * @param key     Identifier shared by geometries of the same shape/size.
     * @param factory Called to construct a fresh geometry on a pool miss.
     */
    acquire(key: string, factory: () => THREE.BufferGeometry): THREE.BufferGeometry {
        const pool = this.pools.get(key);
        if (pool && pool.length > 0) {
            const geo = pool.pop()!;
            this.stats.hits++;
            this.stats.pooledCount--;
            this.stats.estimatedBytesSaved += this.estimateBytes(geo);
            return geo;
        }

        this.stats.misses++;
        return factory();
    }

    /**
     * Return a geometry to the pool for future reuse.
     *
     * The geometry is NOT disposed here; its TypedArray attributes are kept
     * alive so the next `acquire()` can overwrite them cheaply.  If the pool
     * for `key` is already at `maxDepth`, the geometry is disposed and
     * discarded to prevent unbounded memory growth.
     *
     * @param key Identifier that was used in the matching `acquire()` call.
     * @param geo The geometry to return.
     */
    release(key: string, geo: THREE.BufferGeometry): void {
        if (!geo) return;

        let pool = this.pools.get(key);
        if (!pool) {
            pool = [];
            this.pools.set(key, pool);
        }

        if (pool.length >= this.maxDepth) {
            // Pool is full — dispose and discard rather than leak memory.
            geo.dispose();
            return;
        }

        pool.push(geo);
        this.stats.pooledCount++;
        if (pool.length > this.stats.peakDepth) {
            this.stats.peakDepth = pool.length;
        }
    }

    // -----------------------------------------------------------------------
    // Maintenance
    // -----------------------------------------------------------------------

    /**
     * Dispose and remove all pooled geometries for a specific key.
     */
    flushKey(key: string): void {
        const pool = this.pools.get(key);
        if (!pool) return;
        for (const geo of pool) geo.dispose();
        this.stats.pooledCount -= pool.length;
        this.pools.delete(key);
    }

    /**
     * Dispose and remove all pooled geometries across every key.
     * Call this on a full scene reset or when navigating away.
     */
    flush(): void {
        for (const [, pool] of this.pools) {
            for (const geo of pool) geo.dispose();
        }
        this.pools.clear();
        this.stats.pooledCount = 0;
    }

    // -----------------------------------------------------------------------
    // Introspection
    // -----------------------------------------------------------------------

    /** Returns a snapshot of the current pool statistics. */
    getStats(): Readonly<PoolStats> {
        return { ...this.stats };
    }

    /** Returns the current depth of the pool for a given key. */
    getDepth(key: string): number {
        return this.pools.get(key)?.length ?? 0;
    }

    /** Returns all keys with at least one pooled geometry. */
    getActiveKeys(): string[] {
        return Array.from(this.pools.entries())
            .filter(([, p]) => p.length > 0)
            .map(([k]) => k);
    }

    /** Logs pool statistics to the console (debug helper). */
    logStats(): void {
        const s = this.getStats();
        const hitRate = s.hits + s.misses > 0
            ? ((s.hits / (s.hits + s.misses)) * 100).toFixed(1)
            : '0.0';
        console.log(
            `[GeometryPool] hits=${s.hits} misses=${s.misses} (${hitRate}% hit rate) ` +
            `pooled=${s.pooledCount} peakDepth=${s.peakDepth} ` +
            `saved≈${(s.estimatedBytesSaved / 1024 / 1024).toFixed(2)}MB`
        );
    }

    // -----------------------------------------------------------------------
    // Private helpers
    // -----------------------------------------------------------------------

    private estimateBytes(geo: THREE.BufferGeometry): number {
        let bytes = 0;
        for (const attr of Object.values(geo.attributes)) {
            if (attr instanceof THREE.BufferAttribute) {
                bytes += attr.array.byteLength;
            }
        }
        if (geo.index) {
            bytes += geo.index.array.byteLength;
        }
        return bytes;
    }
}

// ---------------------------------------------------------------------------
// Global singleton — use this unless you need an isolated pool scope.
// ---------------------------------------------------------------------------

/**
 * Maximum pooled geometries per key for the application-wide pool.
 * 32 covers the typical chunk-streaming window (≤ 16 visible chunks × 2 geometry
 * types per chunk) while preventing unbounded memory growth during burst unloads.
 * Tune this if the scene uses larger streaming windows.
 */
const DEFAULT_MAX_POOL_DEPTH = 32;

/** Application-wide geometry pool. */
export const globalGeometryPool = new GeometryPool(DEFAULT_MAX_POOL_DEPTH);
