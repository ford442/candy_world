/**
 * "Controls" in the accessibility menu (#2027): every keyboard/mouse and
 * gamepad binding of the action layer, rebindable, plus look, stick and rumble
 * settings. Changes persist through the layer (localStorage) and are announced.
 */

import {
    activeGamepad,
    bindingLabel,
    formatSource,
    input,
    type BindingRow,
    type Device,
    type GamepadSettings,
    type InputContextId,
} from '../core/input/actions/index.ts';
import { announce } from './announcer.ts';

const CONTEXT_TITLES: Partial<Record<InputContextId, string>> = {
    gameplay: 'Playing',
    build: 'Build mode',
    gizmo: 'Build gizmo',
    photo: 'Photo mode',
    menu: 'Menus',
};

const DEVICE_TITLES: Partial<Record<Device, string>> = {
    kbm: 'Keyboard & mouse',
    gamepad: 'Gamepad',
};

const padStyle = () => activeGamepad()?.padStyle() ?? 'xbox';

const sourceName = (row: BindingRow): string =>
    row.binding.source ? formatSource(row.binding.source, row.binding.mods, padStyle()) : 'Unbound';

function updateGamepad(patch: Partial<GamepadSettings>): void {
    input.updateSettings({ gamepad: { ...input.getSettings().gamepad, ...patch } });
}

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

    h.createSectionTitle('Gamepad');
    h.createSlider(
        'Stick look speed',
        'input.look.gamepad',
        settings.lookSensitivity.gamepad,
        0.1,
        3,
        0.1,
        (v) =>
            input.updateSettings({
                lookSensitivity: { ...input.getSettings().lookSensitivity, gamepad: v },
            })
    );
    h.createSlider(
        'Stick deadzone',
        'input.gamepad.deadzone',
        settings.gamepad.deadzone,
        0,
        0.5,
        0.01,
        (v) => updateGamepad({ deadzone: v })
    );
    h.createSlider(
        'Stick look curve (1 = linear)',
        'input.gamepad.lookCurve',
        settings.gamepad.lookCurve,
        1,
        3,
        0.1,
        (v) => updateGamepad({ lookCurve: v })
    );
    h.createToggle('Rumble on the beat', 'input.gamepad.haptics', settings.gamepad.haptics, (v) => {
        updateGamepad({ haptics: v });
        announce(v ? 'Gamepad rumble on' : 'Gamepad rumble off', 'polite');
    });

    const lists: HTMLElement[] = [];
    for (const device of ['kbm', 'gamepad'] as const) {
        h.createSectionTitle(`${DEVICE_TITLES[device]} bindings`);
        const list = document.createElement('div');
        list.style.cssText = 'display: flex; flex-direction: column; gap: 8px;';
        list.dataset.device = device;
        container.appendChild(list);
        renderBindingRows(list, h, device);
        lists.push(list);
    }

    const reset = document.createElement('button');
    reset.type = 'button';
    reset.className = 'a11y-button';
    reset.textContent = 'Reset all controls';
    reset.style.cssText = `${h.buttonStyle} margin-top: 12px;`;
    reset.addEventListener('click', () => {
        input.resetBindings();
        for (const list of lists) renderBindingRows(list, h, list.dataset.device as Device);
        announce('All controls reset to defaults', 'polite');
    });
    container.appendChild(reset);
}

function renderBindingRows(list: HTMLElement, h: ControlsSectionHelpers, device: Device): void {
    list.replaceChildren();
    let context: InputContextId | null = null;
    for (const row of input.listBindings(device)) {
        if (row.context !== context) {
            context = row.context;
            const title = document.createElement('h4');
            title.textContent = CONTEXT_TITLES[context] ?? context;
            title.style.cssText = 'margin: 12px 0 4px; font-size: 0.95rem;';
            list.appendChild(title);
        }
        list.appendChild(createRow(row, list, h, device));
    }
}

function createRow(
    row: BindingRow,
    list: HTMLElement,
    h: ControlsSectionHelpers,
    device: Device
): HTMLElement {
    const el = document.createElement('div');
    el.style.cssText =
        'display: flex; justify-content: space-between; align-items: center; gap: 8px;';

    const name = bindingLabel(row.binding);
    const label = document.createElement('span');
    label.textContent = name;
    label.style.cssText = 'flex: 1;';

    const current = sourceName(row);
    const what = device === 'gamepad' ? 'a button' : 'a key';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'a11y-button';
    btn.dataset.bindingKey = row.key;
    btn.textContent = current;
    btn.setAttribute('aria-label', `${name}: ${current}. Press to rebind.`);
    btn.style.cssText = `${h.buttonStyle} min-width: 130px;`;
    btn.addEventListener('click', () => {
        btn.textContent = device === 'gamepad' ? 'Press a button…' : 'Press a key…';
        btn.setAttribute('aria-label', `Rebinding ${name}. Press ${what}, or Escape to cancel.`);
        announce(`Press ${what} for ${name}, or Escape to cancel`, 'assertive');
        input.captureNext(
            (spec) => {
                if (!spec) {
                    announce('Rebinding cancelled', 'polite');
                    renderBindingRows(list, h, device);
                    focusRow(list, row.key);
                    return;
                }
                const clashes = input.rebind(row.key, spec.source, spec.mods);
                const keyName = formatSource(spec.source, spec.mods, padStyle());
                const also = clashes.length
                    ? `. Also used for ${clashes.map((c) => bindingLabel(c.binding)).join(', ')}`
                    : '';
                announce(`${name} bound to ${keyName}${also}`, 'polite');
                renderBindingRows(list, h, device);
                focusRow(list, row.key);
            },
            { device }
        );
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
