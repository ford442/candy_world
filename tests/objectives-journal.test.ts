/**
 * Melody journal (#2028 slice B): src/gameplay/objectives/journal.ts.
 *
 * Mock-DOM style of tests/focus-trap.test.ts, but the kit (`el`, `createPanel`, tooltip), the real
 * `trapFocusInside` and the real `input` singleton run against it, so what is checked is the actual
 * wiring: opening holds the `menu` input context and traps focus; Escape and the close button hide
 * the panel, release the trap, pop the context and give focus back to the button.
 *
 * Run: npx tsx tests/objectives-journal.test.ts
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// ============================================================================
// Minimal DOM: just what the kit, the focus trap and the journal touch
// ============================================================================

type Handler = (event: any) => void;

class FakeEl {
    tagName: string;
    id = '';
    hidden = false;
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
    }
    get isConnected(): boolean {
        let n: FakeEl | null = this;
        while (n) {
            if (n === doc.body) return true;
            n = n.parent;
        }
        return false;
    }
    /** Visible unless this or an ancestor is `hidden` (stand-in for layout). */
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
    /** The selectors the kit and `trapFocusInside` use: `.class`, `#id`, and the focusable list. */
    querySelectorAll(selector: string): FakeEl[] {
        if (selector.startsWith('.'))
            return this.all().filter((n) => n.classes.has(selector.slice(1)));
        if (selector.startsWith('#')) return this.all().filter((n) => n.id === selector.slice(1));
        // trapFocusInside's focusable list
        return this.all().filter((n) => {
            if (n.tagName === 'A') return n.hasAttribute('href');
            if (n.tagName === 'BUTTON') return !n.hasAttribute('disabled');
            const tab = n.getAttribute('tabindex');
            return tab !== null && tab !== '-1';
        });
    }
    querySelector(selector: string): FakeEl | null {
        return this.querySelectorAll(selector)[0] ?? null;
    }
}

const doc: {
    body: FakeEl;
    activeElement: FakeEl;
    pointerLockElement: null;
    createElement(tag: string): FakeEl;
    getElementById(id: string): FakeEl | null;
    addEventListener(): void;
    removeEventListener(): void;
} = {
    body: new FakeEl('body'),
    activeElement: null as unknown as FakeEl,
    pointerLockElement: null,
    createElement: (tag) => new FakeEl(tag),
    getElementById: (id) =>
        doc.body.id === id ? doc.body : (doc.body.all().find((n) => n.id === id) ?? null),
    addEventListener() {},
    removeEventListener() {},
};
doc.activeElement = doc.body;
(globalThis as any).document = doc;
(globalThis as any).window = {
    addEventListener() {},
    removeEventListener() {},
    innerWidth: 1024,
};

// ============================================================================
// Harness
// ============================================================================

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
const { mountJournal, JOURNAL_ID, JOURNAL_BUTTON_ID } =
    await import('../src/gameplay/objectives/journal.ts');
const { createObjectiveSystem } = await import('../src/gameplay/objectives/objective-system.ts');
const { parseMelodyFile } = await import('../src/gameplay/objectives/schema.ts');

const MEADOW = parseMelodyFile('meadow.json', {
    id: 'meadow',
    title: 'Meadow Melody',
    steps: [
        {
            id: 'fern',
            text: 'Harvest a fern core.',
            trigger: { kind: 'harvest', item: 'fern_core', count: 1 },
        },
        {
            id: 'nectar',
            text: 'Harvest vibrato nectar.',
            trigger: { kind: 'harvest', item: 'vibrato_nectar', count: 1 },
        },
    ],
});
const CAVES = parseMelodyFile('sugar-caves.json', {
    id: 'sugar-caves',
    title: 'Sugar Caves',
    steps: [
        { id: 'wake', text: 'Awaken three glowing plants.', trigger: { kind: 'awaken', count: 3 } },
    ],
});

function world() {
    const items = new Map<string, number>();
    let awakened = 0;
    const system = createObjectiveSystem({
        melodies: [MEADOW, CAVES],
        snapshot: {
            itemCount: (id) => items.get(id) ?? 0,
            isDiscovered: () => false,
            awakenedCount: () => awakened,
        },
        announce: () => {},
    });
    system.evaluate();
    return {
        system,
        give: (id: string) => items.set(id, (items.get(id) ?? 0) + 1),
        awaken: (n: number) => (awakened += n),
    };
}

