/**
 * Loading Manager
 *
 * Centralized progress tracker for all loading phases and subtasks.
 * Acts as the single source of truth for loading state.
 */

import { DEFAULT_LOADING_PHASES } from '../ui/loading-screen';

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
            totalSubTasks: options.totalSubTasks || 100, // Default to 100% style if not specified
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
            this.activeTaskId = null; // Will be set by next startTask
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
        // Treat skipped task as having half its weight completed, matching legacy logic
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
     * Calculates overall weighted progress (0 to 100).
     */
    getOverallProgress(): number {
        if (this.totalWeight === 0) return 0;

        let currentCompletedWeight = this.completedWeights;

        // Add partial progress from active task
        if (this.activeTaskId) {
            const activeTask = this.tasks.get(this.activeTaskId);
            if (activeTask && activeTask.status === 'active') {
                currentCompletedWeight += activeTask.weight * (activeTask.percentComplete / 100);
            }
        }

        return (currentCompletedWeight / this.totalWeight) * 100;
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
            // Moving average
            this.averageTaskTimeMs = (this.averageTaskTimeMs * 0.7) + (normalizedTime * 0.3);
        }
    }

    private emitProgress(): void {
        const activeTask = this.activeTaskId ? this.tasks.get(this.activeTaskId) : null;

        const state: GlobalProgressState = {
            overallPercent: this.getOverallProgress(),
            activeTaskId: this.activeTaskId,
            activeTaskName: activeTask ? activeTask.name : null,
            activeTaskDescription: activeTask ? activeTask.description : null,
            estimatedTimeRemaining: this.getEstimatedTimeRemaining()
        };

        for (let i = 0; i < this.onProgressCallbacks.length; i++) this.onProgressCallbacks[i](state, this.tasks);
    }

    private emitPhaseChange(): void {
        for (let i = 0; i < this.onPhaseChangeCallbacks.length; i++) this.onPhaseChangeCallbacks[i](this.activeTaskId);
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
