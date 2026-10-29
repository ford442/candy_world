/**
 * @file src/world/document/paint-palette.ts
 * @brief The paint colours a world may use, shared by build mode, the shared
 * world validator and the co-editing guardrails. A leaf with no imports, so
 * the `validate-world` edge function can load it too.
 */

/**
 * Recolours are limited to these. Every entry is a saturated pastel by the
 * rules in docs/CANDY_AESTHETIC_GUARDRAILS.md (HSL saturation ≥ 0.25,
 * lightness 0.4–0.95); tests/build-mode.test.ts holds them to it.
 */
export const CANDY_PAINT_PALETTE: ReadonlyArray<{ name: string; hex: number }> = [
    { name: 'Hot pink', hex: 0xff69b4 },
    { name: 'Blush', hex: 0xffd1dc },
    { name: 'Peach', hex: 0xffb38a },
    { name: 'Butter', hex: 0xffe68a },
    { name: 'Mint', hex: 0x98fb98 },
    { name: 'Sky', hex: 0x87cefa },
    { name: 'Lavender', hex: 0xc3b1e1 },
    { name: 'Lilac', hex: 0xe0b0ff },
];

export function isCandyPaint(hex: unknown): hex is number {
    return typeof hex === 'number' && CANDY_PAINT_PALETTE.some((c) => c.hex === hex);
}

/** The palette entry closest to `hex` in RGB (the co-editing palette clamp). */
export function nearestCandyPaint(hex: number): number {
    const r = (hex >> 16) & 0xff;
    const g = (hex >> 8) & 0xff;
    const b = hex & 0xff;
    let best = CANDY_PAINT_PALETTE[0].hex;
    let bestDist = Infinity;
    for (const { hex: c } of CANDY_PAINT_PALETTE) {
        const dr = ((c >> 16) & 0xff) - r;
        const dg = ((c >> 8) & 0xff) - g;
        const db = (c & 0xff) - b;
        const dist = dr * dr + dg * dg + db * db;
        if (dist < bestDist) {
            bestDist = dist;
            best = c;
        }
    }
    return best;
}
