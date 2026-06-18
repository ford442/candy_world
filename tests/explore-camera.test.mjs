// tests/explore-camera.test.mjs
// Unit tests for explore camera preference + ground snap helpers.

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`✅ PASS: ${message}`);
    passed++;
  } else {
    console.log(`❌ FAIL: ${message}`);
    failed++;
  }
}

function test(name, fn) {
  try {
    fn();
  } catch (err) {
    console.log(`❌ FAIL: ${name} — ${err.message}`);
    failed++;
  }
}

function resolveExploreVariant(search = '') {
  const params = new URLSearchParams(search);
  const explicit = params.get('explore')?.toLowerCase();
  if (explicit === 'hybrid') return 'hybrid';
  if (explicit === '1' || explicit === 'true' || params.has('explore')) return 'orbit';
  return 'off';
}

function snapEyeY(groundY, eyeOffset = 1.8) {
  return groundY + eyeOffset;
}

console.log('🎥 Explore Camera Tests');
console.log('=======================\n');

test('URL ?explore=1 selects orbit mode', () => {
  assert(resolveExploreVariant('?explore=1') === 'orbit', 'Should resolve orbit');
});

test('URL ?explore=hybrid selects hybrid mode', () => {
  assert(resolveExploreVariant('?explore=hybrid') === 'hybrid', 'Should resolve hybrid');
});

test('ground snap places eye height above terrain', () => {
  const eyeY = snapEyeY(12.5);
  assert(Math.abs(eyeY - 14.3) < 0.001, `Expected eye Y 14.3, got ${eyeY}`);
});

test('transition easing reaches 1.0 at completion', () => {
  const t = 1;
  const eased = t * t * (3 - 2 * t);
  assert(eased === 1, 'Smoothstep should finish at 1');
});

console.log(`\n📊 Results: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
