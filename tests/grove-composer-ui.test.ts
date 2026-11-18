/**
 * Grove composer editor (#1976 slice C): src/systems/composer/composer-ui.ts.
 *
 * Mock-DOM style of tests/objectives-journal.test.ts: the Candy UI Kit, the real
 * `trapFocusInside` and the real `input` singleton run against a minimal DOM, so what is checked
 * is the actual wiring:
 *
 * - screen reader: a labelled modal dialog; every key names its voice, step and note; locked
 *   rows say what unlocks them; results land in a `role="status"` line;
 * - keyboard: arrows / Home / End move a roving tabindex, + / - change pitch, Delete clears;
 * - touch / mouse: keys and toolbar are buttons (click);
 * - gamepad: the `menu` context is held, LB/RB change pitch, X auditions, Y saves;
 * - focus and close: focus starts on a key, Escape and the close button release the trap, pop
 *   the context, stop the audition and hand focus back;
 * - save / undo / read-only behaviour.
 *
 * Run: npx tsx tests/grove-composer-ui.test.ts
 */

import assert from 'node:assert/strict';

// ============================================================================
// Minimal DOM
// ============================================================================

type Handler = (event: any) => void;

class FakeEl {
    tagName: string;
    id = '';
    hidden = false;
    value = '';
    style: Record<string, string> = {};
    parent: FakeEl | null = null;
    children: FakeEl[] = [];
    attrs = new Map<string, string>();
    classes = new Set<string>();
    listeners = new Map<string, Handler[]>();
    private text = '';

    constructor(tag: string) {
        this.tagName = tag.toUpperCase();
    }

    get classList() {
        return {
            add: (c: string) => void this.classes.add(c),
            remove: (c: string) => void this.classes.delete(c),
            contains: (c: string) => this.classes.has(c),
            toggle: (c: string, on?: boolean) =>
                (on ?? !this.classes.has(c))
                    ? void this.classes.add(c)
                    : void this.classes.delete(c),
        };
    }
    get textContent(): string {
        return this.text + this.children.map((c) => c.textContent).join('');
    }
    set textContent(value: string) {
        this.text = value;
        this.children = [];
    }
    setAttribute(name: string, value: string) {
        this.attrs.set(name, String(value));
        if (name === 'id') this.id = String(value);
    }
    getAttribute(name: string): string | null {
        return this.attrs.get(name) ?? null;
    }
    removeAttribute(name: string) {
        this.attrs.delete(name);
    }
    hasAttribute(name: string) {
        return this.attrs.has(name);
    }
    appendChild(child: FakeEl): FakeEl {
        child.remove();
        child.parent = this;
        this.children.push(child);
        return child;
    }
    replaceChildren(...nodes: FakeEl[]) {
        for (const c of this.children) c.parent = null;
        this.children = [];
        this.text = '';
        for (const n of nodes) this.appendChild(n);
    }
    remove() {
        if (!this.parent) return;
        this.parent.children = this.parent.children.filter((c) => c !== this);
        this.parent = null;
    }
    addEventListener(type: string, fn: Handler) {
        this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
    }
    removeEventListener(type: string, fn: Handler) {
        this.listeners.set(
            type,
            (this.listeners.get(type) ?? []).filter((f) => f !== fn)
        );
    }
    listenerCount(type: string) {
        return (this.listeners.get(type) ?? []).length;
    }
    dispatch(type: string, event: any = {}) {
        for (const fn of [...(this.listeners.get(type) ?? [])]) fn(event);
    }
    click() {
        this.dispatch('click', {});
    }
    focus() {
        doc.activeElement = this;
        this.dispatch('focus', {});
    }
    get isConnected(): boolean {
        for (let n: FakeEl | null = this; n; n = n.parent) if (n === doc.body) return true;
        return false;
    }
    get offsetParent(): object | null {
        for (let n: FakeEl | null = this; n; n = n.parent) if (n.hidden) return null;
        return {};
    }
    contains(node: FakeEl | null): boolean {
        for (let n = node; n; n = n.parent) if (n === this) return true;
        return false;
    }
    getBoundingClientRect() {
        return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 };
    }
    all(): FakeEl[] {
        return this.children.flatMap((c) => [c, ...c.all()]);
    }
    querySelectorAll(selector: string): FakeEl[] {
        if (selector.startsWith('.'))
            return this.all().filter((n) => n.classes.has(selector.slice(1)));
        if (selector.startsWith('#')) return this.all().filter((n) => n.id === selector.slice(1));
        return this.all().filter((n) => {
            if (n.tagName === 'A') return n.hasAttribute('href');
            if (n.tagName === 'BUTTON' || n.tagName === 'SELECT')
                return !n.hasAttribute('disabled');
            const tab = n.getAttribute('tabindex');
            return tab !== null && tab !== '-1';
        });
    }
    querySelector(selector: string): FakeEl | null {
        return this.querySelectorAll(selector)[0] ?? null;
    }
}

