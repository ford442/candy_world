/**
 * Lazy cloud placer — dev console API loads on first init (after world enter).
 */
import type { CloudPlacerInitOptions } from './cloud-placer.ts';

export function initCloudPlacer(options: CloudPlacerInitOptions): void {
    void import('./cloud-placer.ts').then((m) => m.initCloudPlacer(options));
}
