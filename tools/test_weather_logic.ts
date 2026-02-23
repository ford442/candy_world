import { calculateTimeOfDayBias } from '../src/systems/weather-utils.ts';
import { WeatherState } from '../src/systems/weather-types.ts';

// Basic assertions
function assert(condition: boolean, message: string) {
    if (!condition) {
        console.error(`❌ Assertion failed: ${message}`);
        process.exit(1);
    }
}

console.log('--- Testing Weather Logic ---');

try {
    // 1. Morning Mist (Cycle: 30s)
    // Range: 0 to 120 (Sunrise is 60, Mist lasts +60)
    const mist = calculateTimeOfDayBias(30);
    console.log('Time 30 (Mist):', mist);
    assert(mist.type === 'mist', 'Should be mist at t=30');
    assert(mist.biasState === WeatherState.RAIN, 'Should be rain bias at t=30');

    // 2. Afternoon Storm (Cycle: 400s)
    // Range: ~312 to 450
    // Force storm with low randomVal
    const storm = calculateTimeOfDayBias(400, 0.00001);
    console.log('Time 400 (Storm Chance):', storm);
    assert(storm.type === 'thunderstorm', 'Should be thunderstorm with low randomVal');
    assert(storm.biasState === WeatherState.STORM, 'Should be storm bias');

    // 3. Afternoon Clear (Cycle: 400s)
    // Force clear with high randomVal
    const clear = calculateTimeOfDayBias(400, 0.9);
    console.log('Time 400 (No Storm):', clear);
    // If random check fails, it falls through to Clear/Default
    assert(clear.biasState === WeatherState.CLEAR, 'Should be clear with high randomVal');

    // 4. Evening Drizzle (Cycle: 500s)
    // Range: 480 to 600
    const drizzle = calculateTimeOfDayBias(500);
    console.log('Time 500 (Drizzle):', drizzle);
    assert(drizzle.type === 'drizzle', 'Should be drizzle');
    assert(drizzle.biasState === WeatherState.RAIN, 'Should be rain bias');

    // 5. Night (Cycle: 800s)
    // Range: > 720
    const night = calculateTimeOfDayBias(800);
    console.log('Time 800 (Night):', night);
    assert(night.type === 'clear', 'Should be clear night');
    assert(night.biasState === WeatherState.CLEAR, 'Should be clear bias');

    console.log('✅ All tests passed!');
} catch (error) {
    console.error('Test error:', error);
    process.exit(1);
}
