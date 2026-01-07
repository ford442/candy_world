// verification/verify_discovery.js

console.log("Running Discovery System Verification...");

// 1. Setup Mocks BEFORE import
const mockStorage = {};
global.localStorage = {
    getItem: (key) => mockStorage[key],
    setItem: (key, val) => { mockStorage[key] = val; }
};

global.document = {
    getElementById: (id) => {
        if (id === 'now-playing-toast') return { classList: { add: () => {}, remove: () => {} }, querySelector: () => ({}) };
        if (id === 'now-playing-text') return { innerText: '' };
        return null;
    }
};

// 2. Dynamic Import to ensure Mocks are ready
const runTests = async () => {
    try {
        const { discoverySystem } = await import('../src/systems/discovery.js');

        console.log("System imported successfully.");
        discoverySystem.reset();

        // Test 1: Discover new item
        console.log("Test 1: Discover 'test_item'");
        const result1 = discoverySystem.discover('test_item', 'Test Item');
        if (result1 && discoverySystem.isDiscovered('test_item')) {
            console.log("PASS: New item discovered.");
        } else {
            console.error("FAIL: Failed to discover new item.");
        }

        // Test 2: Discover same item again
        console.log("Test 2: Discover 'test_item' again");
        const result2 = discoverySystem.discover('test_item', 'Test Item');
        if (!result2) {
            console.log("PASS: Duplicate discovery ignored.");
        } else {
            console.error("FAIL: Duplicate discovery triggered event.");
        }

        // Test 3: Persistence
        console.log("Test 3: Check persistence (mock storage)");
        if (mockStorage['candy_world_discovery'] && mockStorage['candy_world_discovery'].includes('test_item')) {
            console.log("PASS: Item saved to storage.");
        } else {
            console.error("FAIL: Item not in storage: " + mockStorage['candy_world_discovery']);
        }

    } catch (e) {
        console.error("Test failed with exception:", e);
        process.exit(1);
    }
};

runTests();
