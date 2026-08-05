/**
 * Lazy mode badge UI — renderer / world mode badges after scene boot.
 */
import type { WorldMode } from './mode-badge.ts';

export function showModeBadge(label: WorldMode): void {
    void import('./mode-badge.ts').then((m) => m.showModeBadge(label));
}

export function showRendererBadge(
    activeBackend: 'webgpu' | 'webgl',
    requested: 'webgpu' | 'webgl',
    fallbackReason: string | null = null,
): void {
    void import('./mode-badge.ts').then((m) => m.showRendererBadge(activeBackend, requested, fallbackReason));
}
