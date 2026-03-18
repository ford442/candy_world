/**
 * Save System Integration Example for Candy World
 * 
 * This file demonstrates how to integrate the save system with
 * the existing game systems. This is a reference implementation.
 */

import { saveSystem, SaveData, createPlayerSaveData, createWorldSaveData, createProgressSaveData } from './systems/save-system.ts';
import { openSaveMenu, openLoadMenu } from './ui/save-menu.ts';
import { player, PlayerExtended } from './systems/physics.ts';
import { discoverySystem } from './systems/discovery.ts';
import { unlockSystem } from './systems/unlocks.ts';
import { weatherSystem } from './systems/weather.ts';
import * as THREE from 'three';

// =============================================================================
// GAME STATE PROVIDERS
// =============================================================================

/**
 * Override save system's gather methods to provide actual game data.
 * Call this once during game initialization.
 */
export function initializeSaveSystemIntegration(): void {
    // Override player data gathering
    (saveSystem as any).gatherPlayerData = gatherPlayerData;
    
    // Override world data gathering
    (saveSystem as any).gatherWorldData = gatherWorldData;
    
    // Override progress data gathering
    (saveSystem as any).gatherProgressData = gatherProgressData;
    
    // Set up event callbacks
    saveSystem.onSaveComplete = () => {
        console.log('[Save] Game saved successfully');
    };
    
    saveSystem.onLoadComplete = (data) => {
        console.log('[Save] Game loaded:', data.metadata.slotName);
        applyLoadedData(data);
    };
    
    // Set up discovery event saves
    setupEventSaves();
    
    console.log('[Save] Save system integration initialized');
}

/**
 * Gather current player state for saving
 */
function gatherPlayerData() {
    return createPlayerSaveData(
        {
            x: player.position.x,
            y: player.position.y,
            z: player.position.z
        },
        {
            x: 0, // Rotation X (pitch) - extract from camera if needed
            y: 0, // Rotation Y (yaw) - extract from camera if needed  
            z: 0  // Rotation Z (roll) - usually 0
        },
        {
            x: player.velocity.x,
            y: player.velocity.y,
            z: player.velocity.z
        },
        {
            unlockedAbilities: [], // TODO: Track unlocked abilities
            energy: player.energy,
            maxEnergy: player.maxEnergy,
            currentState: player.currentState,
            airJumpsLeft: player.airJumpsLeft,
            hasShield: player.hasShield,
            isPhasing: player.isPhasing,
            isInvisible: player.isInvisible
        }
    );
}

/**
 * Gather current world state for saving
 */
function gatherWorldData() {
    // Get weather state from weather system
    const weather = (weatherSystem as any).state || {
        current: 'clear',
        intensity: 0,
        stormCharge: 0
    };
    
    // Get time of day from cycle system
    // This would need to be imported from your cycle/time system
    const timeOfDay = getTimeOfDay(); // TODO: Implement based on your time system
    
    return createWorldSaveData(
        timeOfDay,
        {
            state: weather.current || 'clear',
            intensity: weather.intensity || 0,
            stormCharge: weather.stormCharge || 0
        },
        {
            season: 'spring', // TODO: Implement season system
            progress: 0,
            moonPhase: 0 // TODO: Implement moon phase tracking
        }
    );
}

/**
 * Gather progress data for saving
 */
function gatherProgressData(playtime: number) {
    // Get discoveries from discovery system
    const discoveries = (discoverySystem as any).discoveredItems 
        ? Array.from((discoverySystem as any).discoveredItems)
        : [];
    
    // Get inventory from unlock system
    const inventory = (unlockSystem as any).inventory || {};
    
    // Get unlocks from unlock system
    const unlocks = (unlockSystem as any).unlocks 
        ? Array.from((unlockSystem as any).unlocks)
        : [];
    
    return createProgressSaveData(
        discoveries,
        inventory,
        [], // milestones - implement milestone system
        unlocks,
        playtime
    );
}

// =============================================================================
// DATA APPLICATION
// =============================================================================

/**
 * Apply loaded save data to game state
 */
