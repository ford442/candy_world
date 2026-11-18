/**
 * @file src/systems/composer/composer-ui.ts
 * @brief The grove composer's pattern editor: an accessible dialog over a music stone (#1976 slice C).
 *
 * Eight rows (voices) of sixteen candy keys (steps). Every key is a toggle button with a spoken
 * name ("Melody, step 3: E5, on"), so the grid works with a screen reader as well as by sight.
 *
 * - **Keyboard** (DOM, so the focus trap and screen readers keep working): arrows move between
 *   keys (roving tabindex; Home/End jump along a row), Enter/Space toggles, `+`/`-` (or
 *   PageUp/PageDown) change the pitch, Delete clears a key, Escape closes.
 * - **Gamepad**: the dialog holds the `menu` input context, so the d-pad walks the controls and A
 *   presses one (`gamepad-menu.ts`); LB/RB change the pitch, X auditions, Y saves (`composer.*`).
 * - **Touch / mouse**: every key and toolbar control is a button; the pitch buttons act on the
 *   selected key.
 *
 * The editor edits a draft. Audition plays the draft through the soundtrack; Save turns it into one
 * `compose` command (undoable). It never touches the world itself: `index.ts` supplies the hooks.
 *
 * Plain DOM through the Candy UI Kit; the look is in `composer.css`, imported by `index.ts` so
 * this module stays importable from Node tests.
 */

import { input } from '../../core/input/actions/index.ts';
import { createPanel, el } from '../../ui/kit/index.ts';
import { trapFocusInside } from '../../utils/focus-trap.ts';
import {
    GROVE_CHANNELS,
    GROVE_MAX_DEGREE,
    GROVE_REST,
    GROVE_STEPS,
    cloneGrovePattern,
    defaultGrovePattern,
    sameGrovePattern,
    withGroveCell,
    withGroveCue,
    withGroveRowCleared,
    type GrovePattern,
} from '../../world/document/grove-pattern.ts';
import { COMPOSER_VOICES } from './composer-voices.ts';

export const COMPOSER_ID = 'grove-composer';

export interface ComposerCueOption {
    id: string;
    /** Shown in the picker; a locked cue says what unlocks it. */
    label: string;
}

export interface ComposerSaveResult {
    ok: boolean;
    message: string;
}

export interface ComposerEditorOptions {
    stoneId: string;
    /** The stone's pattern as it plays now (its authored one, or its default). */
    pattern: GrovePattern;
    /** An unsaved draft from the last time the editor was open on this stone. */
    draft?: GrovePattern;
    /** Per channel, whether this player may write to it (`composer-voices.ts`). */
    voices: readonly boolean[];
    /** Why this world can't be edited from here (a view-only shared world), or null. */
    readOnly: string | null;
    cues: readonly ComposerCueOption[];
    /** "G lydian": the key the stone plays in, for the heading. */
    keyLabel: string;
    /** The note a degree plays on a channel, in the stone's key ("E5"). */
    noteName(channel: number, degree: number): string;
    /** Why audition is unavailable (no generative soundtrack), or null. */
    auditionBlocked(): string | null;
    onAudition(pattern: GrovePattern | null): void;
    onPreview(channel: number, degree: number): void;
    onSave(pattern: GrovePattern): ComposerSaveResult;
    /** Undo / redo the last compose of this stone; the stone's pattern after it, or null. */
    undo(): GrovePattern | null;
    redo(): GrovePattern | null;
    canUndo(): boolean;
    canRedo(): boolean;
    /** Called once the dialog has closed (focus is already back). */
    onClose?(): void;
    announce?(message: string): void;
}

export interface ComposerEditor {
    readonly root: HTMLElement;
    open(): void;
    close(): void;
    isOpen(): boolean;
    destroy(): void;
    /** The working copy. */
    draft(): GrovePattern;
    /** True while the draft differs from the saved pattern. */
    dirty(): boolean;
    /** The stone's saved pattern changed (a peer's edit, an undo): reset to it if nothing is pending. */
    syncSaved(pattern: GrovePattern): void;
    /** The key at (channel, step), for tests and the pad. */
    cell(channel: number, step: number): HTMLButtonElement;
    focusCell(channel: number, step: number): void;
    /** Pitch of the selected key, by `delta` scale steps. */
    nudgePitch(delta: number): void;
    toggleAudition(): void;
    save(): ComposerSaveResult;
}

