// tests/cycle-phases.test.mjs
// Day/night phase helpers in core/cycle.ts. The visuals loop once wrapped at
// 840 s while the palette and day/night bias wrapped at 960 s, so the sun,
// night theme and plant poses drifted apart; these pin them to one cycle.

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

import { CYCLE_DURATION, DURATION_SUNRISE, DURATION_DAY } from '../src/core/config.ts';
import {
    getCyclePos,
    getDayNightBias,
    getSunArcAngle,
    isDeepNight,
    isNightCyclePos,
    NIGHT_START,
    DEEP_NIGHT_START,
} from '../src/core/cycle.ts';
import { TIME_OF_DAY_PRESETS, applyTimeOfDayPreset } from '../src/core/time-of-day-presets.ts';
import {
    registerFireflyMesh,
    setFireflyMeshesVisible,
    getFireflyMeshCount,
    __resetFireflyRegistryForTests,
} from '../src/foliage/firefly-registry.ts';

console.log('🌗 Cycle Phase Tests');
console.log('====================\n');

const sunHeight = (p) => Math.sin(getSunArcAngle(p));

test('getCyclePos wraps at CYCLE_DURATION, including negative time', () => {
    assert(CYCLE_DURATION === 960, `cycle is 960 s, got ${CYCLE_DURATION}`);
    assert(getCyclePos(0) === 0, 'getCyclePos(0) === 0');
    assert(getCyclePos(960) === 0, 'getCyclePos(960) === 0');
    assert(getCyclePos(850) === 850, 'getCyclePos(850) stays 850 (the old 840 wrap would give 10)');
    assert(getCyclePos(960 * 7 + 123.5) === 123.5, 'many cycles in, phase is preserved');
    assert(getCyclePos(-30) === 930, `getCyclePos(-30) === 930, got ${getCyclePos(-30)}`);
    assert(getCyclePos(-960) === 0, 'getCyclePos(-960) === 0');
});

test('night spans 420 s and starts exactly where the day/night bias reaches 0', () => {
    let nightSeconds = 0;
    let disagreements = 0;
    for (let p = 0; p < CYCLE_DURATION; p += 0.5) {
        const night = isNightCyclePos(p);
        if (night) nightSeconds += 0.5;
        const bias = getDayNightBias(p);
        // Bias is also 0 at the very first instant of sunrise (p = 0), which is not night.
        if (night !== (bias === 0 && p !== 0)) disagreements++;
    }
    assert(nightSeconds === 420, `night is 420 s, got ${nightSeconds}`);
    assert(
        disagreements === 0,
        `isNightCyclePos agrees with getDayNightBias everywhere (${disagreements} mismatches)`
    );
    assert(NIGHT_START === 540, `NIGHT_START === 540, got ${NIGHT_START}`);
});

test('getDayNightBias accepts unwrapped and negative world time', () => {
    assert(getDayNightBias(960 + 270) === 1, 'noon one cycle in is full day');
    assert(getDayNightBias(-180) === 0, '-180 s (780 s) is night');
});

test('deep night flips at 720 s and lasts until sunrise', () => {
    assert(DEEP_NIGHT_START === 720, `DEEP_NIGHT_START === 720, got ${DEEP_NIGHT_START}`);
    assert(!isDeepNight(719.9), '719.9 s is not deep night');
    assert(isDeepNight(720), '720 s is deep night');
    assert(isDeepNight(959.9), '959.9 s (pre-dawn) is deep night');
    assert(
        !isDeepNight(0) && !isDeepNight(270) && !isDeepNight(600),
        'sunrise, noon and dusk are not deep night'
    );
});

test('sun is on the horizon mid-sunrise and mid-sunset, at its zenith at noon', () => {
    assert(Math.abs(sunHeight(30)) < 1e-9, `sun height at 30 s ≈ 0, got ${sunHeight(30)}`);
    assert(Math.abs(sunHeight(510)) < 1e-9, `sun height at 510 s ≈ 0, got ${sunHeight(510)}`);
    assert(Math.abs(sunHeight(270) - 1) < 1e-9, `sun height at 270 s ≈ 1, got ${sunHeight(270)}`);
    assert(Math.cos(getSunArcAngle(30)) > 0.99, 'sun rises at +x (same handedness as before)');
    assert(Math.cos(getSunArcAngle(510)) < -0.99, 'sun sets at -x');
});

