import { setupGlobalKeyboardTactileFeedback } from '../src/utils/interaction-utils.ts';

// Simple DOM Mock
const listeners: Record<string, EventListener[]> = {};
let classList = new Set<string>();

const mockDocument = {
    addEventListener: (type: string, handler: EventListener) => {
        if (!listeners[type]) listeners[type] = [];
        listeners[type].push(handler);
    },
    querySelectorAll: (selector: string) => {
        return [{
            classList: {
                contains: (cls: string) => classList.has(cls),
                remove: (cls: string) => classList.delete(cls)
            }
        }];
    },
    activeElement: {
        getAttribute: () => null,
        matches: (selector: string) => selector.includes('.webgpu-fatal-btn'),
        classList: {
            contains: (cls: string) => classList.has(cls),
            add: (cls: string) => classList.add(cls),
            remove: (cls: string) => classList.delete(cls)
        },
        addEventListener: (type: string, handler: EventListener) => {
             if (!listeners[type]) listeners[type] = [];
             listeners[type].push(handler);
        },
        removeEventListener: (type: string, handler: EventListener) => {
             if (!listeners[type]) return;
             const idx = listeners[type].indexOf(handler);
             if (idx > -1) listeners[type].splice(idx, 1);
        }
    }
};

(globalThis as any).document = mockDocument;
(globalThis as any).window = mockDocument; // Mock window to prevent ReferenceError
(globalThis as any).HTMLElement = class {};
(globalThis as any).HTMLButtonElement = class {};


const tests: { name: string; run: () => boolean | void }[] = [];
let passed = 0;
let failed = 0;

function test(name: string, fn: () => boolean | void): void {
    tests.push({ name, run: fn });
}

function assertEqual(actual: any, expected: any, msg?: string): void {
    if (actual !== expected) {
        throw new Error(
            msg
                ? `${msg}: expected ${expected}, got ${actual}`
                : `Expected ${expected}, got ${actual}`
        );
    }
}

test('Global tactile feedback adds .keyboard-active to .webgpu-fatal-btn', () => {
    setupGlobalKeyboardTactileFeedback();

    // Simulate Enter keydown
    const event = { key: 'Enter', repeat: false } as any;
    listeners['keydown'].forEach(l => l(event));

    assertEqual(classList.has('keyboard-active'), true, 'Should add class on keydown');

    // Simulate keyup
    const keyupEvent = { key: 'Enter' } as any;
    listeners['keyup'].forEach(l => l(keyupEvent));

    assertEqual(classList.has('keyboard-active'), false, 'Should remove class on keyup');
});

console.log('🧪 Running webgpu-fatal tactile feedback tests...\n');
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
