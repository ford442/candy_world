/**
 * Loading Manager
 *
 * Centralized progress tracker for all loading phases and subtasks.
 * Acts as the single source of truth for loading state — including the
 * post-interactive deferred population phase driven by BackgroundProcessor.
 */

import { DEFAULT_LOADING_PHASES } from '../ui/loading-screen-types';

export interface LoadingTaskOptions {
    id: string;
    name: string;
    weight: number; // Relative importance/time cost (0-1 typically)
    description?: string;
    totalSubTasks?: number;
    isDeferred?: boolean;
}

export interface TaskState {
    id: string;
    name: string;
    weight: number;
    description: string;
    totalSubTasks: number;
    completedSubTasks: number;
    percentComplete: number; // 0 to 100
    isDeferred: boolean;
    startTime: number;
    endTime: number;
    status: 'pending' | 'active' | 'completed' | 'error' | 'skipped';
}

export interface GlobalProgressState {
    overallPercent: number; // 0 to 100
    activeTaskId: string | null;
    activeTaskName: string | null;
    activeTaskDescription: string | null;
    estimatedTimeRemaining: number; // seconds
    // Deferred / post-interactive population progress
    deferredCompleted: number;
    deferredTotal: number;
    deferredFailed: number;
    deferredPercent: number; // 0-100, 0 if not started
    deferredEtaMs: number;  // -1 = unknown, 0 = done, >0 = ms remaining
}

export type ProgressCallback = (state: GlobalProgressState, tasks: Map<string, TaskState>) => void;
export type PhaseChangeCallback = (activeTaskId: string | null) => void;

export class LoadingManager {
    private tasks: Map<string, TaskState> = new Map();
    private taskOrder: string[] = [];
    private activeTaskId: string | null = null;

    // Callbacks
    private onProgressCallbacks: Set<ProgressCallback> = new Set();
    private onPhaseChangeCallbacks: Set<PhaseChangeCallback> = new Set();

    // Timing stats
    private averageTaskTimeMs: number = 0;
    private completedWeights: number = 0;
    private totalWeight: number = 0;
    private globalStartTime: number = 0;

    // Deferred population state (driven by BackgroundProcessor)
    private deferredCompleted: number = 0;
    private deferredTotal: number = 0;
    private deferredFailed: number = 0;
    private deferredEtaMs: number = -1;

    constructor() {}

    /**
     * Register a new task/phase.
     */
    registerTask(options: LoadingTaskOptions): void {
        const state: TaskState = {
            id: options.id,
            name: options.name,
            weight: options.weight,
            description: options.description || '',
            totalSubTasks: options.totalSubTasks || 100,
            completedSubTasks: 0,
            percentComplete: 0,
            isDeferred: options.isDeferred || false,
            startTime: 0,
            endTime: 0,
            status: 'pending'
        };

        this.tasks.set(options.id, state);
        this.taskOrder.push(options.id);
        this.totalWeight += options.weight;
    }

    /**
     * Starts a task, marking it as active.
     */
    startTask(id: string): void {
        const task = this.tasks.get(id);
        if (!task) {
            console.warn(`[LoadingManager] Cannot start unknown task: ${id}`);
            return;
        }

        if (this.globalStartTime === 0) {
            this.globalStartTime = performance.now();
        }

        task.status = 'active';
        task.startTime = performance.now();
        this.activeTaskId = id;

        this.emitPhaseChange();
        this.emitProgress();
    }

    /**
     * Report progress for a task directly (e.g. 0 to 100) or by subtasks.
     */
    reportProgress(id: string, completed: number, total?: number, description?: string): void {
        const task = this.tasks.get(id);
        if (!task) return;

        if (total !== undefined) {
            task.totalSubTasks = total;
        }

        task.completedSubTasks = Math.min(completed, task.totalSubTasks);
        task.percentComplete = task.totalSubTasks > 0
            ? (task.completedSubTasks / task.totalSubTasks) * 100
            : 100;

        if (description) {
            task.description = description;
        }

        if (task.status !== 'active' && task.status !== 'completed') {
            this.startTask(id);
        }

        this.emitProgress();
    }

    /**
     * Increment the subtask count for a task.
     */
    incrementSubtask(id: string, amount: number = 1, description?: string): void {
        const task = this.tasks.get(id);
        if (!task) return;

        this.reportProgress(id, task.completedSubTasks + amount, task.totalSubTasks, description);
    }

    /**
     * Marks a task as complete.
     */
    completeTask(id: string): void {
        const task = this.tasks.get(id);
        if (!task) return;

        task.status = 'completed';
        task.completedSubTasks = task.totalSubTasks;
        task.percentComplete = 100;
        task.endTime = performance.now();

        this.completedWeights += task.weight;
        this.updateAverageTime(task.endTime - task.startTime, task.weight);

        if (this.activeTaskId === id) {
            this.activeTaskId = null;
        }

        this.emitProgress();
    }

