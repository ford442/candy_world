/**
 * Candy UI Kit — Meter primitive.
 *
 * A horizontal resource bar that is a real `role="progressbar"`: value,
 * bounds and a human-readable `aria-valuetext` stay in sync with the fill.
 */

import { el } from './dom.ts';

export interface MeterOptions {
    id?: string;
    /** Accessible name, e.g. "Energy Bar". */
    label: string;
    min?: number;
    max?: number;
    value?: number;
    /** Fraction (0–1) below which the meter enters its `low` state. */
    lowThreshold?: number;
    /** Builds `aria-valuetext`. Default: "3 out of 10 <label>". */
    formatValueText?: (value: number, max: number) => string;
    classes?: string[];
}

export interface Meter {
    readonly root: HTMLElement;
    readonly fill: HTMLElement;
    /** Update value (and optionally max). Returns true when the low state changed. */
    setValue(value: number, max?: number): boolean;
    getValue(): number;
    /** True while value/max is under `lowThreshold`. */
    isLow(): boolean;
    /** Transient scale, for beat pulses. Pass 1 to clear. */
    setPulse(scale: number): void;
}

export function createMeter(options: MeterOptions): Meter {
    const {
        id,
        label,
        min = 0,
        max = 1,
        value = 0,
        lowThreshold = 0.3,
        classes = [],
        formatValueText,
    } = options;

    const valueText = formatValueText
        ?? ((v: number, m: number) => `${Math.round(v)} out of ${Math.round(m)} ${label.replace(/ bar$/i, '')}`);

    const fill = el('div', { classes: ['ck-meter__fill'] });
    const root = el('div', {
        id,
        classes: ['ck-meter', ...classes],
        attrs: {
            role: 'progressbar',
            'aria-label': label,
            'aria-valuemin': min,
            'aria-valuemax': max,
            'aria-valuenow': value,
        },
        children: [fill],
    });

    let currentValue = value;
    let currentMax = max;
    let low = false;

    const apply = () => {
        const span = currentMax - min;
        const pct = span > 0 ? Math.max(0, Math.min(1, (currentValue - min) / span)) : 0;
        fill.style.width = `${pct * 100}%`;
        root.setAttribute('aria-valuenow', currentValue.toFixed(1));
        root.setAttribute('aria-valuemax', currentMax.toFixed(1));
        root.setAttribute('aria-valuetext', valueText(currentValue, currentMax));

        const nextLow = pct < lowThreshold;
        const changed = nextLow !== low;
        low = nextLow;
        if (changed) {
            if (low) root.setAttribute('data-ck-state', 'low');
            else root.removeAttribute('data-ck-state');
        }
        return changed;
    };

    apply();

    return {
        root,
        fill,
        setValue(next: number, nextMax?: number) {
            currentValue = next;
            if (nextMax !== undefined) currentMax = nextMax;
            return apply();
        },
        getValue() {
            return currentValue;
        },
        isLow() {
            return low;
        },
        setPulse(scale: number) {
            root.style.transform = Math.abs(scale - 1) > 0.001 ? `scale(${scale.toFixed(3)})` : '';
        },
    };
}
