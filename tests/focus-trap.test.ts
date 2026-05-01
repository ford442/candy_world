/**
 * Focus Trap Unit Tests
 *
 * Lightweight mock-based test for trapFocusInside.
 * Run with: npx tsx tests/focus-trap.test.ts
 */

import { trapFocusInside } from '../src/utils/interaction-utils';

// ============================================================================
// Minimal DOM Mocks
// ============================================================================

interface MockElement {
  tagName: string;
  tabIndex: string | null;
  disabled: boolean;
  offsetParent: MockElement | null;
  _focused: boolean;
  focus(): void;
  blur(): void;
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string): void;
  querySelectorAll(selector: string): MockElement[];
  addEventListener(type: string, handler: EventListener): void;
  removeEventListener(type: string, handler: EventListener): void;
  dispatchEvent(event: KeyboardEvent): boolean;
}

function createMockElement(tagName: string = 'div', opts: { tabIndex?: string; disabled?: boolean; href?: string } = {}): MockElement {
  const listeners: Array<{ type: string; handler: EventListener }> = [];
  const el: MockElement = {
    tagName,
    tabIndex: opts.tabIndex ?? null,
    disabled: opts.disabled ?? false,
    offsetParent: {} as MockElement, // visible by default
    _focused: false,
    focus() {
      if (mockDocument.activeElement && mockDocument.activeElement !== el) {
        mockDocument.activeElement.blur();
      }
      el._focused = true;
      mockDocument.activeElement = el;
    },
    blur() {
      el._focused = false;
      if (mockDocument.activeElement === el) {
        mockDocument.activeElement = null;
      }
    },
    getAttribute(name: string) {
      if (name === 'tabindex') return el.tabIndex;
      if (name === 'href') return opts.href ?? null;
      return null;
    },
    setAttribute(name: string, value: string) {
      if (name === 'tabindex') el.tabIndex = value;
    },
    querySelectorAll() {
      return [];
    },
    addEventListener(type: string, handler: EventListener) {
      listeners.push({ type, handler });
    },
    removeEventListener(type: string, handler: EventListener) {
      const idx = listeners.findIndex(l => l.type === type && l.handler === handler);
      if (idx !== -1) listeners.splice(idx, 1);
    },
    dispatchEvent(event: KeyboardEvent) {
      listeners
        .filter(l => l.type === event.type)
        .forEach(l => (l.handler as any)(event));
      return !event.defaultPrevented;
    },
  };
  return el;
}

const mockDocument = {
  activeElement: null as MockElement | null,
};

// Patch global document reference used by trapFocusInside
(globalThis as any).document = mockDocument;

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
    throw new Error(msg ? `${msg}: expected ${expected}, got ${actual}` : `Expected ${expected}, got ${actual}`);
  }
}

function runTests(): void {
  console.log('🧪 Running Focus Trap Tests...\n');
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
}

// ============================================================================
// Tests
// ============================================================================

test('trapFocusInside auto-focuses first focusable element', () => {
  const container = createMockElement('div');
  const btn1 = createMockElement('button');
  const btn2 = createMockElement('button');

  container.querySelectorAll = () => [btn1, btn2];
  mockDocument.activeElement = null;

  const cleanup = trapFocusInside(container as any);

  assertEqual(mockDocument.activeElement, btn1, 'First button should be focused');
  assertEqual(typeof cleanup, 'function', 'Cleanup should be a function');
  cleanup();
});

test('Tab from last element wraps to first', () => {
  const container = createMockElement('div');
  const btn1 = createMockElement('button');
  const btn2 = createMockElement('button');

  container.querySelectorAll = () => [btn1, btn2];
  mockDocument.activeElement = btn2;
  btn2._focused = true;

  const cleanup = trapFocusInside(container as any);

  // Re-focus btn2 before dispatching Tab (trapFocusInside auto-focuses first)
  btn2.focus();

  const event = {
    type: 'keydown',
    key: 'Tab',
    keyCode: 9,
    shiftKey: false,
    defaultPrevented: false,
    preventDefault() { this.defaultPrevented = true; },
  } as unknown as KeyboardEvent;

  container.dispatchEvent(event);

  assertEqual(mockDocument.activeElement, btn1, 'Focus should wrap to first element');
  assertEqual(event.defaultPrevented, true, 'Default should be prevented');
  cleanup();
});

test('Shift+Tab from first element wraps to last', () => {
  const container = createMockElement('div');
  const btn1 = createMockElement('button');
  const btn2 = createMockElement('button');

  container.querySelectorAll = () => [btn1, btn2];
  mockDocument.activeElement = btn1;
  btn1._focused = true;

  const cleanup = trapFocusInside(container as any);

  const event = {
    type: 'keydown',
    key: 'Tab',
    keyCode: 9,
    shiftKey: true,
    defaultPrevented: false,
    preventDefault() { this.defaultPrevented = true; },
  } as unknown as KeyboardEvent;

  container.dispatchEvent(event);

  assertEqual(mockDocument.activeElement, btn2, 'Focus should wrap to last element');
  assertEqual(event.defaultPrevented, true, 'Default should be prevented');
  cleanup();
});

test('Cleanup removes the keydown listener', () => {
  const container = createMockElement('div');
  const btn1 = createMockElement('button');

  container.querySelectorAll = () => [btn1];
  mockDocument.activeElement = btn1;
  btn1._focused = true;

  const cleanup = trapFocusInside(container as any);
  cleanup();

  const event = {
    type: 'keydown',
    key: 'Tab',
    keyCode: 9,
    shiftKey: false,
    defaultPrevented: false,
    preventDefault() { this.defaultPrevented = true; },
  } as unknown as KeyboardEvent;

  container.dispatchEvent(event);

  assertEqual(event.defaultPrevented, false, 'Event should not be intercepted after cleanup');
});

test('Hidden elements are excluded from focus cycle', () => {
  const container = createMockElement('div');
  const btn1 = createMockElement('button');
  const btn2 = createMockElement('button');
  btn2.offsetParent = null; // hidden

  container.querySelectorAll = () => [btn1, btn2];
  mockDocument.activeElement = btn1;
  btn1._focused = true;

  const cleanup = trapFocusInside(container as any);

  const event = {
    type: 'keydown',
    key: 'Tab',
    keyCode: 9,
    shiftKey: true,
    defaultPrevented: false,
    preventDefault() { this.defaultPrevented = true; },
  } as unknown as KeyboardEvent;

  container.dispatchEvent(event);

  // Only btn1 is visible, so wrapping from first to last should land on btn1 itself
  assertEqual(mockDocument.activeElement, btn1, 'Hidden element should be skipped');
  cleanup();
});

// ============================================================================
// Run
// ============================================================================

runTests();
