/**
 * Lazy mode badge UI — renderer / world mode badges after scene boot.
 */
export function showModeBadge(label: string): void {
    void import('./mode-badge.ts').then((m) => m.showModeBadge(label));
}

export function showRendererBadge(renderer: string, reason?: string): void {
    void import('./mode-badge.ts').then((m) => m.showRendererBadge(renderer, reason));
}