test('sun stays above the horizon all day and below it all night', () => {
    let aboveAtNight = 0;
    let belowByDay = 0;
    for (let p = 0; p < CYCLE_DURATION; p += 0.5) {
        const h = sunHeight(p);
        if (isNightCyclePos(p) && h >= 0) aboveAtNight++;
        if (p >= DURATION_SUNRISE && p < DURATION_SUNRISE + DURATION_DAY && h <= 0) belowByDay++;
    }
    assert(aboveAtNight === 0, `sun below horizon for every night sample (${aboveAtNight} above)`);
    assert(belowByDay === 0, `sun above horizon for every full-day sample (${belowByDay} below)`);
});

test('sun angle is continuous, including across the 959 → 0 wrap', () => {
    let worstJump = 0;
    for (let p = 0; p < CYCLE_DURATION * 2; p += 0.25) {
        const a = Math.sin(getSunArcAngle(p));
        const b = Math.sin(getSunArcAngle(p + 0.25));
        const c = Math.cos(getSunArcAngle(p));
        const d = Math.cos(getSunArcAngle(p + 0.25));
        worstJump = Math.max(worstJump, Math.hypot(a - b, c - d));
    }
    assert(worstJump < 0.01, `largest per-0.25 s sun step < 0.01, got ${worstJump.toFixed(5)}`);
});

test('time-of-day presets land in their named phase', () => {
    const offset = { value: 0 };
    for (const gameTime of [0, 123.4, 960 * 3 + 500]) {
        for (const name of Object.keys(TIME_OF_DAY_PRESETS)) {
            const pos = applyTimeOfDayPreset(name, offset, gameTime);
            const actual = getCyclePos(gameTime + offset.value);
            assert(
                Math.abs(actual - TIME_OF_DAY_PRESETS[name]) < 1e-6 &&
                    pos === TIME_OF_DAY_PRESETS[name],
                `${name} at gameTime ${gameTime} → cycle ${actual.toFixed(3)}`
            );
        }
    }
    assert(sunHeight(TIME_OF_DAY_PRESETS.day) > 0.99, 'day preset is high noon');
    assert(isNightCyclePos(TIME_OF_DAY_PRESETS.night), 'night preset is night');
    assert(!isNightCyclePos(TIME_OF_DAY_PRESETS.sunset), 'sunset preset is still before night');
    const pos = applyTimeOfDayPreset('toString', offset, 0);
    assert(pos === TIME_OF_DAY_PRESETS.day, 'unknown or prototype names fall back to day');
});

test('firefly registry gates every registered mesh and writes only on change', () => {
    __resetFireflyRegistryForTests();
    let writes = 0;
    const make = () => {
        let v = true;
        return {
            get visible() {
                return v;
            },
            set visible(next) {
                writes++;
                v = next;
            },
        };
    };
    const a = make();
    const b = make();
    registerFireflyMesh(a);
    registerFireflyMesh(b);
    registerFireflyMesh(a);
    assert(getFireflyMeshCount() === 2, 'duplicate registration is ignored');
    setFireflyMeshesVisible(false);
    assert(!a.visible && !b.visible, 'hiding reaches both meshes');
    const before = writes;
    for (let i = 0; i < 100; i++) setFireflyMeshesVisible(false);
    assert(writes === before, 'repeating the same gate writes nothing');
    const late = make();
    registerFireflyMesh(late);
    assert(!late.visible, 'a mesh registered after the gate closed starts hidden');
    setFireflyMeshesVisible(true);
    assert(a.visible && b.visible && late.visible, 'showing reaches every mesh');
});

console.log(`\n📊 Results: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
