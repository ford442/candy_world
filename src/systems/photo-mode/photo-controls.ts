import { PHOTO_PRESETS, type PhotoPreset } from './photo-presets.ts';
import { CYCLE_DURATION } from '../../core/config.ts';
import { trapFocusInside } from '../../utils/interaction-utils.ts';
import { announcePolite } from '../../ui/announcer.ts';

export interface PhotoControlValues {
    focusDistance: number;
    dofMix: number;
    aperture: number;
    godRayStrength: number;
    bloomStrength: number;
    saturation: number;
    contrast: number;
    vignette: number;
    cycleTime: number;
    hideHud: boolean;
    captureScale: number;
    watermark: boolean;
    activePresetId: string | null;
}

export type PhotoControlsChangeHandler = (values: PhotoControlValues, field: keyof PhotoControlValues) => void;

export interface PhotoControlsOptions {
    onChange: PhotoControlsChangeHandler;
    onCapture: () => void;
    onExit: () => void;
    initial: PhotoControlValues;
    reducedMotion?: boolean;
}

const SLIDER_SPECS: Array<{
    key: keyof PhotoControlValues;
    label: string;
    min: number;
    max: number;
    step: number;
    format?: (v: number) => string;
}> = [
    { key: 'focusDistance', label: 'Focus distance', min: 1.5, max: 45, step: 0.5, format: (v) => `${v.toFixed(1)}u` },
    { key: 'aperture', label: 'Aperture', min: 0.004, max: 0.04, step: 0.001, format: (v) => v.toFixed(3) },
    { key: 'dofMix', label: 'Depth blur', min: 0, max: 1, step: 0.05, format: (v) => `${Math.round(v * 100)}%` },
    { key: 'godRayStrength', label: 'God rays', min: 0, max: 1, step: 0.05, format: (v) => `${Math.round(v * 100)}%` },
    { key: 'bloomStrength', label: 'Exposure / bloom', min: 0.5, max: 2.5, step: 0.05, format: (v) => v.toFixed(2) },
    { key: 'saturation', label: 'Saturation', min: 0.6, max: 1.6, step: 0.05, format: (v) => v.toFixed(2) },
    { key: 'contrast', label: 'Contrast', min: 0.8, max: 1.4, step: 0.05, format: (v) => v.toFixed(2) },
    { key: 'vignette', label: 'Vignette', min: 0, max: 1, step: 0.05, format: (v) => `${Math.round(v * 100)}%` },
    { key: 'cycleTime', label: 'Time of day', min: 0, max: CYCLE_DURATION, step: 15, format: (v) => `${Math.floor(v / 60)}m ${Math.floor(v % 60)}s` },
];

export class PhotoControlsOverlay {
    private root: HTMLElement | null = null;
    private releaseFocus: (() => void) | null = null;
    private values: PhotoControlValues;
    private readonly onChange: PhotoControlsChangeHandler;
    private readonly onCapture: () => void;
    private readonly onExit: () => void;
    private readonly reducedMotion: boolean;

    constructor(options: PhotoControlsOptions) {
        this.values = { ...options.initial };
        this.onChange = options.onChange;
        this.onCapture = options.onCapture;
        this.onExit = options.onExit;
        this.reducedMotion = options.reducedMotion ?? false;
        this.build();
    }

    private build(): void {
        let root = document.getElementById('photo-mode-panel');
        if (!root) {
            root = document.createElement('aside');
            root.id = 'photo-mode-panel';
            root.setAttribute('role', 'dialog');
            root.setAttribute('aria-modal', 'true');
            root.setAttribute('aria-label', 'Photo mode controls');
            document.body.appendChild(root);
        }
        this.root = root;
        root.innerHTML = '';

        const header = document.createElement('div');
        header.className = 'photo-mode-panel__header';
        header.innerHTML = '<h2 id="photo-mode-title">Photo Mode</h2><p id="photo-mode-desc">Frame your shot — simulation paused</p>';
        root.appendChild(header);

        const presets = document.createElement('div');
        presets.className = 'photo-mode-panel__presets';
        presets.setAttribute('role', 'group');
        presets.setAttribute('aria-label', 'Composition presets');
        for (const preset of PHOTO_PRESETS) {
            presets.appendChild(this.createPresetButton(preset));
        }
        root.appendChild(presets);

        const form = document.createElement('div');
        form.className = 'photo-mode-panel__controls';
        for (const spec of SLIDER_SPECS) {
            form.appendChild(this.createSlider(spec));
        }
        root.appendChild(form);

        const toggles = document.createElement('div');
        toggles.className = 'photo-mode-panel__toggles';
        toggles.appendChild(this.createToggle('hideHud', 'Hide HUD', this.values.hideHud));
        toggles.appendChild(this.createToggle('watermark', 'Watermark + seed stamp', this.values.watermark));
        root.appendChild(toggles);

        const actions = document.createElement('div');
        actions.className = 'photo-mode-panel__actions';
        const captureBtn = document.createElement('button');
        captureBtn.type = 'button';
        captureBtn.className = 'photo-mode-panel__capture';
        captureBtn.textContent = 'Capture PNG (Enter)';
        captureBtn.setAttribute('aria-keyshortcuts', 'Enter');
        captureBtn.addEventListener('click', () => this.onCapture());
        actions.appendChild(captureBtn);

        const exitBtn = document.createElement('button');
        exitBtn.type = 'button';
        exitBtn.className = 'photo-mode-panel__exit';
        exitBtn.textContent = 'Exit (Esc)';
        exitBtn.setAttribute('aria-keyshortcuts', 'Escape');
        exitBtn.addEventListener('click', () => this.onExit());
        actions.appendChild(exitBtn);
        root.appendChild(actions);

        if (this.reducedMotion) {
            const note = document.createElement('p');
            note.className = 'photo-mode-panel__a11y-note';
            note.textContent = 'Reduced motion: camera stays static until you drag to frame.';
            root.appendChild(note);
        }

        root.addEventListener('keydown', (e) => this.onKeyDown(e));
    }

