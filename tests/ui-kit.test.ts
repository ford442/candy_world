/**
 * Candy UI Kit Unit Tests
 *
 * Verifies the ARIA contract of the shared primitives (panel, meter,
 * shortcut hint, tooltip) against a minimal DOM mock — same approach as
 * tests/focus-trap.test.ts, no jsdom dependency.
 *
 * Run with: npx tsx tests/ui-kit.test.ts
 */

// ============================================================================
// Minimal DOM Mock (installed before importing the kit)
// ============================================================================

class MockElement {
    tagName: string;
    id = '';
    hidden = false;
    textContent = '';
    style: Record<string, any> = {};
    children: MockElement[] = [];
    parentNode: MockElement | null = null;
    attributes = new Map<string, string>();
    listeners: Array<{ type: string; handler: any }> = [];
    private classes = new Set<string>();

    classList = {
        add: (...cls: string[]) => cls.forEach((c) => this.classes.add(c)),
        remove: (...cls: string[]) => cls.forEach((c) => this.classes.delete(c)),
        contains: (cls: string) => this.classes.has(cls),
        toggle: (cls: string, force?: boolean) => {
            const on = force ?? !this.classes.has(cls);
            if (on) this.classes.add(cls);
            else this.classes.delete(cls);
            return on;
        },
    };

    constructor(tagName: string) {
        this.tagName = tagName.toUpperCase();
    }

    get className(): string {
        return [...this.classes].join(' ');
    }

    hasClass(cls: string): boolean {
        return this.classes.has(cls);
    }

    setAttribute(name: string, value: string) {
        this.attributes.set(name, String(value));
    }
    getAttribute(name: string): string | null {
        return this.attributes.has(name) ? this.attributes.get(name)! : null;
    }
    removeAttribute(name: string) {
        this.attributes.delete(name);
    }
    hasAttribute(name: string) {
        return this.attributes.has(name);
    }
    appendChild(child: MockElement) {
        child.parentNode = this;
        this.children.push(child);
        return child;
    }
    remove() {
        if (this.parentNode) {
            const i = this.parentNode.children.indexOf(this);
            if (i !== -1) this.parentNode.children.splice(i, 1);
        }
    }
    addEventListener(type: string, handler: any) {
        this.listeners.push({ type, handler });
    }
    removeEventListener(type: string, handler: any) {
        const i = this.listeners.findIndex((l) => l.type === type && l.handler === handler);
        if (i !== -1) this.listeners.splice(i, 1);
    }
    dispatch(type: string, event: any = {}) {
        this.listeners
            .filter((l) => l.type === type)
            .forEach((l) => l.handler({ currentTarget: this, ...event }));
    }
    matches() {
        return true;
    }
    querySelectorAll() {
        return [];
    }
    getBoundingClientRect() {
        return { top: 0, left: 0, bottom: 0, right: 0, width: 10, height: 10 };
    }
    /** Depth-first search by id, for assertions. */
    find(id: string): MockElement | null {
        if (this.id === id) return this;
        for (const child of this.children) {
            const hit = child.find(id);
            if (hit) return hit;
        }
        return null;
    }
    descendants(): MockElement[] {
        return this.children.flatMap((c) => [c, ...c.descendants()]);
    }
}

const mockBody = new MockElement('body');
const mockDocument = {
    body: mockBody,
    documentElement: new MockElement('html'),
    activeElement: null as any,
    pointerLockElement: null as any,
    createElement: (tag: string) => new MockElement(tag),
    getElementById: (id: string) => mockBody.find(id),
    addEventListener: () => {},
    removeEventListener: () => {},
};

(globalThis as any).document = mockDocument;
(globalThis as any).window = {
    innerWidth: 1280,
    innerHeight: 720,
    location: { search: '', href: 'http://localhost/' },
    navigator: { userAgent: 'node' },
    addEventListener: () => {},
    removeEventListener: () => {},
    matchMedia: () => ({ matches: false, addEventListener: () => {} }),
};

const { createPanel } = await import('../src/ui/kit/panel.ts');
const { createMeter } = await import('../src/ui/kit/meter.ts');
const { createShortcutHint, setShortcut } = await import('../src/ui/kit/shortcut-hint.ts');
const { attachTooltip } = await import('../src/ui/kit/tooltip.ts');
const { setKitTheme, getKitTheme } = await import('../src/ui/kit/theme.ts');

