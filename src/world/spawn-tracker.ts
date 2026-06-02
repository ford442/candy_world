/**
 * Spawn Tracker
 *
 * Lightweight, zero-allocation-on-success counters for map entity and procedural
 * object instantiation success/failure rates. Used to surface visible diagnostics
 * when background / deferred population does not produce the full expected scene.
 *
 * Wires into:
 *  - processMapEntity catch (generation-core.ts)
 *  - procedural extras catch (generation-decorators.ts)
 *  - BackgroundProcessor error path (for world-spawn tasks)
 *
 * Exposes:
 *  - recordSpawnAttempt(type, success, error?)
 *  - getReport()
 *  - reset()
 *  - window.__spawnReport (populated on demand / updates)
 *
 * Designed to be safe to call from hot paths (simple increments).
 */

export interface SpawnReport {
    attempted: number;
    succeeded: number;
    failed: number;
    failuresByType: Record<string, number>;
    lastErrors: Array<{ type: string; message: string; ts: number }>;
}

const MAX_LAST_ERRORS = 8;

let attempted = 0;
let succeeded = 0;
let failed = 0;
const failuresByType: Record<string, number> = Object.create(null);
const lastErrors: SpawnReport['lastErrors'] = [];

let lastReport: SpawnReport | null = null;
let dirty = true;

function makeReport(): SpawnReport {
    return {
        attempted,
        succeeded,
        failed,
        failuresByType: { ...failuresByType },
        lastErrors: lastErrors.slice(), // small copy is fine
    };
}

export function recordSpawnAttempt(type: string, success: boolean, error?: unknown): void {
    attempted++;
    const key = type || 'unknown';

    if (success) {
        succeeded++;
    } else {
        failed++;
        failuresByType[key] = (failuresByType[key] || 0) + 1;

        let msg = 'unknown error';
        if (error instanceof Error) {
            msg = error.message || error.toString();
        } else if (error != null) {
            msg = String(error);
        }
        lastErrors.push({ type: key, message: msg.slice(0, 200), ts: Date.now() });
        if (lastErrors.length > MAX_LAST_ERRORS) {
            lastErrors.shift();
        }
    }

    dirty = true;

    // Keep a live global for easy inspection / tests (no getter cost on happy path)
    try {
        (window as any).__spawnReport = getReport();
    } catch {
        // non-browser or no window — ignore
    }
}

export function getReport(): SpawnReport {
    if (!dirty && lastReport) return lastReport;
    lastReport = makeReport();
    dirty = false;
    return lastReport;
}

export function reset(): void {
    attempted = 0;
    succeeded = 0;
    failed = 0;
    for (const k of Object.keys(failuresByType)) delete failuresByType[k];
    lastErrors.length = 0;
    lastReport = null;
    dirty = true;

    try {
        delete (window as any).__spawnReport;
    } catch { /* ignore */ }
}

/**
 * Helper for background-processor style errors when the task id looks like a world spawn.
 */
export function maybeRecordBackgroundFailure(taskId: string, error: unknown): boolean {
    if (!taskId) return false;
    // Heuristic: map_stream_*, map_fallback_*, proc_extra_*, world spawn tasks
    if (
        taskId.startsWith('map_stream_') ||
        taskId.startsWith('map_fallback_') ||
        taskId.startsWith('proc_') ||
        taskId.includes('spawn') ||
        taskId.includes('foliage')
    ) {
        // Extract a friendly type
        const m = taskId.match(/(?:map_stream_|map_fallback_|proc_)([a-z0-9_]+)/i);
        const t = m ? m[1] : taskId.split('_').pop() || 'background';
        recordSpawnAttempt(t, false, error);
        return true;
    }
    return false;
}

// For tests / manual reset in console
try {
    (window as any).__resetSpawnReport = reset;
} catch { /* ignore */ }
