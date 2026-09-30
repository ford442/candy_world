/**
 * Boot-progress reporting for modules below the UI (#1827 Part C.2).
 *
 * The WASM loader and world generation report here instead of importing
 * ui/loading-screen.ts. That import made utils/ and world/ depend on the UI,
 * and the loading screen's own imports led back into the loader, which put
 * more than 20 modules in one cycle.
 *
 * core/main/loading-bootstrap.ts installs the loading screen as the reporter
 * when it is evaluated. `src/main.ts` reaches it statically, so that happens
 * before any boot code runs. Until then, and in Node tests, reports are dropped.
 *
 * Keep this module a leaf: no imports.
 */

export interface BootProgressReporter {
    /** Start `phaseId` if it is not the current phase, then set its percent. */
    updateProgress(phaseId: string, percent: number, taskDescription?: string): void;
    setWasmPhase(label: string, progress?: number): void;
    /** Fatal: the loading screen shows it with a reload button. */
    setWasmError(message: string): void;
}

const noop = (): void => {};

export const bootProgress: BootProgressReporter = {
    updateProgress: noop,
    setWasmPhase: noop,
    setWasmError: noop,
};

export function setBootProgressReporter(reporter: BootProgressReporter): void {
    Object.assign(bootProgress, reporter);
}
