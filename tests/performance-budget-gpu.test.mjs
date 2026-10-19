import assert from 'assert';
import { PerformanceBudget } from '../src/systems/performance-budget/performance-budget-core.ts';

function testGpuFrameTimeMissing() {
    const budget = new PerformanceBudget({ frameTime: 16.67, gpuFrameTime: 16.67 });
    budget.setGpuFrameTime(null);
    budget.beginFrame();
    // mock CPU wait
    const start = performance.now();
    while (performance.now() - start < 5) {}
    budget.endFrame();

    const status = budget.getStatus();
    assert.strictEqual(status.metrics.gpuFrameTime, null);
    console.log('✅ testGpuFrameTimeMissing passed');
}

function testGpuFrameTimePresent() {
    const budget = new PerformanceBudget({ frameTime: 16.67, gpuFrameTime: 16.67 });
    budget.setGpuFrameTime(10.5);
    budget.beginFrame();
    budget.endFrame();

    const status = budget.getStatus();
    assert.strictEqual(status.metrics.gpuFrameTime, 10.5);
    console.log('✅ testGpuFrameTimePresent passed');
}

testGpuFrameTimeMissing();
testGpuFrameTimePresent();
console.log('All performance-budget-gpu tests passed');
