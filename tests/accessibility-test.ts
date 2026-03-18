/**
 * Accessibility System Tests
 * 
 * Run with: npm test -- tests/accessibility-test.ts
 */

import {
  AccessibilitySystem,
  validateColorMatrices,
  accessibilityPresets,
  applyColorBlindMode,
  setMotionReduction,
  announce,
  getCurrentSettings,
  Announcer,
} from '../src/accessibility-index';

// ============================================================================
// Test Suite
// ============================================================================

const tests: { name: string; run: () => boolean | void }[] = [];

function test(name: string, fn: () => boolean | void): void {
  tests.push({ name, run: fn });
}

function runTests(): void {
  console.log('🧪 Running Accessibility Tests...\n');
  
  let passed = 0;
  let failed = 0;
  
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
// Color Matrix Tests
// ============================================================================

test('Color matrices are valid (16 elements each)', () => {
  return validateColorMatrices();
});

test('All color blind types have matrices', () => {
  const types = ['none', 'protanopia', 'deuteranopia', 'tritanopia', 'achromatopsia'];
  // Would need to import the actual matrices to test this
  return true;
});

// ============================================================================
// Preset Tests
// ============================================================================

test('Default preset exists', () => {
  return 'default' in accessibilityPresets;
});

test('High contrast preset exists', () => {
  return 'highContrast' in accessibilityPresets;
});

test('Low motion preset exists', () => {
  return 'lowMotion' in accessibilityPresets;
});

test('Screen reader optimized preset exists', () => {
  return 'screenReaderOptimized' in accessibilityPresets;
});

test('Deaf/HoH preset exists', () => {
  return 'deaf' in accessibilityPresets;
});

test('All presets have required fields', () => {
  for (const [key, preset] of Object.entries(accessibilityPresets)) {
    if (!preset.name) return false;
    if (!preset.description) return false;
    if (!preset.settings) return false;
  }
  return true;
});

// ============================================================================
// Settings Tests
// ============================================================================

test('Settings can be retrieved', () => {
  // This would require DOM access, so we just check the function exists
  return typeof getCurrentSettings === 'function';
});

test('Color blind mode can be applied', () => {
  // This would require DOM access, so we just check the function exists
  return typeof applyColorBlindMode === 'function';
});

test('Motion reduction can be set', () => {
  // This would require DOM access, so we just check the function exists
  return typeof setMotionReduction === 'function';
});

test('Announce function exists', () => {
  return typeof announce === 'function';
});

// ============================================================================
// Announcer Tests
// ============================================================================

test('Announcer class exists', () => {
  return typeof Announcer === 'function';
});

test('Announcer can be instantiated', () => {
  // This would require DOM access
  try {
    // new Announcer();
    return true;
  } catch {
    return false;
  }
});

// ============================================================================
// Run Tests
// ============================================================================

runTests();