    /**
     * Skips a deferred task.
     */
    skipTask(id: string): void {
        const task = this.tasks.get(id);
        if (!task || !task.isDeferred) {
            console.warn(`[LoadingManager] Cannot skip task: ${id}`);
            return;
        }

        task.status = 'skipped';
        task.endTime = performance.now();
        this.completedWeights += task.weight * 0.5;

        if (this.activeTaskId === id) {
            this.activeTaskId = null;
        }

        this.emitProgress();
    }

    /**
     * Updates the task description
     */
    setTaskDescription(id: string, description: string): void {
        const task = this.tasks.get(id);
        if (task) {
            task.description = description;
            this.emitProgress();
        }
    }

    /**
     * Report progress from BackgroundProcessor for the post-interactive
     * deferred population phase.  This drives both the HUD indicator and any
     * 'deferred-population' task registered in the phase list.
     *
     * @param completed  Tasks completed so far (success + failed)
     * @param total      Total tasks enqueued
     * @param failed     Tasks that threw during execution
     */
    reportDeferredProgress(completed: number, total: number, failed: number = 0, etaMs: number = -1): void {
        this.deferredCompleted = completed;
        this.deferredTotal = total;
        this.deferredFailed = failed;
        this.deferredEtaMs = etaMs;

        // Also drive any registered 'deferred-population' task
        const task = this.tasks.get('deferred-population');
        if (task && task.status !== 'completed' && task.status !== 'skipped') {
            const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
            const failLabel = failed > 0 ? ` (${failed} failed)` : '';
            this.reportProgress(
                'deferred-population',
                completed,
                total,
                `Populating horizon: ${completed}/${total}${failLabel}`
            );
            return; // reportProgress already emits
        }

        this.emitProgress();
    }

    /**
     * Calculates overall weighted progress (0 to 100).
     */
    getOverallProgress(): number {
        if (this.totalWeight === 0) return 0;

        let currentCompletedWeight = this.completedWeights;

        if (this.activeTaskId) {
            const activeTask = this.tasks.get(this.activeTaskId);
            if (activeTask && activeTask.status === 'active') {
                currentCompletedWeight += activeTask.weight * (activeTask.percentComplete / 100);
            }
        }

        return (currentCompletedWeight / this.totalWeight) * 100;
    }

    /**
     * Deferred population percent (0–100). 0 if not started.
     */
    getDeferredPercent(): number {
        return this.deferredTotal > 0
            ? Math.min(100, Math.round((this.deferredCompleted / this.deferredTotal) * 100))
            : 0;
    }

    /**
     * Calculates estimated time remaining in seconds.
     */
    getEstimatedTimeRemaining(): number {
        if (this.averageTaskTimeMs === 0 || this.totalWeight === 0) return -1;

        let remainingWeight = this.totalWeight - this.completedWeights;

        if (this.activeTaskId) {
            const activeTask = this.tasks.get(this.activeTaskId);
            if (activeTask && activeTask.status === 'active') {
                remainingWeight -= activeTask.weight * (activeTask.percentComplete / 100);
            }
        }

        const estimatedMs = remainingWeight * this.averageTaskTimeMs;
        return Math.max(0, Math.ceil(estimatedMs / 1000));
    }

    private updateAverageTime(durationMs: number, weight: number): void {
        if (weight <= 0) return;
        const normalizedTime = durationMs / weight;

        if (this.averageTaskTimeMs === 0) {
            this.averageTaskTimeMs = normalizedTime;
        } else {
            this.averageTaskTimeMs = (this.averageTaskTimeMs * 0.7) + (normalizedTime * 0.3);
        }
    }

    private emitProgress(): void {
        if (this.onProgressCallbacks.size === 0) return;

        const activeTask = this.activeTaskId ? this.tasks.get(this.activeTaskId) : null;
        const state: GlobalProgressState = {
            overallPercent: this.getOverallProgress(),
            activeTaskId: this.activeTaskId,
            activeTaskName: activeTask ? activeTask.name : null,
            activeTaskDescription: activeTask ? activeTask.description : null,
            estimatedTimeRemaining: this.getEstimatedTimeRemaining(),
            deferredCompleted: this.deferredCompleted,
            deferredTotal: this.deferredTotal,
            deferredFailed: this.deferredFailed,
            deferredPercent: this.getDeferredPercent(),
            deferredEtaMs: this.deferredEtaMs,
        };

        for (const cb of this.onProgressCallbacks) cb(state, this.tasks);
    }

    private emitPhaseChange(): void {
        for (const cb of this.onPhaseChangeCallbacks) cb(this.activeTaskId);
    }

    // Event subscription
    onProgress(cb: ProgressCallback): () => void {
        this.onProgressCallbacks.add(cb);
        return () => this.onProgressCallbacks.delete(cb);
    }

    onPhaseChange(cb: PhaseChangeCallback): () => void {
        this.onPhaseChangeCallbacks.add(cb);
        return () => this.onPhaseChangeCallbacks.delete(cb);
    }

    // Getters
    getTask(id: string): TaskState | undefined {
        return this.tasks.get(id);
    }

    getAllTasks(): TaskState[] {
        return this.taskOrder.map(id => this.tasks.get(id)!);
    }
}

export const globalLoadingManager = new LoadingManager();
