/**
 * Lazy stub for the blocking "no WebGPU / WebGL2" screen. It only shows when
 * boot has already failed, so its DOM and diagnostics stay out of `app`.
 */
import { markBootFatal } from './boot-fatal.ts';

export function showWebGPUFatalScreenLazy(error: unknown): void {
    // Mark the boot fatal now: the screen arrives a tick later.
    markBootFatal();
    void import('./webgpu-fatal.ts').then((m) => m.showWebGPUFatalScreen(error));
}