const doc: any = {
    body: new FakeEl('body'),
    activeElement: null as unknown as FakeEl,
    pointerLockElement: null,
    createElement: (tag: string) => new FakeEl(tag),
    getElementById: (id: string) => doc.body.all().find((n: FakeEl) => n.id === id) ?? null,
    addEventListener() {},
    removeEventListener() {},
};
doc.activeElement = doc.body;
(globalThis as any).document = doc;
(globalThis as any).window = { addEventListener() {}, removeEventListener() {}, innerWidth: 1024 };

let failures = 0;
function test(name: string, fn: () => void): void {
    try {
        fn();
        console.log(`✅ ${name}`);
    } catch (err) {
        failures++;
        console.error(`❌ ${name}\n   ${err instanceof Error ? err.stack : String(err)}`);
    }
}

const { input } = await import('../src/core/input/actions/index.ts');
const { mountComposerEditor, COMPOSER_ID } = await import('../src/systems/composer/composer-ui.ts');
const gp = await import('../src/world/document/grove-pattern.ts');
type GrovePattern = import('../src/world/document/grove-pattern.ts').GrovePattern;

const ALL = [true, true, true, true, true, true, true, true];
const STARTER = [true, false, true, true, false, false, false, false];

function mount(
    opts: {
        voices?: boolean[];
        readOnly?: string | null;
        pattern?: GrovePattern;
        blocked?: string | null;
        canUndo?: boolean;
    } = {}
) {
    doc.body.replaceChildren();
    const opener = new FakeEl('canvas');
    doc.body.appendChild(opener);
    opener.focus();
    const calls = {
        audition: [] as Array<GrovePattern | null>,
        preview: [] as Array<[number, number]>,
        saves: [] as GrovePattern[],
        undos: 0,
        announced: [] as string[],
        closed: 0,
    };
    const pattern = opts.pattern ?? gp.emptyGrovePattern(5);
    const undoTo = gp.withGroveCell(pattern, 2, 0, 4);
    const editor = mountComposerEditor({
        stoneId: 'stone-1',
        pattern,
        voices: opts.voices ?? ALL,
        readOnly: opts.readOnly ?? null,
        cues: [
            { id: 'grove.geyser', label: 'grove.geyser' },
            { id: 'island.glow', label: 'island.glow (needs Island Scholar)' },
        ],
        keyLabel: 'G lydian',
        noteName: (ch, d) => `N${ch}.${d}`,
        auditionBlocked: () => opts.blocked ?? null,
        onAudition: (p) => calls.audition.push(p),
        onPreview: (ch, d) => calls.preview.push([ch, d]),
        onSave: (p) => {
            calls.saves.push(p);
            return { ok: true, message: 'Saved: 1 note on this stone' };
        },
        undo: () => {
            calls.undos++;
            return undoTo;
        },
        redo: () => null,
        canUndo: () => opts.canUndo ?? false,
        canRedo: () => false,
        onClose: () => calls.closed++,
        announce: (m) => calls.announced.push(m),
    });
    const root = editor.root as unknown as FakeEl;
    const byClass = (c: string) => root.all().filter((n) => n.classes.has(c));
    const button = (label: RegExp) =>
        root
            .all()
            .find((n) => n.tagName === 'BUTTON' && label.test(n.getAttribute('aria-label') ?? ''))!;
    const cell = (ch: number, s: number) => editor.cell(ch, s) as unknown as FakeEl;
    const grid = byClass('composer-grid')[0];
    const keydown = (key: string, target: FakeEl = doc.activeElement, on: FakeEl = grid) => {
        const event = {
            key,
            keyCode: key === 'Tab' ? 9 : 0,
            target,
            shiftKey: false,
            prevented: false,
            stopped: false,
            preventDefault() {
                this.prevented = true;
            },
            stopPropagation() {
                this.stopped = true;
            },
        };
        on.dispatch('keydown', event);
        return event;
    };
    const status = () => byClass('composer-status')[0].textContent;
    const pad = (source: string) => {
        input.press(source, {}, 'gamepad');
        input.sample();
        input.release(source);
        input.sample();
    };
    return {
        editor,
        root,
        calls,
        byClass,
        button,
        cell,
        grid,
        keydown,
        status,
        opener,
        pad,
        undoTo,
    };
}

