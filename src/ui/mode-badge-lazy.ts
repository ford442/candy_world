/**
 * Lazy mode badge UI — renderer / world mode badges after scene boot.
 */
import type { StartupProfile } from '../core/startup-profile.ts';
import type { WorldMode } from './mode-badge.ts';

export function showModeBadge(label: WorldMode, profile?: StartupProfile): void {
    void import('./mode-badge.ts').then((m) => m.showModeBadge(label, profile));
}

export function showRendererBadge(
    activeBackend: 'webgpu' | 'webgl',
    requested: 'webgpu' | 'webgl',
    fallbackReason: string | null = null
): void {
    void import('./mode-badge.ts').then((m) =>
        m.showRendererBadge(activeBackend, requested, fallbackReason)
    );
}