// ============================================================================
// Test Framework
// ============================================================================

const tests: { name: string; run: () => boolean | void }[] = [];
let passed = 0;
let failed = 0;

function test(name: string, fn: () => boolean | void): void {
    tests.push({ name, run: fn });
}

function assertEqual(actual: any, expected: any, msg?: string): void {
    if (actual !== expected) {
        throw new Error(`${msg ?? 'Assertion failed'}: expected ${expected}, got ${actual}`);
    }
}

function assertTrue(actual: any, msg?: string): void {
    if (actual !== true) throw new Error(`${msg ?? 'Assertion failed'}: expected true, got ${actual}`);
}

// ============================================================================
// Panel
// ============================================================================

test('Panel exposes a labelled ARIA region', () => {
    const panel = createPanel({ id: 'test-panel', label: 'Abilities' });
    const root = panel.root as unknown as MockElement;
    assertEqual(root.getAttribute('role'), 'region', 'role');
    assertEqual(root.getAttribute('aria-label'), 'Abilities', 'aria-label');
    assertEqual(root.id, 'test-panel', 'id');
});

test('Panel is pointer-inert by default and opt-out works', () => {
    const readOnly = createPanel({ label: 'Tracker' }).root as unknown as MockElement;
    assertTrue(readOnly.hasClass('ck-panel--inert'), 'read-only panel should be inert');

    const interactive = createPanel({ label: 'Abilities', inert: false }).root as unknown as MockElement;
    assertEqual(interactive.hasClass('ck-panel--inert'), false, 'interactive panel must take clicks');
});

test('Panel hide() marks the region aria-hidden, show() restores it', () => {
    const panel = createPanel({ label: 'Abilities' });
    const root = panel.root as unknown as MockElement;
    panel.hide();
    assertEqual(root.getAttribute('aria-hidden'), 'true', 'aria-hidden after hide');
    assertEqual(panel.isVisible(), false, 'isVisible after hide');
    panel.show();
    assertEqual(root.getAttribute('aria-hidden'), null, 'aria-hidden cleared after show');
    assertEqual(panel.isVisible(), true, 'isVisible after show');
});

test('Panel focus trap is idempotent and releasable', () => {
    const panel = createPanel({ label: 'Menu', role: 'dialog', inert: false });
    const release1 = panel.trapFocus();
    const release2 = panel.trapFocus();
    assertEqual(release1, release2, 'repeat trapFocus returns the same release');
    release1();
    panel.releaseFocus(); // must not throw when already released
});

// ============================================================================
// Meter
// ============================================================================

test('Meter is a progressbar with name, bounds and value text', () => {
    const meter = createMeter({ label: 'Energy Bar', max: 10, value: 4 });
    const root = meter.root as unknown as MockElement;
    assertEqual(root.getAttribute('role'), 'progressbar', 'role');
    assertEqual(root.getAttribute('aria-label'), 'Energy Bar', 'aria-label');
    assertEqual(root.getAttribute('aria-valuemin'), '0', 'aria-valuemin');
    assertEqual(root.getAttribute('aria-valuemax'), '10.0', 'aria-valuemax');
    assertEqual(root.getAttribute('aria-valuenow'), '4.0', 'aria-valuenow');
    assertEqual(root.getAttribute('aria-valuetext'), '4 out of 10 Energy', 'aria-valuetext');
    assertEqual((meter.fill as unknown as MockElement).style.width, '40%', 'fill width');
});

test('Meter reports low-state transitions once', () => {
    const meter = createMeter({ label: 'Energy Bar', max: 10, value: 10, lowThreshold: 0.3 });
    const root = meter.root as unknown as MockElement;
    assertEqual(meter.isLow(), false, 'starts healthy');

    assertEqual(meter.setValue(2), true, 'crossing into low reports a change');
    assertTrue(meter.isLow(), 'isLow after drop');
    assertEqual(root.getAttribute('data-ck-state'), 'low', 'data-ck-state set');

    assertEqual(meter.setValue(1), false, 'staying low reports no change');
    assertEqual(meter.setValue(9), true, 'recovering reports a change');
    assertEqual(root.getAttribute('data-ck-state'), null, 'data-ck-state cleared');
});