const menuOpen = () => input.isContextActive('menu');
const tabbable = (root: FakeEl) =>
    root.all().filter((n) => n.classes.has('composer-cell') && n.getAttribute('tabindex') === '0');

// ============================================================================
// Tests
// ============================================================================

test('mounts hidden as a labelled modal dialog: 8 voice rows of 16 named keys', () => {
    const { root, editor, byClass } = mount({ voices: STARTER });
    assert.equal(root.id, COMPOSER_ID);
    assert.equal(root.getAttribute('role'), 'dialog');
    assert.equal(root.getAttribute('aria-modal'), 'true');
    assert.ok(root.getAttribute('aria-label'));
    assert.ok(root.getAttribute('aria-describedby'), 'the key help is linked');
    assert.equal(root.hidden, true);
    assert.equal(editor.isOpen(), false);

    const rows = byClass('composer-row');
    assert.equal(rows.length, 8);
    assert.equal(rows[0].getAttribute('role'), 'group');
    assert.equal(rows[0].getAttribute('aria-label'), 'Kick');
    assert.match(
        rows[1].getAttribute('aria-label')!,
        /Lead pad \(locked: Finish the Meadow Melody\)/
    );
    const cells = byClass('composer-cell');
    assert.equal(cells.length, 128);
    for (const c of cells) assert.equal(c.tagName, 'BUTTON');
    assert.equal(byClass('composer-status')[0].getAttribute('role'), 'status');
    const cues = byClass('composer-cue');
    assert.equal(cues.length, 8);
    assert.equal(cues[2].getAttribute('aria-label'), 'Living Score cue for Melody');
    assert.ok(cues[1].hasAttribute('disabled'), 'a locked row cannot take a cue');
    editor.destroy();
});

test('opening holds the menu context, traps focus and puts focus on the first key', () => {
    const { editor, root, cell } = mount();
    editor.open();
    assert.equal(editor.isOpen(), true);
    assert.equal(root.hidden, false);
    assert.equal(menuOpen(), true);
    assert.equal(doc.activeElement, cell(0, 0));
    assert.equal(tabbable(root).length, 1, 'roving tabindex: exactly one key is tabbable');
    assert.equal(cell(0, 0).getAttribute('aria-label'), 'Kick, step 1: rest');
    assert.equal(cell(0, 0).getAttribute('aria-pressed'), 'false');
    editor.destroy();
    assert.equal(menuOpen(), false);
});