    private createPresetButton(preset: PhotoPreset): HTMLButtonElement {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'photo-mode-panel__preset';
        btn.textContent = preset.label;
        btn.title = preset.description;
        btn.setAttribute('aria-label', `${preset.label} preset — ${preset.description}`);
        btn.dataset.presetId = preset.id;
        if (this.values.activePresetId === preset.id) {
            btn.setAttribute('aria-pressed', 'true');
        }
        btn.addEventListener('click', () => {
            this.applyPreset(preset);
            announcePolite(`${preset.label} preset applied`);
        });
        return btn;
    }

    applyPreset(preset: PhotoPreset): void {
        this.values = {
            ...this.values,
            focusDistance: preset.focusDistance,
            dofMix: preset.dofMix,
            aperture: preset.aperture,
            godRayStrength: preset.godRayStrength,
            bloomStrength: preset.bloomStrength,
            saturation: preset.saturation,
            contrast: preset.contrast,
            vignette: preset.vignette,
            activePresetId: preset.id,
        };
        this.syncSliders();
        this.onChange(this.values, 'activePresetId');
    }

    private createSlider(spec: (typeof SLIDER_SPECS)[number]): HTMLElement {
        const wrap = document.createElement('label');
        wrap.className = 'photo-mode-panel__row';
        const id = `photo-${String(spec.key)}`;
        wrap.setAttribute('for', id);

        const title = document.createElement('span');
        title.className = 'photo-mode-panel__row-label';
        title.textContent = spec.label;
        wrap.appendChild(title);

        const valueEl = document.createElement('span');
        valueEl.className = 'photo-mode-panel__row-value';
        valueEl.dataset.field = String(spec.key);
        const current = this.values[spec.key] as number;
        valueEl.textContent = spec.format ? spec.format(current) : String(current);
        wrap.appendChild(valueEl);

        const input = document.createElement('input');
        input.type = 'range';
        input.id = id;
        input.min = String(spec.min);
        input.max = String(spec.max);
        input.step = String(spec.step);
        input.value = String(current);
        input.setAttribute('aria-valuemin', String(spec.min));
        input.setAttribute('aria-valuemax', String(spec.max));
        input.setAttribute('aria-valuenow', String(current));
        input.addEventListener('input', () => {
            const v = parseFloat(input.value);
            (this.values as Record<string, unknown>)[spec.key] = v;
            valueEl.textContent = spec.format ? spec.format(v) : String(v);
            input.setAttribute('aria-valuenow', String(v));
            this.values.activePresetId = null;
            this.onChange(this.values, spec.key);
        });
        wrap.appendChild(input);
        return wrap;
    }

    private createToggle(key: 'hideHud' | 'watermark', label: string, checked: boolean): HTMLElement {
        const wrap = document.createElement('label');
        wrap.className = 'photo-mode-panel__toggle';
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.checked = checked;
        input.setAttribute('aria-label', label);
        input.addEventListener('change', () => {
            this.values[key] = input.checked;
            this.onChange(this.values, key);
        });
        wrap.appendChild(input);
        const span = document.createElement('span');
        span.textContent = label;
        wrap.appendChild(span);
        return wrap;
    }

    private syncSliders(): void {
        if (!this.root) return;
        for (const spec of SLIDER_SPECS) {
            const input = this.root.querySelector(`#photo-${String(spec.key)}`) as HTMLInputElement | null;
            const valueEl = this.root.querySelector(`[data-field="${String(spec.key)}"]`);
            const v = this.values[spec.key] as number;
            if (input) {
                input.value = String(v);
                input.setAttribute('aria-valuenow', String(v));
            }
            if (valueEl && spec.format) valueEl.textContent = spec.format(v);
        }
        this.root.querySelectorAll('.photo-mode-panel__preset').forEach((el) => {
            const btn = el as HTMLButtonElement;
            btn.setAttribute('aria-pressed', btn.dataset.presetId === this.values.activePresetId ? 'true' : 'false');
        });
    }

    show(): void {
        if (!this.root) return;
        this.root.classList.add('visible');
        this.releaseFocus?.();
        this.releaseFocus = trapFocusInside(this.root);
        const first = this.root.querySelector('button, input') as HTMLElement | null;
        first?.focus();
    }

    hide(): void {
        this.root?.classList.remove('visible');
        this.releaseFocus?.();
        this.releaseFocus = null;
    }

    getValues(): PhotoControlValues {
        return this.values;
    }

    setCycleTime(seconds: number): void {
        this.values.cycleTime = seconds;
        this.syncSliders();
    }

    handleKeyDown(event: KeyboardEvent): boolean {
        return this.onKeyDown(event);
    }

    private onKeyDown(event: KeyboardEvent): boolean {
        if (event.key === 'Enter' && !event.shiftKey && !event.ctrlKey && !event.metaKey) {
            event.preventDefault();
            this.onCapture();
            return true;
        }
        if (event.key === 'Escape') {
            event.preventDefault();
            this.onExit();
            return true;
        }
        return false;
    }

    dispose(): void {
        this.hide();
        this.root?.remove();
        this.root = null;
    }
}
