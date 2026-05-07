/**
 * Ability HUD Accessibility Tests
 *
 * Verifies keyboard activation and visual feedback for ability HUD slots.
 * Run with: npx tsx tests/ability-hud-accessibility.test.ts
 */

import { triggerAbility, keyStates } from '../src/core/input/input-types';

// ============================================================================
// Minimal DOM Mock
// ============================================================================

interface MockElement {
  _classes: Set<string>;
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string): void;
  classList: {
    add(cls: string): void;
    remove(cls: string): void;
    contains(cls: string): boolean;
  };
}

function createMockElement(): MockElement {
  const classes = new Set<string>();
  return {
    _classes: classes,
    getAttribute() { return null; },
    setAttribute() {},
    classList: {
      add(cls: string) { classes.add(cls); },
      remove(cls: string) { classes.delete(cls); },
      contains(cls: string) { return classes.has(cls); },
    },
  };
}

// ============================================================================
// Test Framework
// ============================================================================

const tests: { name: string; run: () => boolean | void | Promise<boolean | void> }[] = [];
let passed = 0;
let failed = 0;

function test(name: string, fn: () => boolean | void | Promise<boolean | void>): void {
  tests.push({ name, run: fn });
}

function assertEqual(actual: any, expected: any, msg?: string): void {
  if (actual !== expected) {
    throw new Error(msg ? `${msg}: expected ${expected}, got ${actual}` : `Expected ${expected}, got ${actual}`);
  }
}

function assertTrue(actual: any, msg?: string): void {
  if (actual !== true) {
    throw new Error(msg ? `${msg}: expected true, got ${actual}` : `Expected true, got ${actual}`);
  }
}

async function runTests(): Promise<void> {
  console.log('🧪 Running Ability HUD Accessibility Tests...\n');
  for (const { name, run } of tests) {
    try {
      const result = await run();
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

test('triggerAbility sets keyState to true immediately', () => {
  keyStates.dash = false;
  triggerAbility('dash');
  assertEqual(keyStates.dash, true, 'dash keyState should be true');
  // Reset for other tests
  keyStates.dash = false;
});

test('triggerAbility applies pressed class to element', () => {
  const el = createMockElement();

  triggerAbility('dash', el as unknown as HTMLElement);
  assertTrue(el.classList.contains('pressed'), 'pressed class should be added immediately');

  // Clean up
  keyStates.dash = false;
});

test('triggerAbility removes pressed class after timeout', async () => {
  const el = createMockElement();

  triggerAbility('action', el as unknown as HTMLElement);
  assertTrue(el.classList.contains('pressed'), 'pressed class should be added immediately');

  await new Promise(resolve => setTimeout(resolve, 150));
  assertEqual(el.classList.contains('pressed'), false, 'pressed class should be removed after timeout');

  keyStates.action = false;
});

test('triggerAbility does not throw when element is null', () => {
  keyStates.phase = false;
  // Should not throw
  triggerAbility('phase', null);
  assertEqual(keyStates.phase, true, 'phase keyState should still be set');
  keyStates.phase = false;
});

test('triggerAbility does not throw when element is undefined', () => {
  keyStates.dash = false;
  // Should not throw
  triggerAbility('dash');
  assertEqual(keyStates.dash, true, 'dash keyState should still be set');
  keyStates.dash = false;
});

// ============================================================================
// Run
// ============================================================================

runTests();