test('keyboard: arrows, Home and End move the roving focus, wrapping', () => {
    const { editor, root, cell, keydown } = mount();
    editor.open();
    let e = keydown('ArrowRight');
    assert.equal(e.prevented, true);
    assert.equal(doc.activeElement, cell(0, 1));
    keydown('ArrowLeft');
    keydown('ArrowLeft');
    assert.equal(doc.activeElement, cell(0, 15), 'left from step 1 wraps to step 16');
    keydown('ArrowDown');
    assert.equal(doc.activeElement, cell(1, 15));
    keydown('ArrowUp');
    keydown('ArrowUp');
    assert.equal(doc.activeElement, cell(7, 15), 'up from the first voice wraps to the last');
    keydown('Home');
    assert.equal(doc.activeElement, cell(7, 0));
    keydown('End');
    assert.equal(doc.activeElement, cell(7, 15));
    assert.deepEqual(tabbable(root), [cell(7, 15)]);
    e = keydown('a');
    assert.equal(e.prevented, false, 'other keys are left alone');
    editor.destroy();
});

test('keyboard: Enter/Space (a click) toggle, + and - change pitch, Delete clears', () => {
    const { editor, cell, keydown, calls } = mount();
    editor.open();
    editor.focusCell(2, 3);
    cell(2, 3).click(); // Enter or Space on a focused button is a click
    assert.equal(cell(2, 3).getAttribute('aria-pressed'), 'true');
    assert.equal(cell(2, 3).getAttribute('aria-label'), 'Melody, step 4: N2.0, on');
    assert.equal(editor.draft().channels[2].notes[3], 0);
    assert.deepEqual(calls.preview.at(-1), [2, 0], 'a lit key is heard');
    keydown('+');
    keydown('+');
    assert.equal(editor.draft().channels[2].notes[3], 2);
    keydown('PageDown');
    assert.equal(editor.draft().channels[2].notes[3], 1);
    assert.match(calls.announced.at(-1)!, /Melody, step 4: N2\.1, on/, 'changes are spoken');
    keydown('Delete');
    assert.equal(editor.draft().channels[2].notes[3], gp.GROVE_REST);
    assert.equal(cell(2, 3).getAttribute('aria-pressed'), 'false');
    // The row remembers its pitch: the next lit key starts there.
    keydown('ArrowRight');
    cell(2, 4).click();
    assert.equal(editor.draft().channels[2].notes[4], 1);
    for (let i = 0; i < 20; i++) keydown('+');
    assert.equal(editor.draft().channels[2].notes[4], gp.GROVE_MAX_DEGREE, 'pitch clamps');
    editor.destroy();
});

test('touch: tapping keys and the pitch buttons edits the selected key', () => {
    const { editor, cell, button } = mount();
    editor.open();
    cell(3, 8).click();
    assert.equal(editor.draft().channels[3].notes[8], 0);
    button(/^Raise the selected key/).click();
    button(/^Raise the selected key/).click();
    assert.equal(editor.draft().channels[3].notes[8], 2);
    button(/^Lower the selected key/).click();
    assert.equal(editor.draft().channels[3].notes[8], 1);
    cell(3, 8).click();
    assert.equal(editor.draft().channels[3].notes[8], gp.GROVE_REST, 'a second tap clears it');
    cell(3, 9).click();
    cell(3, 10).click();
    button(/^Clear the selected row/).click();
    assert.equal(gp.groveNoteCount(editor.draft()), 0);
    editor.destroy();
});

test('locked voices: their keys are marked and refuse edits, saying what unlocks them', () => {
    const { editor, cell, status, keydown } = mount({ voices: STARTER });
    editor.open();
    assert.equal(cell(1, 0).getAttribute('aria-disabled'), 'true');
    assert.equal(cell(0, 0).getAttribute('aria-disabled'), null);
    cell(1, 0).click();
    assert.equal(editor.draft().channels[1].notes[0], gp.GROVE_REST);
    assert.match(status(), /Lead pad is locked\. Finish the Meadow Melody/);
    keydown('+');
    assert.equal(editor.draft().channels[1].notes[0], gp.GROVE_REST, 'no pitch either');
    editor.destroy();
});

