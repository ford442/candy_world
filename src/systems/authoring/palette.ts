/**
 * @file src/systems/authoring/palette.ts
 * @brief What build mode can place, grouped for the palette strip, and the paint colours.
 *
 * Generated from the foliage registry's types (`world/foliage-registry.ts`),
 * so a new species shows up without touching this file: unknown types fall
 * into `music` when the registry marks them `supportsMusic`, else `props`.
 * Pure: no DOM, no Three.js.
 */

export type PaletteCategory = 'mushrooms' | 'trees' | 'flowers' | 'lights' | 'music' | 'props';

export const PALETTE_CATEGORIES: ReadonlyArray<{
    id: PaletteCategory;
    label: string;
    icon: string;
}> = [
    { id: 'mushrooms', label: 'Mushrooms', icon: '🍄' },
    { id: 'trees', label: 'Trees', icon: '🌳' },
    { id: 'flowers', label: 'Flowers', icon: '🌸' },
    { id: 'lights', label: 'Lights', icon: '🏮' },
    { id: 'music', label: 'Music objects', icon: '🎵' },
    { id: 'props', label: 'Props', icon: '🧸' },
];

const CATEGORY_OF: Readonly<Record<string, PaletteCategory>> = {
    mushroom: 'mushrooms',
    glass_mushroom: 'mushrooms',
    retrigger_mushroom: 'mushrooms',
    gem_canopy_tree: 'trees',
    portamento_pine: 'trees',
    accordion_palm: 'trees',
    fiber_optic_willow: 'trees',
    bubble_willow: 'trees',
    wisteria_cluster: 'trees',
    balloon_bush: 'trees',
    prism_rose_bush: 'trees',
    flower: 'flowers',
    tremolo_tulip: 'flowers',
    starflower: 'flowers',
    vibrato_violet: 'flowers',
    cymbal_dandelion: 'flowers',
    arpeggio_fern: 'flowers',
    helix_plant: 'flowers',
    subwoofer_lotus: 'flowers',
    luminous_plant: 'lights',
    floating_orb: 'lights',
    night_market_stall: 'lights',
    kick_drum_geyser: 'music',
    instrument_shrine: 'music',
    melody_mirror: 'music',
    snare_trap: 'music',
    panning_pad: 'music',
    silence_spirit: 'music',
    swingable_vine: 'props',
    vine_ladder: 'props',
};

const ICON_OF: Readonly<Record<string, string>> = {
    mushroom: '🍄',
    glass_mushroom: '🔮',
    retrigger_mushroom: '🔁',
    gem_canopy_tree: '💎',
    portamento_pine: '🌲',
    accordion_palm: '🌴',
    fiber_optic_willow: '✨',
    bubble_willow: '🫧',
    wisteria_cluster: '🍇',
    balloon_bush: '🎈',
    prism_rose_bush: '🌹',
    flower: '🌼',
    tremolo_tulip: '🌷',
    starflower: '⭐',
    vibrato_violet: '💜',
    cymbal_dandelion: '🌾',
    arpeggio_fern: '🌿',
    helix_plant: '🧬',
    subwoofer_lotus: '🪷',
    luminous_plant: '💡',
    floating_orb: '🔆',
    night_market_stall: '🏮',
    kick_drum_geyser: '⛲',
    instrument_shrine: '⛩️',
    melody_mirror: '🪞',
    snare_trap: '🥁',
    panning_pad: '🎚️',
    silence_spirit: '👻',
    swingable_vine: '🪢',
    vine_ladder: '🪜',
};

/**
 * Not offered to players: clouds and sky islands float at authored heights,
 * caves carry physics volumes and a waterfall proxy, grass is a GPU field.
 */
export const PLAYER_EXCLUDED_TYPES: ReadonlySet<string> = new Set([
    'cloud',
    'sky_island',
    'cave',
    'grass',
]);

/** Types whose factory honours `params.color` (see PaintCommand). */
export const PAINTABLE_TYPES: ReadonlySet<string> = new Set([
    'mushroom',
    'accordion_palm',
    'night_market_stall',
]);

export interface PaletteEntry {
    type: string;
    label: string;
    icon: string;
    category: PaletteCategory;
    paintable: boolean;
    /**
     * Map-record fields a fresh placement starts with. Anything
     * `processMapEntity` would otherwise roll at random (a mushroom's face) is
     * fixed here, so replaying the document rebuilds the same entity.
     */
    defaults: { variant?: string; hasFace?: boolean; params: Record<string, unknown> };
}

export function labelFor(type: string): string {
    const words = type.split('_').join(' ');
    return words.charAt(0).toUpperCase() + words.slice(1);
}

const DEFAULTS_OF: Readonly<Record<string, PaletteEntry['defaults']>> = {
    mushroom: { variant: 'regular', hasFace: false, params: {} },
};

/**
 * Build the palette from registered types, in category order then label
 * order. `supportsMusic(type)` comes from the registry's type metadata.
 */
export function buildPalette(
    types: readonly string[],
    supportsMusic: (type: string) => boolean = () => false
): PaletteEntry[] {
    const entries: PaletteEntry[] = [];
    for (const type of new Set(types)) {
        if (PLAYER_EXCLUDED_TYPES.has(type)) continue;
        const category = CATEGORY_OF[type] ?? (supportsMusic(type) ? 'music' : 'props');
        entries.push({
            type,
            label: labelFor(type),
            icon: ICON_OF[type] ?? '🍬',
            category,
            paintable: PAINTABLE_TYPES.has(type),
            defaults: DEFAULTS_OF[type] ?? { params: {} },
        });
    }
    const order = PALETTE_CATEGORIES.map((c) => c.id);
    return entries.sort(
        (a, b) =>
            order.indexOf(a.category) - order.indexOf(b.category) || a.label.localeCompare(b.label)
    );
}

// ---------------------------------------------------------------------------
// Paint palette
// ---------------------------------------------------------------------------

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

/** HSL of a 0xRRGGBB colour, each in [0, 1]. */
export function hexToHsl(hex: number): { h: number; s: number; l: number } {
    const r = ((hex >> 16) & 0xff) / 255;
    const g = ((hex >> 8) & 0xff) / 255;
    const b = (hex & 0xff) / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const l = (max + min) / 2;
    if (max === min) return { h: 0, s: 0, l };
    const d = max - min;
    const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    let h: number;
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    return { h: h / 6, s, l };
}
