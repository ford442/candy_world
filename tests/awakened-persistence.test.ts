import path from 'node:path';
import { pathToFileURL } from 'node:url';

const mode = process.env.AWAKENED_TEST_MODE ?? 'off';
const search = mode === 'on' ? '?awakened_persistence=1' : '';

const storageCalls = {
    getItem: 0,
    setItem: 0,
    removeItem: 0,
};

const writtenValues: string[] = [];
const analyticsEvents: Array<{ entityType: string; biome: string; awakenedAt: string; awakenedKey: string; emissiveScale: number }> = [];

interface AwakenedExportShape {
    version: number;
    awakened: {
        version: number;
        records: Array<Record<string, unknown>>;
    };
}

const storage = {
    data: new Map<string, string>(),
    getItem(key: string) {
        storageCalls.getItem++;
        return this.data.has(key) ? this.data.get(key)! : null;
    },
    setItem(key: string, value: string) {
        storageCalls.setItem++;
        this.data.set(key, value);
        writtenValues.push(value);
    },
    removeItem(key: string) {
        storageCalls.removeItem++;
        this.data.delete(key);
    },
    clear() {
        this.data.clear();
    },
};

function installBrowserShims(): void {
    (globalThis as any).window = {
        location: { search },
        localStorage: storage,
        addEventListener: () => {},
        removeEventListener: () => {},
        setTimeout: globalThis.setTimeout.bind(globalThis),
        clearTimeout: globalThis.clearTimeout.bind(globalThis),
    };
    (globalThis as any).document = {
        visibilityState: 'visible',
        addEventListener: () => {},
        removeEventListener: () => {},
    };
    (globalThis as any).__testAwakenedAnalyticsHook = (record: {
        entityType: string;
        biome: string;
        awakenedAt: string;
        awakenedKey: string;
        emissiveScale: number;
    }) => {
        analyticsEvents.push(record);
    };
}

function resetShims(): void {
    delete (globalThis as any).window;
    delete (globalThis as any).document;
    delete (globalThis as any).__testAwakenedAnalyticsHook;
}

function assert(condition: unknown, message: string): void {
    if (!condition) {
        throw new Error(message);
    }
}

function parseLastWritten(): AwakenedExportShape {
    const json = writtenValues[writtenValues.length - 1];
    return JSON.parse(json) as AwakenedExportShape;
}

installBrowserShims();

const modulePath = pathToFileURL(path.join(process.cwd(), 'src/systems/awakened-persistence.ts')).href;
const awakened = await import(modulePath);

if (mode === 'off') {
    const key = awakened.deriveAwakenedKey({ type: 'mushroom', biome: 'meadow', x: 10.24, z: 9.74 });
    assert(key === 'awk_v1:meadow:10:9.5:mushroom', 'content-addressable key should be quantized to 0.5u grid');
    assert(awakened.initializeAwakenedPersistence() === undefined, 'initialization should be a no-op when disabled');
    assert(awakened.markAwakened({ type: 'mushroom', biome: 'meadow', x: 10.24, z: 9.74, lastNoteColor: 0xff00ff }) === false, 'markAwakened should be disabled');
    assert(storageCalls.getItem === 0 && storageCalls.setItem === 0, 'disabled feature must not touch storage');
    console.log('✅ awakened-persistence off-mode checks passed');
} else {
    storage.data.set(
        'candy_world_awakened_persistence',
        JSON.stringify({
            version: 1,
            updatedAt: new Date().toISOString(),
            awakened: {
                version: 1,
                records: [
                    { key: 'awk_v1:meadow:1:1:mushroom', type: 'mushroom', biome: 'meadow', awakenedAt: new Date().toISOString(), lastNoteColor: [1, 0, 0], emissiveScale: 1 },
                    { key: 'awk_v1:meadow:2:2:mushroom', type: 'mushroom', biome: 'meadow', awakenedAt: new Date().toISOString(), lastNoteColor: [0, 1, 0], emissiveScale: 1 },
                    { key: 'awk_v1:meadow:3:3:mushroom', type: 'mushroom', biome: 'meadow', awakenedAt: new Date().toISOString(), lastNoteColor: [0, 0, 1], emissiveScale: 1 },
                    { key: 'awk_v1:meadow:4:4:mushroom', type: 'mushroom', biome: 'meadow', awakenedAt: new Date().toISOString(), lastNoteColor: [1, 1, 0], emissiveScale: 1 },
                ],
            },
        })
    );

    awakened.initializeAwakenedPersistence();
    assert(storageCalls.getItem === 1, 'feature-on init should read storage once');

    const result = awakened.markAwakened({
        type: 'mushroom',
        biome: 'meadow',
        x: 10.24,
        z: 9.74,
        lastNoteColor: 0x112233,
        emissiveScale: 0.75,
    });
    assert(result === true, 'new entity should awaken once');

    const duplicate = awakened.markAwakened({
        type: 'mushroom',
        biome: 'meadow',
        x: 10.24,
        z: 9.74,
        lastNoteColor: 0x112233,
        emissiveScale: 0.75,
    });
    assert(duplicate === false, 'duplicate awaken should be ignored');
    assert(analyticsEvents.length === 1, 'analytics should fire once per entity');

    const exported = JSON.parse(awakened.exportAwakenedPersistence());
    assert(exported.version === 1, 'root version should be 1');
    assert(exported.awakened.version === 1, 'awakened slice version should be 1');
    assert(Array.isArray(exported.awakened.records) && exported.awakened.records.length === 1, 'orphan pruning should keep only current record');
    assert(!('x' in exported.awakened.records[0]) && !('z' in exported.awakened.records[0]), 'records must stay plain JSON without position fields');

    assert(awakened.flushAwakenedPersistence() === undefined, 'flush should be synchronous');
    assert(storageCalls.setItem >= 1, 'flush should write to storage');
    const parsed = parseLastWritten();
    assert(parsed.awakened.records.length === 1, 'flushed payload should be pruned to one record');
    assert(parsed.awakened.records[0].key.startsWith('awk_v1:'), 'saved key should use the versioned content-addressable scheme');

    console.log('✅ awakened-persistence on-mode checks passed');
}

resetShims();