test('gamepad: LB/RB change pitch, X auditions, Y saves; nothing after close', () => {
    const { editor, cell, calls, pad } = mount();
    editor.open();
    editor.focusCell(2, 0);
    cell(2, 0).click();
    pad('pad:rb');
    pad('pad:rb');
    pad('pad:lb');
    assert.equal(editor.draft().channels[2].notes[0], 1);
    pad('pad:x');
    assert.equal(calls.audition.length, 1);
    assert.equal(calls.audition[0]!.channels[2].notes[0], 1, 'the audition plays the draft');
    cell(2, 1).click();
    assert.equal(calls.audition.at(-1)!.channels[2].notes[1], 1, 'edits reach the audition live');
    pad('pad:y');
    assert.equal(calls.saves.length, 1);
    assert.equal(calls.saves[0].channels[2].notes[0], 1);
    editor.close();
    assert.equal(calls.audition.at(-1), null, 'closing stops the audition');
    pad('pad:y');
    pad('pad:rb');
    assert.equal(calls.saves.length, 1, 'the pad actions are released on close');
    editor.destroy();
});

test('cues: a row binds a Living Score cue, and the save carries it', () => {
    const { editor, byClass, button, calls, status } = mount();
    editor.open();
    const select = byClass('composer-cue')[3];
    select.value = 'grove.geyser';
    select.dispatch('change', {});
    assert.equal(editor.draft().channels[3].cue, 'grove.geyser');
    assert.match(status(), /Arpeggio fires grove\.geyser/);
    button(/^Save the pattern/).click();
    assert.equal(calls.saves[0].channels[3].cue, 'grove.geyser');
    select.value = '';
    select.dispatch('change', {});
    assert.equal(editor.draft().channels[3].cue, undefined);
    editor.destroy();
});

test('save: only when there are changes; the result is announced; undo restores', () => {
    const { editor, button, cell, calls, status, undoTo } = mount({ canUndo: true });
    editor.open();
    const save = button(/^Save the pattern/);
    const undo = button(/^Undo/);
    assert.equal(save.getAttribute('aria-disabled'), 'true', 'nothing to save yet');
    assert.equal(undo.getAttribute('aria-disabled'), null, 'a saved compose can be undone');
    assert.equal(editor.save().ok, false);
    cell(0, 4).click();
    assert.equal(editor.dirty(), true);
    assert.equal(save.getAttribute('aria-disabled'), null);
    assert.equal(undo.getAttribute('aria-disabled'), 'true', 'no undo over unsaved changes');
    save.click();
    assert.equal(calls.saves.length, 1);
    assert.equal(editor.dirty(), false);
    assert.equal(status(), 'Saved: 1 note on this stone');
    assert.ok(calls.announced.includes('Saved: 1 note on this stone'));
    undo.click();
    assert.equal(calls.undos, 1);
    assert.ok(gp.sameGrovePattern(editor.draft(), undoTo), 'the draft is the stone after the undo');
    assert.equal(editor.dirty(), false);
    editor.destroy();
});

test('a peer edit (syncSaved) replaces a clean draft but never a pending one', () => {
    const { editor, cell } = mount();
    editor.open();
    const theirs = gp.withGroveCell(gp.emptyGrovePattern(5), 4, 4, 4);
    editor.syncSaved(theirs);
    assert.ok(gp.sameGrovePattern(editor.draft(), theirs));
    assert.equal(cell(4, 4).getAttribute('aria-pressed'), 'true');
    cell(0, 0).click();
    editor.syncSaved(gp.emptyGrovePattern(5));
    assert.equal(editor.draft().channels[0].notes[0], 0, 'the pending edit survives');
    assert.equal(editor.dirty(), true);
    editor.destroy();
});

