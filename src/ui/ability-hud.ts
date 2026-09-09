/**
 * Ability HUD — first production surface built on the Candy UI Kit.
 *
 * Previously hand-written markup in index.html plus ad-hoc DOM pokes in
 * src/core/hud.ts. The DOM contract (ids, classes, roles, aria-keyshortcuts)
 * is unchanged so existing CSS, input wiring (src/core/input/input/hud-setup.ts)
 * and the accessibility tests keep working.
 *
 * 🖱️ Pointer lock: the slots ARE interactive, so this panel is not inert.
 * `isInteractiveTarget()` in src/core/input/input/menu-helpers.ts lists
 * `#ability-hud`, which keeps a HUD click from re-acquiring the lock, and
 * hud-setup stops propagation on pointerdown. See docs/UI_KIT.md.
 */

import {
    attachTooltip,
    createMeter,
    createPanel,
    createShortcutHint,
    el,
    type Meter,
    type Panel,
    type ShortcutHint,
    type Tooltip,
} from './kit/index.ts';

// ============================================================================
// Slot
// ============================================================================

export interface AbilitySlotOptions {
    id: string;
    /** Name without the key suffix, e.g. "Dash". */
    name: string;
    /** Display key, e.g. "E". */
    key: string;
    icon: string;
    /** Render an ammo/charge badge. */
    badge?: boolean;
    /** Support the aria-pressed "duration running" state. */
    toggle?: boolean;
    hidden?: boolean;
}

export interface AbilitySlot {
    readonly root: HTMLElement;
    readonly overlay: HTMLElement;
    readonly hint: ShortcutHint;
    /** 0 = ready, 1 = full cooldown (fills the overlay from the bottom). */
    setCooldown(fraction: number): void;
    /** Toggles the ready styling (`aria-disabled`). */
    setReady(ready: boolean): void;
    /** Toggles the active/duration styling (`aria-pressed`). */
    setActive(active: boolean): void;
    /** Sets both the accessible name and the tooltip description. */
    describe(label: string, description?: string): void;
    setBadge(count: number): void;
    setVisible(visible: boolean): void;
    /**
     * Beat-pulse feedback. `kick` is 0–1 from the audio state; the pressed
     * state squashes the slot the way the CSS :active rule does.
     */
    pulse(kick: number): void;
    /** Clear any JS-applied transform so CSS owns the slot again. */
    clearPulse(): void;
}

function createAbilitySlot(options: AbilitySlotOptions): AbilitySlot {
    const { id, name, key, icon, badge = false, toggle = false, hidden = false } = options;

    const hint = createShortcutHint({ key, corner: true });
    const overlay = el('div', { classes: ['cooldown-overlay'] });
    const badgeEl = badge
        ? el('span', { classes: ['ability-count'], attrs: { 'aria-hidden': 'true' }, text: '0' })
        : null;

    const root = el('div', {
        id,
        classes: ['ability-slot', 'ck-focusable'],
        attrs: {
            role: 'button',
            tabindex: 0,
            'aria-label': `${name} Ability (${key})`,
            'aria-keyshortcuts': key,
            'aria-disabled': 'true',
            'aria-pressed': toggle ? 'false' : null,
        },
        style: hidden ? { display: 'none' } : undefined,
        children: [
            hint.root,
            el('span', { classes: ['ability-icon'], attrs: { 'aria-hidden': 'true' }, text: icon }),
            badgeEl,
            overlay,
        ],
    });

    const tooltip: Tooltip = attachTooltip(root, { text: `${name} (${key})` });

    return {
        root,
        overlay,
        hint,
        setCooldown(fraction: number) {
            const pct = Math.min(1, Math.max(0, fraction));
            overlay.style.height = `${pct * 100}%`;
        },
        setReady(ready: boolean) {
            root.setAttribute('aria-disabled', ready ? 'false' : 'true');
        },
        setActive(active: boolean) {
            root.setAttribute('aria-pressed', active ? 'true' : 'false');
        },
        describe(label: string, description?: string) {
            root.setAttribute('aria-label', label);
            tooltip.setText(description ?? label);
        },
        setBadge(count: number) {
            if (badgeEl) badgeEl.textContent = count.toString();
        },
        setVisible(visible: boolean) {
            root.style.display = visible ? '' : 'none';
        },
        pulse(kick: number) {
            const scale = 1.0 + kick * 0.15;
            const pressed = root.classList.contains('pressed');
            const finalScale = pressed ? scale * 0.9 : scale;
            root.style.transform = `scale(${finalScale.toFixed(3)})`;
        },
        clearPulse() {
            root.style.transform = '';
        },
    };
}

// ============================================================================
// HUD
// ============================================================================

export interface AbilityHud {
    readonly panel: Panel;
    readonly energy: Meter;
    readonly dash: AbilitySlot;
    readonly mine: AbilitySlot;
    readonly phase: AbilitySlot;
}

let _hud: AbilityHud | null = null;

/**
 * Build (once) and mount the ability HUD into `#ability-hud-mount`, falling
 * back to <body>. Safe to call repeatedly; returns the existing instance.
 */
export function mountAbilityHud(): AbilityHud {
    if (_hud) return _hud;

    const energy = createMeter({
        id: 'energy-bar-container',
        label: 'Energy Bar',
        max: 10,
        value: 0,
        lowThreshold: 0.3,
        formatValueText: (value, max) => `${Math.round(value)} out of ${Math.round(max)} Energy`,
    });
    // Preserve the legacy id used by existing CSS and any external tooling.
    energy.fill.id = 'energy-bar-fill';

    const dash = createAbilitySlot({ id: 'ability-dash', name: 'Dash', key: 'E', icon: '💨' });
    const mine = createAbilitySlot({
        id: 'ability-mine',
        name: 'Jitter Mine',
        key: 'F',
        icon: '👾',
        hidden: true,
    });
    const phase = createAbilitySlot({
        id: 'ability-phase',
        name: 'Phase Shift',
        key: 'Z',
        icon: '👻',
        badge: true,
        toggle: true,
    });

    const panel = createPanel({
        id: 'ability-hud',
        label: 'Abilities',
        role: 'region',
        anchor: 'bottom-right',
        bare: true,
        // The slots are buttons — this panel must receive pointer events.
        inert: false,
        children: [energy.root, dash.root, mine.root, phase.root],
    });

    const mount = document.getElementById('ability-hud-mount') ?? document.body;
    mount.appendChild(panel.root);

    _hud = { panel, energy, dash, mine, phase };
    return _hud;
}

/** Returns the mounted HUD, or null when it has not been mounted yet. */
export function getAbilityHud(): AbilityHud | null {
    return _hud;
}