test('Meter clamps out-of-range values', () => {
    const meter = createMeter({ label: 'Energy Bar', max: 10, value: 0 });
    meter.setValue(-5);
    assertEqual((meter.fill as unknown as MockElement).style.width, '0%', 'clamped low');
    meter.setValue(50);
    assertEqual((meter.fill as unknown as MockElement).style.width, '100%', 'clamped high');
});

// ============================================================================
// Shortcut hint
// ============================================================================

test('Shortcut hint is decorative; the control carries aria-keyshortcuts', () => {
    const hint = createShortcutHint({ key: 'E', corner: true });
    const root = hint.root as unknown as MockElement;
    assertEqual(root.tagName, 'KBD', 'renders a <kbd>');
    assertEqual(root.getAttribute('aria-hidden'), 'true', 'badge hidden from AT');
    assertEqual(root.textContent, 'E', 'key text');

    hint.highlight(true);
    assertTrue(root.hasClass('ck-kbd--highlight'), 'highlight on');
    hint.highlight(false);
    assertEqual(root.hasClass('ck-kbd--highlight'), false, 'highlight off');

    const control = new MockElement('div');
    setShortcut(control as any, 'E');
    assertEqual(control.getAttribute('aria-keyshortcuts'), 'E', 'shortcut announced on the control');
});

// ============================================================================
// Tooltip
// ============================================================================

test('Tooltip links a persistent description via aria-describedby', () => {
    const control = new MockElement('div');
    control.setAttribute('title', 'Dash (E)');
    const tooltip = attachTooltip(control as any, { text: 'Dash (E)' });

    const describedBy = control.getAttribute('aria-describedby');
    assertTrue(!!describedBy, 'aria-describedby set');
    assertEqual(control.getAttribute('title'), null, 'native title removed to avoid a double tooltip');

    const srCopy = control.children.find((c) => c.id === describedBy);
    assertTrue(!!srCopy, 'description node is a child of the control');
    assertEqual(srCopy!.textContent, 'Dash (E)', 'description text');

    tooltip.setText('Dash (E) - Ready!');
    assertEqual(srCopy!.textContent, 'Dash (E) - Ready!', 'description follows setText');

    tooltip.destroy();
    assertEqual(control.getAttribute('aria-describedby'), null, 'unlinked on destroy');
    assertEqual(control.children.length, 0, 'description node removed');
});

test('Tooltip bubble stays hidden while the pointer is locked', () => {
    const control = new MockElement('div');
    const tooltip = attachTooltip(control as any, { text: 'Dash (E)' });

    const visibleBubble = () =>
        mockBody.children.find((c) => c.hasClass('ck-tooltip') && c.getAttribute('data-ck-visible') === 'true');

    mockDocument.pointerLockElement = mockBody;
    tooltip.show();
    assertEqual(visibleBubble(), undefined, 'no bubble while pointer-locked');

    mockDocument.pointerLockElement = null;
    tooltip.show();
    const bubble = mockBody.children.find((c) => c.hasClass('ck-tooltip'));
    assertTrue(!!bubble, 'bubble created once unlocked');
    assertEqual(bubble!.getAttribute('data-ck-visible'), 'true', 'bubble shows once unlocked');
    tooltip.hide();
    assertEqual(bubble!.getAttribute('data-ck-visible'), null, 'bubble hides');
    tooltip.destroy();
});

// ============================================================================
// Theme
// ============================================================================

test('Theme flips a single attribute on the document element', () => {
    setKitTheme(true);
    assertEqual(getKitTheme(), 'night', 'night theme active');
    assertEqual(mockDocument.documentElement.getAttribute('data-ck-theme'), 'night', 'attribute stamped');
    setKitTheme(false);
    assertEqual(mockDocument.documentElement.getAttribute('data-ck-theme'), null, 'attribute cleared');
});

// ============================================================================
// Run
// ============================================================================

console.log('🧪 Running Candy UI Kit Tests...\n');
for (const { name, run } of tests) {
    try {
        const result = run();
        if (result === false) {
            console.log(`❌ FAIL: ${name}`);
            failed++;
        } else {
            console.log(`✅ PASS: ${name}`);
            passed++;
        }
    } catch (error) {
        console.log(`❌ ERROR: ${name} - ${error}`);
        failed++;
    }
}
console.log(`\n📊 Results: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