test('read-only (a view-only shared world): browse and audition, but no edits or saves', () => {
    const lock = 'This shared world is view-only.';
    const { editor, cell, button, calls, status, byClass } = mount({ readOnly: lock });
    editor.open();
    assert.equal(cell(0, 0).getAttribute('aria-disabled'), 'true');
    cell(0, 0).click();
    assert.equal(gp.groveNoteCount(editor.draft()), 0);
    assert.equal(status(), lock);
    assert.equal(editor.save().ok, false);
    assert.equal(calls.saves.length, 0);
    assert.equal(button(/^Save the pattern/).getAttribute('aria-disabled'), 'true');
    assert.ok(byClass('composer-cue').every((s) => s.hasAttribute('disabled')));
    assert.match(byClass('composer-help')[0].textContent, /view-only/);
    button(/^Audition/).click();
    assert.equal(calls.audition.length, 1, 'a visitor can still listen');
    editor.destroy();
});

test('audition: blocked with a reason when there is no generative soundtrack', () => {
    const reason = 'Audition plays through the generative soundtrack';
    const { editor, button, calls, status } = mount({ blocked: reason });
    editor.open();
    const audition = button(/^Audition/);
    audition.click();
    assert.equal(calls.audition.length, 0);
    assert.equal(status(), reason);
    assert.equal(audition.getAttribute('aria-pressed'), 'false');
    editor.destroy();
});

test('Escape closes: trap released, context popped, audition stopped, focus back', () => {
    const { editor, root, keydown, calls, opener, button } = mount();
    editor.open();
    button(/^Audition/).click();
    assert.equal(root.listenerCount('keydown'), 2, 'the Escape guard and the focus trap');
    const esc = keydown('Escape', doc.activeElement, root);
    assert.equal(esc.prevented, true);
    assert.equal(esc.stopped, true, 'it does not reach the global handler (pause overlay)');
    assert.equal(editor.isOpen(), false);
    assert.equal(root.hidden, true);
    assert.equal(menuOpen(), false);
    assert.equal(root.listenerCount('keydown'), 1, 'the trap is released');
    assert.equal(calls.audition.at(-1), null);
    assert.equal(calls.closed, 1);
    assert.equal(doc.activeElement, opener, 'focus returns to where it was');
    editor.destroy();
});

test('the close button closes it the same way; opening twice pushes the context once', () => {
    const { editor, button, calls } = mount();
    editor.open();
    editor.open();
    button(/^Close composer/).click();
    assert.equal(editor.isOpen(), false);
    assert.equal(menuOpen(), false, 'one pop undoes the one push');
    assert.equal(calls.closed, 1);
    editor.close();
    assert.equal(calls.closed, 1, 'closing when closed is a no-op');
    editor.destroy();
    assert.equal(doc.getElementById(COMPOSER_ID), null, 'destroy removes the dialog');
});

test('a draft passed back in reopens where the player left off', () => {
    doc.body.replaceChildren();
    const saved = gp.emptyGrovePattern(9);
    const draft = gp.withGroveCell(saved, 2, 2, 5);
    const editor = mountComposerEditor({
        stoneId: 's',
        pattern: saved,
        draft,
        voices: ALL,
        readOnly: null,
        cues: [],
        keyLabel: 'C major',
        noteName: () => 'C5',
        auditionBlocked: () => null,
        onAudition: () => {},
        onPreview: () => {},
        onSave: () => ({ ok: true, message: '' }),
        undo: () => null,
        redo: () => null,
        canUndo: () => false,
        canRedo: () => false,
    });
    assert.equal(editor.dirty(), true);
    assert.equal(editor.draft().channels[2].notes[2], 5);
    editor.destroy();
});

if (failures > 0) {
    console.error(`\n${failures} grove composer editor test(s) failed`);
    process.exit(1);
}
console.log('\nAll grove composer editor tests passed');
process.exit(0);
