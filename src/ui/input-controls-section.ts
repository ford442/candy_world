/**
 * "Controls" in the accessibility menu (#2027): every keyboard/mouse binding
 * of the action layer, rebindable, plus look settings. Changes persist through
 * the layer (localStorage) and are announced.
 */

import {
    bindingLabel,
    formatSource,
    input,
    type BindingRow,
    type InputContextId,
} from '../core/input/actions/index.ts';
import { announce } from './announcer.ts';

const CONTEXT_TITLES: Partial<Record<InputContextId, string>> = {
    gameplay: 'Playing',
    build: 'Build mode',
    gizmo: 'Build gizmo',
    menu: 'Menus',
};

export interface ControlsSectionHelpers {
    createToggle(label: string, id: string, checked: boolean, onChange: (v: boolean) => void): void;
    createSlider(
        label: string,
        id: string,
        value: number,
        min: number,
        max: number,
        step: number,
        onChange: (v: number) => void
    ): void;
    createSelect(
        label: string,
        id: string,
        value: string,
        options: string[],
        onChange: (v: string) => void
    ): void;
    createSectionTitle(title: string): void;
    buttonStyle: string;
}

export function renderControlsSection(container: HTMLElement, h: ControlsSectionHelpers): void {
    const settings = input.getSettings();

    h.createSectionTitle('Look & movement');
    h.createSlider(
        'Mouse look speed',
        'input.look.kbm',
        settings.lookSensitivity.kbm,
        0.1,
        3,
        0.1,
        (v) =>
            input.updateSettings({
                lookSensitivity: { ...input.getSettings().lookSensitivity, kbm: v },
            })
    );
    h.createToggle('Invert look up/down', 'input.invertY', settings.invertY, (v) => {
        input.updateSettings({ invertY: v });
        announce(v ? 'Look inverted' : 'Look not inverted', 'polite');
    });
    for (const action of ['sprint', 'sneak'] as const) {
        const label = action === 'sprint' ? 'Sprint' : 'Sneak';
        h.createSelect(
            `${label}: hold or toggle`,
            `input.${action}Mode`,
            settings.holdToggle[action],
            ['hold', 'toggle'],
            (v) => {
                const mode = v === 'toggle' ? 'toggle' : 'hold';
                input.updateSettings({
                    holdToggle: { ...input.getSettings().holdToggle, [action]: mode },
                });
                announce(`${label} set to ${mode}`, 'polite');
            }
        );
    }

    const list = document.createElement('div');
    list.style.cssText = 'display: flex; flex-direction: column; gap: 8px;';
    container.appendChild(list);
    renderBindingRows(list, h);

    const reset = document.createElement('button');
    reset.type = 'button';
    reset.className = 'a11y-button';
    reset.textContent = 'Reset all controls';
    reset.style.cssText = `${h.buttonStyle} margin-top: 12px;`;
    reset.addEventListener('click', () => {
        input.resetBindings();
        renderBindingRows(list, h);
        announce('All controls reset to defaults', 'polite');
    });
    container.appendChild(reset);
}

function renderBindingRows(list: HTMLElement, h: ControlsSectionHelpers): void {
    list.replaceChildren();
    let context: InputContextId | null = null;
    for (const row of input.listBindings()) {
        if (row.context !== context) {
            context = row.context;
            const title = document.createElement('h4');
            title.textContent = CONTEXT_TITLES[context] ?? context;
            title.style.cssText = 'margin: 12px 0 4px; font-size: 0.95rem;';
            list.appendChild(title);
        }
        list.appendChild(createRow(row, list, h));
    }
}

function createRow(row: BindingRow, list: HTMLElement, h: ControlsSectionHelpers): HTMLElement {
    const el = document.createElement('div');
    el.style.cssText =
        'display: flex; justify-content: space-between; align-items: center; gap: 8px;';

    const name = bindingLabel(row.binding);
    const label = document.createElement('span');
    label.textContent = name;
    label.style.cssText = 'flex: 1;';

    const current = row.binding.source
        ? formatSource(row.binding.source, row.binding.mods)
        : 'Unbound';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'a11y-button';
    btn.dataset.bindingKey = row.key;
    btn.textContent = current;
    btn.setAttribute('aria-label', `${name}: ${current}. Press to rebind.`);
    btn.style.cssText = `${h.buttonStyle} min-width: 130px;`;
    btn.addEventListener('click', () => {
        btn.textContent = 'Press a key…';
        btn.setAttribute('aria-label', `Rebinding ${name}. Press a key, or Escape to cancel.`);
        announce(`Press a key for ${name}, or Escape to cancel`, 'assertive');
        input.captureNext((spec) => {
            if (!spec) {
                announce('Rebinding cancelled', 'polite');
                renderBindingRows(list, h);
                focusRow(list, row.key);
                return;
            }
            const clashes = input.rebind(row.key, spec.source, spec.mods);
            const keyName = formatSource(spec.source, spec.mods);
            const also = clashes.length
                ? `. Also used for ${clashes.map((c) => bindingLabel(c.binding)).join(', ')}`
                : '';
            announce(`${name} bound to ${keyName}${also}`, 'polite');
            renderBindingRows(list, h);
            focusRow(list, row.key);
        });
    });

    el.append(label, btn);
    return el;
}

/** The rows re-render after a rebind: keep focus on the row that changed. */
function focusRow(list: HTMLElement, key: string): void {
    list.querySelectorAll<HTMLButtonElement>('button[data-binding-key]').forEach((b) => {
        if (b.dataset.bindingKey === key) b.focus({ preventScroll: true });
    });
}
