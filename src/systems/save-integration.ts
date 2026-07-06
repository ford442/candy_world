/**
 * Save system integration for Candy World.
 * Wires SaveSystem gather/apply hooks to live game state.
 */

import {
    saveSystem,
    createPlayerSaveData,
    createWorldSaveData,
    createProgressSaveData,
    type SaveData,
} from './save-system/index.ts';
import { player } from './physics/index.ts';
import { discoverySystem } from './discovery.ts';
import { unlockSystem } from './unlocks.ts';
import { FEATURE_FLAGS } from '../core/config.ts';
import { awakenedPersistence } from './awakened-persistence.ts';

type SaveSystemInternals = {
    gatherPlayerData: () => SaveData['player'];
    gatherWorldData: () => SaveData['world'];
    gatherProgressData: (playtime: number) => SaveData['progress'];
};

type UnlockSystemSnapshot = {
    inventory: Record<string, number>;
    unlocks: Set<string>;
};

/**
 * Connect save system to game state providers. Call once during boot.
 */
export function initializeSaveSystemIntegration(): void {
    const internal = saveSystem as unknown as SaveSystemInternals;

    internal.gatherPlayerData = gatherPlayerData;
    internal.gatherWorldData = gatherWorldData;
    internal.gatherProgressData = gatherProgressData;

    saveSystem.onSaveComplete = () => {
        console.log('[Save] Game saved successfully');
    };

    saveSystem.onLoadComplete = (data) => {
        console.log('[Save] Game loaded:', data.metadata.slotName);
        applyLoadedData(data);
    };

    setupEventSaves();
    console.log('[Save] Save system integration initialized');
}

function gatherPlayerData(): SaveData['player'] {
    return createPlayerSaveData(
        { x: player.position.x, y: player.position.y, z: player.position.z },
        { x: 0, y: 0, z: 0 },
        { x: player.velocity.x, y: player.velocity.y, z: player.velocity.z },
        {
            energy: player.energy,
            maxEnergy: player.maxEnergy,
            currentState: player.currentState,
            airJumpsLeft: player.airJumpsLeft,
            hasShield: player.hasShield,
            isPhasing: player.isPhasing,
            isInvisible: player.isInvisible,
        }
    );
}

function gatherWorldData(): SaveData['world'] {
    return createWorldSaveData(
        0.5,
        { state: 'clear', intensity: 0, stormCharge: 0 },
        { season: 'spring', progress: 0, moonPhase: 0 }
    );
}

function gatherProgressData(playtime: number): SaveData['progress'] {
    const discoveries = discoverySystem.getDiscoveredIds();
    const unlocksInternal = unlockSystem as unknown as UnlockSystemSnapshot;

    return {
        ...createProgressSaveData(
            discoveries,
            { ...unlocksInternal.inventory },
            [],
            Array.from(unlocksInternal.unlocks),
            playtime
        ),
        awakenedFlora: FEATURE_FLAGS.awakenedPersistence
            ? awakenedPersistence.serialize()
            : undefined,
    };
}

export function applyLoadedData(data: SaveData): void {
    if (data.player.position) {
        player.position.set(data.player.position.x, data.player.position.y, data.player.position.z);
    }
    if (data.player.velocity) {
        player.velocity.set(data.player.velocity.x, data.player.velocity.y, data.player.velocity.z);
    }

    player.energy = data.player.energy;
    player.maxEnergy = data.player.maxEnergy;
    player.currentState = data.player.currentState;
    player.airJumpsLeft = data.player.airJumpsLeft;
    player.hasShield = data.player.hasShield;
    player.isPhasing = data.player.isPhasing;
    player.isInvisible = data.player.isInvisible;

    const unlocksInternal = unlockSystem as unknown as UnlockSystemSnapshot;
    unlocksInternal.unlocks.clear();
    for (const id of data.progress.unlocks) {
        unlocksInternal.unlocks.add(id);
    }

    // ⚡ OPTIMIZATION: Replaced Object.keys() with fast zero-allocation for..in loop to prevent GC spikes
    for (const key in unlocksInternal.inventory) {
        delete unlocksInternal.inventory[key];
    }
    Object.assign(unlocksInternal.inventory, data.progress.inventory);

    if (FEATURE_FLAGS.awakenedPersistence) {
        awakenedPersistence.deserialize(data.progress.awakenedFlora ?? []);
        awakenedPersistence.applyLoadedStatesToBatchers();
    }

    saveSystem.updateSettings(data.settings);
}

function setupEventSaves(): void {
    const originalDiscover = discoverySystem.discover.bind(discoverySystem);
    discoverySystem.discover = (id: string, displayName: string, icon?: string) => {
        const result = originalDiscover(id, displayName, icon);
        if (result) saveSystem.triggerEventSave('discovery');
        return result;
    };

    const originalHarvest = unlockSystem.harvest.bind(unlockSystem);
    unlockSystem.harvest = (itemId: string, amount?: number, displayName?: string) => {
        originalHarvest(itemId, amount, displayName);
        saveSystem.triggerEventSave('harvest');
    };
}

if (typeof window !== 'undefined') {
    (window as unknown as Record<string, unknown>).saveIntegration = {
        initialize: initializeSaveSystemIntegration,
        applyData: applyLoadedData,
    };
}
