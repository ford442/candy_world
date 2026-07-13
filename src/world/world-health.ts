/**
 * World Health Validator
 *
 * Called once after `worldFullyPopulated` to verify that expected scene
 * objects actually landed.  All data comes from already-maintained counters
 * (SpawnTracker, state arrays, batcher telemetry) — no scene traversal.
 *
 * Exposes:
 *   window.__worldHealth  — live report for devtools / tests
 *   CustomEvent 'worldHealth' on document — detail = WorldHealthReport
 */

import { getReport as getSpawnReport } from './spawn-tracker.ts';
import {
    animatedFoliage,
    interactiveObjects,
    foliageMushrooms,
    foliageClouds,
    foliageGeysers,
    foliageTraps,
    foliageVineLadders,
    foliageTrampolines,
    foliagePanningPads,
    foliagePortamentoPines,
} from './state.ts';

export interface WorldHealthBatcherEntry {
    id: string;
    label: string;
    instances: number;
}

export interface WorldHealthReport {
    /** WorldMode that was active when the report was taken. */
    mode: string;
    /** Millisecond timestamp. */
    ts: number;

    // ---- spawn-tracker totals ----
    attempted: number;
    succeeded: number;
    failed: number;
    failuresByType: Record<string, number>;

    // ---- live scene counts (O(1) array reads) ----
    sceneObjects: {
        animatedFoliage: number;
        interactive: number;
        mushrooms: number;
        clouds: number;
        geysers: number;
        traps: number;
        vineLadders: number;
        trampolines: number;
        panningPads: number;
        portamentoPines: number;
    };

    // ---- batcher instance counts ----
    batchers: {
        totalInstances: number;
        entries: WorldHealthBatcherEntry[];
    };

    // ---- derived health signals ----
    warnings: string[];
    healthy: boolean;
}

/** Minimum objects we expect to see in a healthy FULL-mode scene. */
const FULL_MODE_MINIMUMS: Partial<Record<keyof WorldHealthReport['sceneObjects'], number>> = {
    animatedFoliage: 50,
    mushrooms: 5,
    clouds: 3,
};

/** Fraction of attempted spawns that may fail before we flag unhealthy. */
const FAILURE_RATE_THRESHOLD = 0.05; // 5 %

export function validateWorldPopulation(mode: string = 'UNKNOWN'): WorldHealthReport {
    const spawn = getSpawnReport();

    const sceneObjects: WorldHealthReport['sceneObjects'] = {
        animatedFoliage:  animatedFoliage.length,
        interactive:      interactiveObjects.length,
        mushrooms:        foliageMushrooms.length,
        clouds:           foliageClouds.length,
        geysers:          foliageGeysers.length,
        traps:            foliageTraps.length,
        vineLadders:      foliageVineLadders.length,
        trampolines:      foliageTrampolines.length,
        panningPads:      foliagePanningPads.length,
        portamentoPines:  foliagePortamentoPines.length,
    };

    // Batcher telemetry — lazy import keeps the health check self-contained;
    // fall back gracefully if the module hasn't loaded yet.
    let batcherEntries: WorldHealthBatcherEntry[] = [];
    let batcherTotal = 0;
    try {
        // collectBatcherTelemetry is synchronous; import is evaluated at module parse
        // time via top-level import in batcher-telemetry — we call via the window
        // shim that installBatcherTelemetry() registered so we avoid a circular dep.
        const telem = (typeof window !== 'undefined' && (window as any).__getBatcherTelemetry)
            ? (window as any).__getBatcherTelemetry() as { totalInstances: number; entries: Array<{ id: string; label: string; instances: number }> }
            : null;
        if (telem) {
            batcherTotal = telem.totalInstances;
            batcherEntries = telem.entries.map(e => ({ id: e.id, label: e.label, instances: e.instances }));
        }
    } catch { /* telemetry not available — non-fatal */ }

    const warnings: string[] = [];

    // 1. Spawn failures
    if (spawn.failed > 0) {
        const rate = spawn.attempted > 0 ? spawn.failed / spawn.attempted : 0;
        const pct = (rate * 100).toFixed(1);
        warnings.push(`${spawn.failed} spawn failure(s) (${pct}% of ${spawn.attempted} attempted). Types: ${Object.entries(spawn.failuresByType).map(([k, v]) => `${k}:${v}`).join(', ')}`);
    }

    // 2. Under-count checks (only meaningful in FULL mode)
    if (mode === 'FULL' || mode === 'FAST_FULL') {
        for (const [key, min] of Object.entries(FULL_MODE_MINIMUMS) as [keyof typeof FULL_MODE_MINIMUMS, number][]) {
            const actual = sceneObjects[key];
            if (actual < min) {
                warnings.push(`Expected ≥${min} ${key}, found ${actual}.`);
            }
        }
    }

    // 3. Excessive failure rate
    const failureRate = spawn.attempted > 0 ? spawn.failed / spawn.attempted : 0;
    if (spawn.attempted > 10 && failureRate > FAILURE_RATE_THRESHOLD) {
        warnings.push(`Spawn failure rate ${(failureRate * 100).toFixed(1)}% exceeds ${FAILURE_RATE_THRESHOLD * 100}% threshold.`);
    }

    const healthy = warnings.length === 0;

    const report: WorldHealthReport = {
        mode,
        ts: Date.now(),
        attempted: spawn.attempted,
        succeeded: spawn.succeeded,
        failed: spawn.failed,
        failuresByType: { ...spawn.failuresByType },
        sceneObjects,
        batchers: { totalInstances: batcherTotal, entries: batcherEntries },
        warnings,
        healthy,
    };

    // Publish to window for devtools / smoke tests
    try { (window as any).__worldHealth = report; } catch { /* SSR / node */ }

    // Log summary
    if (healthy) {
        console.log(
            `[WorldHealth] ✓ ${mode} | ${spawn.succeeded}/${spawn.attempted} spawned` +
            ` | foliage=${sceneObjects.animatedFoliage} interactive=${sceneObjects.interactive}` +
            ` | batchers=${batcherTotal} instances`
        );
    } else {
        console.warn('[WorldHealth] ⚠ Warnings after population:');
        warnings.forEach(w => console.warn(`  • ${w}`));
    }
    console.debug('[WorldHealth] Full report:', report);

    // Dispatch event so tests / systems can react
    try {
        document.dispatchEvent(new CustomEvent('worldHealth', { detail: report }));
    } catch { /* non-browser */ }

    return report;
}