/** A fresh HUD (with a stand-in ability slot) and a mounted journal. */
function mount(options: { hud?: boolean } = {}) {
    doc.body.replaceChildren();
    doc.activeElement = doc.body;
    const hud = new FakeEl('div');
    hud.id = 'ability-hud';
    if (options.hud !== false) doc.body.appendChild(hud);
    const w = world();
    const journal = mountJournal(w.system as any);
    const root = journal.root as unknown as FakeEl;
    const button = journal.button as unknown as FakeEl;
    const closeButton = root.all().find((n) => n.classes.has('journal-close'))!;
    const bodyText = () => root.querySelector('.journal-body')!.textContent;
    const keydown = (key: string) => {
        const event = {
            key,
            keyCode: key === 'Tab' ? 9 : 0,
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
        root.dispatch('keydown', event);
        return event;
    };
    return { ...w, journal, root, button, closeButton, hud, bodyText, keydown };
}

const menuOpen = () => input.isContextActive('menu');

// ============================================================================
// Tests
// ============================================================================

test('mounts hidden, as a labelled modal dialog, with its button inside #ability-hud', () => {
    const { root, button, hud, journal } = mount();
    assert.equal(root.id, JOURNAL_ID);
    assert.equal(root.getAttribute('role'), 'dialog');
    assert.equal(root.getAttribute('aria-modal'), 'true');
    assert.ok(root.getAttribute('aria-label'), 'a dialog needs a name');
    assert.equal(root.hidden, true);
    assert.equal(root.getAttribute('aria-hidden'), 'true');
    assert.equal(root.parent, doc.body);

    assert.equal(button.id, JOURNAL_BUTTON_ID);
    assert.equal(button.parent, hud, 'the open button lives in the ability HUD');
    assert.equal(button.tagName, 'BUTTON');
    assert.equal(button.getAttribute('aria-haspopup'), 'dialog');
    assert.equal(button.getAttribute('aria-controls'), JOURNAL_ID);
    assert.equal(button.getAttribute('aria-expanded'), 'false');
    assert.ok(button.getAttribute('aria-label'));
    assert.equal(journal.isOpen(), false);
    assert.equal(menuOpen(), false, 'nothing is held while closed');
    journal.destroy();
});

test('the button opens it: visible, menu context held, focus inside, Melodies listed', () => {
    const { journal, root, button, closeButton, bodyText } = mount();
    button.focus();
    button.click();
    assert.equal(journal.isOpen(), true);
    assert.equal(root.hidden, false);
    assert.equal(root.getAttribute('aria-hidden'), null);
    assert.equal(button.getAttribute('aria-expanded'), 'true');
    assert.equal(menuOpen(), true, 'the menu input context is held while open');
    assert.equal(doc.activeElement, closeButton, 'focus moves into the dialog');

    const text = bodyText();
    assert.match(text, /In progress/);
    assert.match(text, /Meadow Melody/);
    assert.match(text, /Step 1 of 2/);
    assert.match(text, /Harvest a fern core\./, 'the current step is shown');
    assert.match(text, /Sugar Caves/);
    assert.match(text, /Completed/);
    assert.match(text, /None yet\./);
    journal.destroy();
});

test('Tab is trapped: from the last focusable it wraps and is prevented', () => {
    const { journal, button, keydown, closeButton } = mount();
    button.click();
    assert.equal(doc.activeElement, closeButton);
    // The close button is the only focusable element, so it is both first and last.
    const tab = keydown('Tab');
    assert.equal(tab.prevented, true, 'the trap handled Tab');
    assert.equal(tab.stopped, false, 'only Escape is consumed');
    assert.equal(doc.activeElement, closeButton, 'focus stays inside the dialog');
    journal.destroy();
});

test('Escape closes it: hidden, trap released, menu context popped, focus back on the button', () => {
    const { journal, root, button, keydown } = mount();
    button.focus();
    button.click();
    assert.equal(root.listenerCount('keydown'), 2, 'the Escape guard and the focus trap');

    const escape = keydown('Escape');
    assert.equal(escape.prevented, true, 'the trap consumed it');
    assert.equal(escape.stopped, true, 'it does not reach the global handler (pause overlay)');
    assert.equal(journal.isOpen(), false);
    assert.equal(root.hidden, true);
    assert.equal(root.getAttribute('aria-hidden'), 'true');
    assert.equal(button.getAttribute('aria-expanded'), 'false');
    assert.equal(menuOpen(), false, 'the menu context is popped');
    assert.equal(root.listenerCount('keydown'), 1, 'the trap is released');
    assert.equal(doc.activeElement, button, 'focus returns to where it was');
    journal.destroy();
});

test('the close button closes it the same way', () => {
    const { journal, root, button, closeButton } = mount();
    button.focus();
    button.click();
    closeButton.click();
    assert.equal(journal.isOpen(), false);
    assert.equal(root.hidden, true);
    assert.equal(menuOpen(), false);
    assert.equal(root.listenerCount('keydown'), 1);
    assert.equal(doc.activeElement, button);
    journal.destroy();
});

test('the button toggles, and opening twice holds the menu context once', () => {
    const { journal, button } = mount();
    journal.open();
    journal.open(); // a second open must not stack a second context
    assert.equal(menuOpen(), true);
    button.click(); // toggles closed
    assert.equal(journal.isOpen(), false);
    assert.equal(menuOpen(), false, 'one pop undoes the one push');
    journal.close(); // closing when closed is a no-op
    button.click();
    assert.equal(journal.isOpen(), true);
    journal.destroy();
    assert.equal(menuOpen(), false);
});

test('it re-renders while open when the Melodies change', () => {
    const { journal, give, system, bodyText, button } = mount();
    button.click();
    assert.match(bodyText(), /Step 1 of 2/);
    give('fern_core');
    system.evaluate();
    assert.match(bodyText(), /Step 2 of 2/);
    assert.match(bodyText(), /Harvest vibrato nectar\./);
    give('vibrato_nectar');
    system.evaluate();
    // Completed Melodies move to their own list.
    const text = bodyText();
    assert.match(text, /✓Meadow Melody/);
    assert.doesNotMatch(text, /Harvest vibrato nectar\./);
    journal.destroy();
});

test('it renders fresh on open, picking up changes made while it was closed', () => {
    const { journal, awaken, system, bodyText } = mount();
    awaken(3);
    system.evaluate();
    journal.open();
    assert.match(bodyText(), /✓Sugar Caves/);
    journal.destroy();
});

test('destroy closes it, removes its nodes and stops listening', () => {
    const { journal, system, button, root, give } = mount();
    journal.open();
    journal.destroy();
    assert.equal(menuOpen(), false);
    assert.equal(doc.getElementById(JOURNAL_ID), null);
    assert.equal(doc.getElementById(JOURNAL_BUTTON_ID), null);
    assert.equal(button.parent, null);
    assert.equal(root.parent, null);
    give('fern_core');
    assert.doesNotThrow(() => system.evaluate(), 'a destroyed journal no longer renders');
});

test('without an ability HUD it warns and still works through its API', () => {
    const warn = console.warn;
    const warnings: unknown[] = [];
    console.warn = (...a: unknown[]) => void warnings.push(a);
    try {
        const { journal, root, button } = mount({ hud: false });
        assert.equal(warnings.length, 1);
        assert.equal(button.parent, null, 'no stray button on the page');
        journal.open();
        assert.equal(root.hidden, false);
        journal.close();
        assert.equal(root.hidden, true);
        journal.destroy();
    } finally {
        console.warn = warn;
    }
});

// ---------------------------------------------------------------------------
// What the journal relies on elsewhere: photo mode hides it, pointer lock ignores it
// ---------------------------------------------------------------------------

const SRC = fileURLToPath(new URL('../src', import.meta.url));
const read = (...p: string[]) => readFileSync(join(SRC, ...p), 'utf8');

test('photo mode lists the journal in its HUD selectors', () => {
    const text = read('systems', 'photo-mode', 'photo-mode.ts');
    const m = text.match(/const HUD_SELECTORS = \[([^\]]*)\]/);
    assert.ok(m, 'could not find HUD_SELECTORS');
    const selectors = [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
    assert.ok(selectors.includes(`#${JOURNAL_ID}`), `HUD_SELECTORS lacks #${JOURNAL_ID}`);
    assert.ok(selectors.includes('#ability-hud'), 'the open button hides with #ability-hud');
});

test('a click in the dialog or the HUD button does not re-acquire pointer lock', () => {
    // isInteractiveTarget() treats [role="dialog"] and #ability-hud as UI.
    const text = read('core', 'input', 'input', 'menu-helpers.ts');
    const fn = text.slice(text.indexOf('export function isInteractiveTarget'));
    assert.match(fn.slice(0, 400), /\[role="dialog"\]/);
    assert.match(fn.slice(0, 400), /#ability-hud/);
});

if (failures > 0) {
    console.error(`\n${failures} objectives-journal test(s) failed`);
    process.exit(1);
}
console.log('\nobjectives-journal: all tests passed');
