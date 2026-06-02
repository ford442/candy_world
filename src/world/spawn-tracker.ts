export interface SpawnTypeStats {
    attempted: number;
    succeeded: number;
    failed: number;
}

export interface SpawnFailureEntry {
    type: string;
    context: string;
    message: string;
}

export interface WorldPopulationReport {
    attemptCount: number;
    successCount: number;
    failCount: number;
    byType: Record<string, SpawnTypeStats>;
    errors: SpawnFailureEntry[];
}

const MAX_ERROR_ENTRIES = 25;

class SpawnTracker {
    private report: WorldPopulationReport = this.createEmptyReport();

    reset(): void {
        this.report = this.createEmptyReport();
        this.publish();
    }

    recordAttempt(type: string): void {
        const safeType = this.normalizeType(type);
        this.report.attemptCount++;
        this.ensureTypeStats(safeType).attempted++;
        this.publish();
    }

    recordSuccess(type: string): void {
        const safeType = this.normalizeType(type);
        this.report.successCount++;
        this.ensureTypeStats(safeType).succeeded++;
        this.publish();
    }

    recordFailure(
        type: string,
        error: unknown,
        options?: { context?: string; countAttempt?: boolean }
    ): void {
        const safeType = this.normalizeType(type);
        if (options?.countAttempt) {
            this.report.attemptCount++;
            this.ensureTypeStats(safeType).attempted++;
        }

        this.report.failCount++;
        this.ensureTypeStats(safeType).failed++;
        this.report.errors.push({
            type: safeType,
            context: options?.context ?? 'spawn',
            message: this.toErrorMessage(error),
        });
        if (this.report.errors.length > MAX_ERROR_ENTRIES) {
            this.report.errors.splice(0, this.report.errors.length - MAX_ERROR_ENTRIES);
        }
        this.publish();
    }

    getReport(): WorldPopulationReport {
        return {
            attemptCount: this.report.attemptCount,
            successCount: this.report.successCount,
            failCount: this.report.failCount,
            byType: Object.fromEntries(
                Object.entries(this.report.byType).map(([type, stats]) => [type, { ...stats }])
            ),
            errors: this.report.errors.map(entry => ({ ...entry })),
        };
    }

    private ensureTypeStats(type: string): SpawnTypeStats {
        if (!this.report.byType[type]) {
            this.report.byType[type] = { attempted: 0, succeeded: 0, failed: 0 };
        }
        return this.report.byType[type];
    }

    private createEmptyReport(): WorldPopulationReport {
        return {
            attemptCount: 0,
            successCount: 0,
            failCount: 0,
            byType: {},
            errors: [],
        };
    }

    private toErrorMessage(error: unknown): string {
        if (error instanceof Error) return error.message;
        if (typeof error === 'string') return error;
        try {
            return JSON.stringify(error);
        } catch {
            return String(error);
        }
    }

    private normalizeType(type: string): string {
        const trimmed = type.trim();
        return trimmed.length > 0 ? trimmed : 'unknown';
    }

    private publish(): void {
        if (typeof window !== 'undefined') {
            window.__worldPopulationReport = this.getReport();
        }
    }
}

export const spawnTracker = new SpawnTracker();

export function resetSpawnTracker(): void {
    spawnTracker.reset();
}

declare global {
    interface Window {
        __worldPopulationReport?: WorldPopulationReport;
    }
}