function applyLoadedData(data: SaveData): void {
    // Apply player position
    if (data.player.position) {
        player.position.set(
            data.player.position.x,
            data.player.position.y,
            data.player.position.z
        );
    }
    
    // Apply player velocity
    if (data.player.velocity) {
        player.velocity.set(
            data.player.velocity.x,
            data.player.velocity.y,
            data.player.velocity.z
        );
    }
    
    // Apply player state
    player.energy = data.player.energy;
    player.maxEnergy = data.player.maxEnergy;
    player.currentState = data.player.currentState;
    player.airJumpsLeft = data.player.airJumpsLeft;
    player.hasShield = data.player.hasShield;
    player.isPhasing = data.player.isPhasing;
    player.isInvisible = data.player.isInvisible;
    
    // Apply unlocks
    const unlocksSet = (unlockSystem as any).unlocks as Set<string>;
    unlocksSet.clear();
    data.progress.unlocks.forEach(id => unlocksSet.add(id));
    
    // Apply inventory
    const inventory = (unlockSystem as any).inventory as Record<string, number>;
    Object.keys(inventory).forEach(key => delete inventory[key]);
    Object.entries(data.progress.inventory).forEach(([key, value]) => {
        inventory[key] = value;
    });
    
    // Apply discoveries
    const discoveries = (discoverySystem as any).discoveredItems as Set<string>;
    discoveries.clear();
    data.progress.discoveredEntities.forEach(id => discoveries.add(id));
    
    // Apply settings
    saveSystem.updateSettings(data.settings);
    applySettings(data.settings);
    
    // Apply world state
    applyWorldState(data.world);
    
    console.log('[Save] Save data applied to game state');
}

/**
 * Apply settings to game systems
 */
function applySettings(settings: SaveData['settings']): void {
    // Apply audio volumes
    // TODO: Connect to your audio system
    // audioSystem.setMasterVolume(settings.audioVolume);
    // audioSystem.setMusicVolume(settings.musicVolume);
    // audioSystem.setSFXVolume(settings.sfxVolume);
    
    // Apply graphics settings
    // TODO: Connect to your renderer
    // renderer.shadowMap.enabled = settings.shadows;
    // camera.fov = settings.fov;
    
    console.log('[Save] Settings applied');
}

/**
 * Apply world state to game systems
 */
function applyWorldState(world: SaveData['world']): void {
    // Apply time of day
    // TODO: Connect to your time/cycle system
    // setTimeOfDay(world.timeOfDay);
    
    // Apply weather
    // TODO: Connect to your weather system
    // weatherSystem.setState(world.weatherState, world.weatherIntensity);
    // weatherSystem.stormCharge = world.stormCharge;
    
    console.log('[Save] World state applied');
}

// =============================================================================
// EVENT SAVES
// =============================================================================

/**
 * Set up event-triggered saves
 */
function setupEventSaves(): void {
    // Hook into discovery system
    const originalDiscover = (discoverySystem as any).discover;
    (discoverySystem as any).discover = function(id: string, displayName: string, icon?: string) {
        const result = originalDiscover.call(this, id, displayName, icon);
        if (result) {
            saveSystem.triggerEventSave('discovery');
        }
        return result;
    };
    
    // Hook into unlock system
    const originalHarvest = (unlockSystem as any).harvest;
    (unlockSystem as any).harvest = function(itemId: string, amount?: number, displayName?: string) {
        originalHarvest.call(this, itemId, amount, displayName);
        saveSystem.triggerEventSave('harvest');
    };
}

// =============================================================================
// UI INTEGRATION
// =============================================================================

/**
 * Add save/load menu to game UI
 * Call this after the game UI is initialized
 */
export function addSaveMenuToUI(): void {
    // Add keyboard shortcut for save menu (e.g., F5 for save, F9 for load)
    document.addEventListener('keydown', (e) => {
        // F5 - Save Menu
        if (e.key === 'F5') {
            e.preventDefault();
            openSaveGameMenu();
        }
        // F9 - Load Menu  
        if (e.key === 'F9') {
            e.preventDefault();
            openLoadMenu((data) => {
                applyLoadedData(data);
            });
        }
    });
    
    // Add pause menu button
    const pauseMenu = document.getElementById('pause-menu');
    if (pauseMenu) {
        const saveButton = document.createElement('button');
        saveButton.textContent = '💾 Save Game';
        saveButton.onclick = () => openSaveGameMenu();
        
        const loadButton = document.createElement('button');
        loadButton.textContent = '📂 Load Game';
        loadButton.onclick = () => openLoadMenu((data) => applyLoadedData(data));
        
        pauseMenu.appendChild(saveButton);
        pauseMenu.appendChild(loadButton);
    }
}

// =============================================================================
// HELPERS
// =============================================================================

/**
 * Get current time of day (0-1)
 * TODO: Implement based on your time system
 */
function getTimeOfDay(): number {
    // This should return time based on your cycle system
    // Default to midday if not implemented
    return 0.5;
}

// =============================================================================
// EXPORTS
// =============================================================================

export {
    applyLoadedData,
    applySettings,
    applyWorldState
};

// Debug helpers
if (typeof window !== 'undefined') {
    (window as any).saveIntegration = {
        initialize: initializeSaveSystemIntegration,
        applyData: applyLoadedData,
        save: () => saveSystem.save('debug', 'Debug Save'),
        load: (slotId: string) => saveSystem.load(slotId)
    };
}