/** The degree a freshly lit key starts on: the row's last pitch, else the root. */
const START_DEGREE = 0;

export function mountComposerEditor(options: ComposerEditorOptions): ComposerEditor {
    const readOnly = options.readOnly;
    const canWrite = (ch: number): boolean => readOnly === null && options.voices[ch] === true;
    let saved = cloneGrovePattern(options.pattern);
    let draft = cloneGrovePattern(options.draft ?? options.pattern);
    let auditioning = false;
    let opened = false;
    let selected = { channel: firstWritableChannel(), step: 0 };
    const lastDegree = new Array<number>(GROVE_CHANNELS).fill(START_DEGREE);
    let popMenuContext: (() => void) | null = null;
    let releaseTrap: (() => void) | null = null;
    const padOff: Array<() => void> = [];

    function firstWritableChannel(): number {
        for (let ch = 0; ch < GROVE_CHANNELS; ch++) if (canWrite(ch)) return ch;
        return 0;
    }

    const panel = createPanel({
        id: COMPOSER_ID,
        label: 'Grove composer',
        role: 'dialog',
        layer: 'overlay',
        column: true,
        // It holds controls; `[role="dialog"]` keeps a click here from re-acquiring pointer lock.
        inert: false,
        title: '🎼 Music stone',
        classes: ['composer-panel'],
    });
    panel.root.setAttribute('aria-modal', 'true');
    panel.root.setAttribute('aria-describedby', `${COMPOSER_ID}-help`);

    const heading = el('p', {
        classes: ['composer-key'],
        text: `Plays in ${options.keyLabel}, the key of the grove around it.`,
    });
    const help = el('p', {
        id: `${COMPOSER_ID}-help`,
        classes: ['composer-help'],
        text:
            readOnly ??
            'Arrows move between keys. Enter or Space turns a key on or off; plus and minus change its pitch. On a pad: the d-pad moves, A toggles, LB and RB change pitch, X auditions, Y saves.',
    });
    const status = el('p', {
        classes: ['composer-status'],
        attrs: { role: 'status', 'aria-live': 'polite' },
    });

    const closeButton = button('✕', 'Close composer', ['composer-close']);
    const auditionButton = button('▶ Audition', 'Audition the pattern', ['composer-audition']);
    auditionButton.setAttribute('aria-pressed', 'false');
    const pitchDown = button('♭ Lower', 'Lower the selected key');
    const pitchUp = button('♯ Raise', 'Raise the selected key');
    const clearRow = button('Clear row', 'Clear the selected row');
    const reset = button('Reset', "Reset to this stone's default pattern");
    const undoButton = button('↶ Undo', 'Undo the last saved change');
    const redoButton = button('↷ Redo', 'Redo');
    const saveButton = button('Save', 'Save the pattern to this stone', ['composer-save']);

    const toolbar = el('div', {
        classes: ['composer-toolbar'],
        attrs: { role: 'toolbar', 'aria-label': 'Composer tools' },
        children: [
            auditionButton,
            pitchDown,
            pitchUp,
            clearRow,
            reset,
            undoButton,
            redoButton,
            saveButton,
        ],
    });

    const cells: HTMLButtonElement[][] = [];
    const cueSelects: HTMLSelectElement[] = [];
    const rows: HTMLElement[] = [];
    for (let ch = 0; ch < GROVE_CHANNELS; ch++) rows.push(buildRow(ch));
    const grid = el('div', {
        classes: ['composer-grid'],
        attrs: { role: 'group', 'aria-label': 'Pattern: 8 voices by 16 steps' },
        children: rows,
    });

    panel.add(closeButton, heading, help, toolbar, grid, status);
    panel.hide();

    function button(text: string, label: string, classes: string[] = []): HTMLButtonElement {
        return el('button', {
            classes: ['composer-button', 'ck-focusable', ...classes],
            attrs: { type: 'button', 'aria-label': label },
            text,
        });
    }

    function buildRow(ch: number): HTMLElement {
        const voice = COMPOSER_VOICES[ch];
        const locked = options.voices[ch] !== true;
        const rowLabel = locked
            ? `${voice.name} (locked: ${voice.requires?.label ?? ''})`
            : voice.name;
        const name = el('span', {
            classes: ['composer-voice', locked && 'composer-voice--locked'],
            text: locked ? `🔒 ${voice.name}` : voice.name,
        });
        if (locked) name.setAttribute('title', voice.requires?.label ?? '');

        const select = el('select', {
            classes: ['composer-cue', 'ck-focusable'],
            attrs: { 'aria-label': `Living Score cue for ${voice.name}` },
        });
        select.appendChild(el('option', { attrs: { value: '' }, text: 'No cue' }));
        for (const cue of options.cues) {
            select.appendChild(el('option', { attrs: { value: cue.id }, text: cue.label }));
        }
        if (!canWrite(ch)) select.setAttribute('disabled', 'true');
        select.addEventListener('change', () => {
            if (!canWrite(ch)) return;
            setDraft(withGroveCue(draft, ch, select.value || null));
            say(select.value ? `${voice.name} fires ${select.value}` : `${voice.name}: no cue`);
        });
        cueSelects.push(select);

        const keys: HTMLButtonElement[] = [];
        for (let s = 0; s < GROVE_STEPS; s++) {
            const key = el('button', {
                classes: ['composer-cell', s % 4 === 0 && 'composer-cell--beat'],
                attrs: {
                    type: 'button',
                    tabindex: '-1',
                    'data-channel': ch,
                    'data-step': s,
                    'aria-pressed': 'false',
                    'aria-disabled': canWrite(ch) ? null : 'true',
                },
            });
            key.addEventListener('click', () => {
                selectCell(ch, s);
                toggleCell(ch, s);
            });
            key.addEventListener('focus', () => selectCell(ch, s));
            keys.push(key);
        }
        cells.push(keys);

        return el('div', {
            classes: ['composer-row'],
            attrs: { role: 'group', 'aria-label': rowLabel, 'data-voice': ch },
            children: [
                el('div', { classes: ['composer-row-head'], children: [name, select] }),
                el('div', { classes: ['composer-keys'], children: keys }),
            ],
        });
    }

    function say(message: string): void {
        status.textContent = message;
        options.announce?.(message);
    }

    function cellLabel(ch: number, s: number): string {
        const degree = draft.channels[ch].notes[s];
        const what = degree === GROVE_REST ? 'rest' : `${options.noteName(ch, degree)}, on`;
        return `${COMPOSER_VOICES[ch].name}, step ${s + 1}: ${what}`;
    }

    function renderCell(ch: number, s: number): void {
        const key = cells[ch][s];
        const degree = draft.channels[ch].notes[s];
        const on = degree !== GROVE_REST;
        key.setAttribute('aria-pressed', on ? 'true' : 'false');
        key.setAttribute('aria-label', cellLabel(ch, s));
        key.classList.toggle('composer-cell--on', on);
        key.textContent = on ? options.noteName(ch, degree) : '';
        key.setAttribute('tabindex', ch === selected.channel && s === selected.step ? '0' : '-1');
    }

    function render(): void {
        for (let ch = 0; ch < GROVE_CHANNELS; ch++) {
            for (let s = 0; s < GROVE_STEPS; s++) renderCell(ch, s);
            cueSelects[ch].value = draft.channels[ch].cue ?? '';
        }
        renderToolbar();
    }

    function renderToolbar(): void {
        const dirty = !sameGrovePattern(draft, saved);
        const writable = readOnly === null;
        setEnabled(saveButton, writable && dirty);
        setEnabled(reset, writable);
        setEnabled(clearRow, canWrite(selected.channel));
        setEnabled(pitchUp, canWrite(selected.channel));
        setEnabled(pitchDown, canWrite(selected.channel));
        setEnabled(undoButton, writable && !dirty && options.canUndo());
        setEnabled(redoButton, writable && !dirty && options.canRedo());
        saveButton.textContent = dirty ? 'Save •' : 'Save';
        auditionButton.setAttribute('aria-pressed', auditioning ? 'true' : 'false');
        auditionButton.textContent = auditioning ? '■ Stop' : '▶ Audition';
    }

    /** `aria-disabled`, not `disabled`: the control stays focusable, so the pad can still reach it. */
    function setEnabled(control: HTMLButtonElement, enabled: boolean): void {
        if (enabled) control.removeAttribute('aria-disabled');
        else control.setAttribute('aria-disabled', 'true');
    }

    function enabled(control: HTMLButtonElement): boolean {
        return control.getAttribute('aria-disabled') !== 'true';
    }

    function setDraft(next: GrovePattern): void {
        draft = next;
        if (auditioning) options.onAudition(draft);
        render();
    }

    function selectCell(ch: number, s: number): void {
        if (selected.channel === ch && selected.step === s) return;
        const prev = selected;
        selected = { channel: ch, step: s };
        renderCell(prev.channel, prev.step);
        renderCell(ch, s);
        renderToolbar();
    }

    function focusCell(ch: number, s: number): void {
        const c = Math.max(0, Math.min(GROVE_CHANNELS - 1, ch));
        const st = Math.max(0, Math.min(GROVE_STEPS - 1, s));
        selectCell(c, st);
        cells[c][st].focus();
    }

    function lockedMessage(ch: number): string {
        if (readOnly) return readOnly;
        const voice = COMPOSER_VOICES[ch];
        return `${voice.name} is locked. ${voice.requires?.label ?? ''}.`;
    }

    function toggleCell(ch: number, s: number): void {
        if (!canWrite(ch)) return say(lockedMessage(ch));
        const degree = draft.channels[ch].notes[s];
        const next = degree === GROVE_REST ? lastDegree[ch] : GROVE_REST;
        setDraft(withGroveCell(draft, ch, s, next));
        if (next !== GROVE_REST) options.onPreview(ch, next);
        say(cellLabel(ch, s));
    }

    function nudgePitch(delta: number): void {
        const { channel: ch, step: s } = selected;
        if (!canWrite(ch)) return say(lockedMessage(ch));
        const degree = draft.channels[ch].notes[s];
        const base = degree === GROVE_REST ? lastDegree[ch] - Math.sign(delta) : degree;
        const next = Math.max(0, Math.min(GROVE_MAX_DEGREE, base + Math.sign(delta)));
        lastDegree[ch] = next;
        setDraft(withGroveCell(draft, ch, s, next));
        options.onPreview(ch, next);
        say(cellLabel(ch, s));
    }

    function clearCell(ch: number, s: number): void {
        if (!canWrite(ch)) return say(lockedMessage(ch));
        setDraft(withGroveCell(draft, ch, s, GROVE_REST));
        say(cellLabel(ch, s));
    }

    function toggleAudition(): void {
        if (auditioning) {
            auditioning = false;
            options.onAudition(null);
            say('Audition stopped');
        } else {
            const blocked = options.auditionBlocked();
            if (blocked) return say(blocked);
            auditioning = true;
            options.onAudition(draft);
            say('Auditioning the pattern');
        }
        renderToolbar();
    }

    function save(): ComposerSaveResult {
        if (readOnly) {
            say(readOnly);
            return { ok: false, message: readOnly };
        }
        if (sameGrovePattern(draft, saved)) {
            const message = 'Nothing to save';
            say(message);
            return { ok: false, message };
        }
        const result = options.onSave(cloneGrovePattern(draft));
        if (result.ok) saved = cloneGrovePattern(draft);
        say(result.message);
        renderToolbar();
        return result;
    }

    function takeSaved(pattern: GrovePattern | null, what: string): void {
        if (!pattern) return say(`Couldn't ${what}`);
        saved = cloneGrovePattern(pattern);
        setDraft(cloneGrovePattern(pattern));
        say(what === 'undo' ? 'Undone' : 'Redone');
    }

    // -- Wiring ---------------------------------------------------------------

    closeButton.addEventListener('click', () => close());
    auditionButton.addEventListener('click', toggleAudition);
    pitchUp.addEventListener('click', () => enabled(pitchUp) && nudgePitch(1));
    pitchDown.addEventListener('click', () => enabled(pitchDown) && nudgePitch(-1));
    clearRow.addEventListener('click', () => {
        if (!enabled(clearRow)) return say(lockedMessage(selected.channel));
        setDraft(withGroveRowCleared(draft, selected.channel));
        say(`${COMPOSER_VOICES[selected.channel].name} cleared`);
    });
    reset.addEventListener('click', () => {
        if (!enabled(reset)) return say(readOnly ?? '');
        setDraft(defaultGrovePattern(saved.seed));
        say("Reset to the stone's default pattern; save to keep it");
    });
    saveButton.addEventListener('click', () => void save());
    undoButton.addEventListener('click', () => {
        if (enabled(undoButton)) takeSaved(options.undo(), 'undo');
    });
    redoButton.addEventListener('click', () => {
        if (enabled(redoButton)) takeSaved(options.redo(), 'redo');
    });

    grid.addEventListener('keydown', (event: KeyboardEvent) => {
        const target = event.target as HTMLElement | null;
        const chAttr = target?.getAttribute?.('data-channel');
        const stepAttr = target?.getAttribute?.('data-step');
        if (
            chAttr === null ||
            chAttr === undefined ||
            stepAttr === null ||
            stepAttr === undefined
        ) {
            return;
        }
        const ch = Number(chAttr);
        const s = Number(stepAttr);
        let handled = true;
        switch (event.key) {
            case 'ArrowRight':
                focusCell(ch, (s + 1) % GROVE_STEPS);
                break;
            case 'ArrowLeft':
                focusCell(ch, (s + GROVE_STEPS - 1) % GROVE_STEPS);
                break;
            case 'ArrowDown':
                focusCell((ch + 1) % GROVE_CHANNELS, s);
                break;
            case 'ArrowUp':
                focusCell((ch + GROVE_CHANNELS - 1) % GROVE_CHANNELS, s);
                break;
            case 'Home':
                focusCell(ch, 0);
                break;
            case 'End':
                focusCell(ch, GROVE_STEPS - 1);
                break;
            case '+':
            case '=':
            case 'PageUp':
                nudgePitch(1);
                break;
            case '-':
            case '_':
            case 'PageDown':
                nudgePitch(-1);
                break;
            case 'Delete':
            case 'Backspace':
                clearCell(ch, s);
                break;
            default:
                handled = false;
        }
        if (handled) event.preventDefault();
    });
    // Escape is consumed here: left to bubble, the global handler would also re-lock the pointer
    // or raise the pause overlay over the dialog.
    panel.root.addEventListener('keydown', (event: KeyboardEvent) => {
        if (event.key === 'Escape') event.stopPropagation();
    });

    function open(): void {
        if (opened) return;
        opened = true;
        render();
        panel.show();
        popMenuContext = input.pushContext('menu');
        releaseTrap = trapFocusInside(panel.root, { onEscape: close, skipAutoFocus: true });
        padOff.push(
            input.onPress('composer.pitch', (s) => nudgePitch(s.value < 0 ? -1 : 1), {
                repeat: true,
            }),
            input.onPress('composer.audition', () => toggleAudition()),
            input.onPress('composer.save', () => void save())
        );
        focusCell(selected.channel, selected.step);
    }

    function close(): void {
        if (!opened) return;
        opened = false;
        if (auditioning) {
            auditioning = false;
            options.onAudition(null);
        }
        for (const off of padOff.splice(0)) off();
        // Release the trap first: its cleanup puts focus back where it was.
        releaseTrap?.();
        releaseTrap = null;
        popMenuContext?.();
        popMenuContext = null;
        panel.hide();
        options.onClose?.();
    }

    document.body.appendChild(panel.root);

    return {
        root: panel.root,
        open,
        close,
        isOpen: () => opened,
        destroy() {
            close();
            panel.destroy();
        },
        draft: () => cloneGrovePattern(draft),
        dirty: () => !sameGrovePattern(draft, saved),
        syncSaved(pattern) {
            const pending = !sameGrovePattern(draft, saved);
            saved = cloneGrovePattern(pattern);
            if (!pending) setDraft(cloneGrovePattern(pattern));
            else renderToolbar();
        },
        cell: (ch, s) => cells[ch][s],
        focusCell,
        nudgePitch,
        toggleAudition,
        save,
    };
}
