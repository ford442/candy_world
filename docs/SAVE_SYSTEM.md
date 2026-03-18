# Save System Documentation

## Overview

The Candy World Save System provides comprehensive save/load functionality with dual storage backends:
- **localStorage** (sync) - For settings and small data
- **IndexedDB** (async) - For world state and large save files

## Features

- ✅ Auto-save every 30 seconds
- ✅ Event-triggered saves (discoveries, unlocks)
- ✅ 3 rotating auto-save slots
- ✅ 5 manual save slots
- ✅ Export/import as JSON files
- ✅ Version migration system
- ✅ Graceful handling of corrupted saves
- ✅ Compression for efficient storage
- ✅ Privacy controls (delete all data)

## Quick Start

### Basic Usage

```typescript
import { saveSystem } from './systems/save-system.ts';
import { openSaveMenu, openLoadMenu } from './ui/save-menu.ts';

// Save game to a specific slot
await saveSystem.save('manual-1', 'My Save');

// Load game from a slot
const saveData = await saveSystem.load('manual-1');

// Quick save (auto-rotating slot)
await saveSystem.autoSave();

// Open save/load UI
openSaveMenu();
openLoadMenu((data) => {
    // Handle loaded data
    applySaveData(data);
});
```

## API Reference

### SaveSystem Class

#### Core Methods

```typescript
// Save to a specific slot
async save(slotId: string, slotName?: string): Promise<boolean>

// Load from a specific slot
async load(slotId: string): Promise<SaveData | null>

// Quick auto-save
async autoSave(): Promise<boolean>

// Save to manual slot with UI feedback
async saveToManualSlot(slotId: string): Promise<boolean>
```

#### Slot Management

```typescript
// List all save slots with metadata
async listSlots(): Promise<SaveSlotInfo[]>

// Delete a specific slot
async deleteSlot(slotId: string): Promise<boolean>

// Delete ALL data (privacy)
async deleteAllData(): Promise<boolean>
```

#### Import/Export

```typescript
// Export single save as JSON
async exportSave(slotId: string): Promise<string | null>

// Export all saves as bundle
async exportAllSaves(): Promise<string | null>

// Import save(s) from JSON
async importSave(jsonString: string, targetSlotId?: string): Promise<boolean>

// Copy save to clipboard
async copyToClipboard(slotId: string): Promise<boolean>
```

#### Settings Management

```typescript
// Get current settings
getSettings(): SettingsSaveData

// Update settings
updateSettings(newSettings: Partial<SettingsSaveData>): void
```

#### Event Callbacks

```typescript
saveSystem.onSaveStart = () => console.log('Saving...');
saveSystem.onSaveComplete = () => console.log('Saved!');
saveSystem.onSaveError = (error) => console.error('Save failed:', error);
saveSystem.onLoadStart = () => console.log('Loading...');
saveSystem.onLoadComplete = (data) => applySaveData(data);
saveSystem.onLoadError = (error) => console.error('Load failed:', error);
```

### SaveMenu UI Component

#### Opening Menus

```typescript
import { 
    openSaveMenu, 
    openLoadMenu, 
    openSaveGameMenu,
    closeSaveMenu 
} from './ui/save-menu.ts';

// Full menu with all tabs
openSaveMenu({
    mode: 'full', // 'full' | 'load' | 'save'
    onLoad: (data) => applySaveData(data),
    onSave: (slotId) => console.log('Saved to', slotId),
    onClose: () => console.log('Menu closed')
});

// Load only mode
openLoadMenu((data) => {
    applySaveData(data);
});

// Save only mode
openSaveGameMenu((slotId) => {
    console.log('Saved to', slotId);
});

// Close menu
closeSaveMenu();
```

#### Programmatic Usage

```typescript
import { SaveMenu } from './ui/save-menu.ts';

const menu = new SaveMenu({
    mode: 'load',
    onLoad: (data) => applySaveData(data)
});

await menu.show();
// ... later
menu.close();
```

## Save Data Structure

### SaveData Interface

```typescript
interface SaveData {
    metadata: SaveMetadata;
    player: PlayerSaveData;
    world: WorldSaveData;
    progress: ProgressSaveData;
    settings: SettingsSaveData;
}
```

### Player Data

```typescript
interface PlayerSaveData {
    position: SerializableVector3;    // { x, y, z }
    rotation: SerializableVector3;    // { x, y, z }
    velocity: SerializableVector3;    // { x, y, z }
    unlockedAbilities: string[];       // Ability IDs
    energy: number;
    maxEnergy: number;
    currentState: string;              // 'default' | 'swimming' | etc.
    airJumpsLeft: number;
    hasShield: boolean;
    isPhasing: boolean;
    isInvisible: boolean;
}
```

### World Data

```typescript
interface WorldSaveData {
    timeOfDay: number;                 // 0-1 (0=midnight, 0.5=noon)
    weatherState: 'clear' | 'rain' | 'storm';
    weatherIntensity: number;          // 0-1
    stormCharge: number;               // 0-1
    season: string;
    seasonProgress: number;            // 0-1
    moonPhase: number;                 // 0-1
}
```

### Progress Data

```typescript
interface ProgressSaveData {
    discoveredEntities: string[];      // Discovery IDs
    collectionCounts: Record<string, number>;
    milestones: string[];              // Achievement IDs
    playtime: number;                  // Total seconds
    unlocks: string[];                 // Unlock IDs
    inventory: Record<string, number>;
}
```

### Settings Data

```typescript
interface SettingsSaveData {
    graphicsQuality: 'low' | 'medium' | 'high' | 'ultra';
    drawDistance: number;              // 50-500 meters
    shadows: boolean;
    postProcessing: boolean;
    audioVolume: number;               // 0-1
    musicVolume: number;               // 0-1
    sfxVolume: number;                 // 0-1
    keyBindings: KeyBindings;
    fov: number;                       // 60-120 degrees
    sensitivity: number;               // Mouse sensitivity
}

interface KeyBindings {
    forward: string;
    backward: string;
    left: string;
    right: string;
    jump: string;
    sprint: string;
    sneak: string;
    interact: string;
    dance: string;
    shield: string;
}
```

## Game Integration

### Integrating with Player State

```typescript
// In your game initialization or physics system:
import { saveSystem, createPlayerSaveData } from './systems/save-system.ts';

// Override the gather method to provide actual player data
(saveSystem as any).gatherPlayerData = () => {
    return createPlayerSaveData(
        { x: player.position.x, y: player.position.y, z: player.position.z },
        { x: player.rotation.x, y: player.rotation.y, z: player.rotation.z },
        { x: player.velocity.x, y: player.velocity.y, z: player.velocity.z },
        {
            unlockedAbilities: Array.from(player.unlockedAbilities),
            energy: player.energy,
            maxEnergy: player.maxEnergy,
            currentState: player.currentState,
            airJumpsLeft: player.airJumpsLeft,
            hasShield: player.hasShield,
            isPhasing: player.isPhasing,
            isInvisible: player.isInvisible
        }
    );
};
```

### Integrating with World State

```typescript
import { createWorldSaveData } from './systems/save-system.ts';

(saveSystem as any).gatherWorldData = () => {
    return createWorldSaveData(
        timeOfDay, // 0-1
        {
            state: weatherSystem.currentState,
            intensity: weatherSystem.intensity,
            stormCharge: weatherSystem.stormCharge
        },
        {
            season: seasonSystem.currentSeason,
            progress: seasonSystem.progress,
            moonPhase: celestialSystem.moonPhase
        }
    );
};
```

### Integrating with Progress Systems

```typescript
import { createProgressSaveData } from './systems/save-system.ts';
import { discoverySystem } from './systems/discovery.ts';
import { unlockSystem } from './systems/unlocks.ts';

(saveSystem as any).gatherProgressData = (playtime: number) => {
    return createProgressSaveData(
        Array.from(discoverySystem.getDiscoveredItems()),
        unlockSystem.getInventory(),
        milestoneSystem.getCompletedMilestones(),
        Array.from(unlockSystem.getUnlocks()),
        playtime
    );
};
```

### Event-Triggered Saves

```typescript
// Trigger save on important events
discoverySystem.onDiscover = (id) => {
    saveSystem.triggerEventSave('discovery');
};

unlockSystem.onUnlock = (id) => {
    saveSystem.triggerEventSave('unlock');
};

// The system automatically debounces rapid event saves
// (minimum 5 seconds between event-triggered saves)
```

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+S` | Quick Save (creates new manual save or overwrites quick-save slot) |
| `Escape` | Close save menu |

## Debug Commands

Available in browser console:

```javascript
// Save to specific slot
await window.saveGame('manual-1');

// Load from slot
await window.loadGame('manual-1');

// Export save data
await window.exportSave('manual-1');

// Import save data
await window.importSave(jsonString, 'manual-1');

// Delete a slot
await window.deleteSave('manual-1');

// List all saves
await window.listSaves();

// Delete ALL data (with confirmation)
await window.resetAllData();

// Open UI menus
window.openSaveMenu();
window.openLoadMenu((data) => console.log(data));
window.openSaveGameMenu();
```

## Save Slots

### Manual Slots (5)
- `manual-1` through `manual-5`
- User-controlled saves
- Named by user

### Auto Slots (3)
- `auto-0`, `auto-1`, `auto-2`
- Rotating saves every 30 seconds
- Automatically overwrites oldest

### Special Slots
- `quick-save` - Used by Ctrl+S shortcut
- `legacy-migrated` - Migrated from old format

## Migration System

The save system includes a migration system for handling version upgrades:

```typescript
// Register a migration from version 1.0.0 to 1.1.0
migrationSystem.registerMigration('1.1.0', (data, fromVersion) => {
    // Transform data from old format
    return {
        ...data,
        player: {
            ...data.player,
            newField: defaultValue
        },
        metadata: {
            ...data.metadata,
            version: '1.1.0'
        }
    };
});
```

Migrations are automatically applied when loading saves with older versions.

## Error Handling

The save system handles errors gracefully:

1. **Corrupted saves**: Falls back to default values
2. **Storage full**: Shows user-friendly error message
3. **Database errors**: Falls back to localStorage-only mode
4. **Import errors**: Validates JSON structure before applying

## Storage Quotas

Check storage usage:

```typescript
const { used, quota } = await saveSystem.getStorageUsage();
console.log(`Using ${used} bytes of ${quota} bytes`);
```

## Privacy

Users can delete all their data:

1. Open save menu (`Esc` → Save/Load)
2. Go to Import/Export tab
3. Click "Delete All Data"
4. Confirm the warning dialog

This removes:
- All save files (IndexedDB)
- Settings (localStorage)
- Any cached metadata

## Testing

### Manual Testing Checklist

- [ ] Save game loads correctly after page refresh
- [ ] Auto-save triggers every 30 seconds
- [ ] Ctrl+S creates quick save
- [ ] Load menu shows all save slots
- [ ] Export produces valid JSON
- [ ] Import restores save correctly
- [ ] Settings persist across sessions
- [ ] Delete all data removes everything
- [ ] Corrupted save shows error gracefully

### Debug Mode

Enable verbose logging:

```typescript
// In browser console
localStorage.setItem('candy_world_debug_saves', 'true');
```

## File Structure

```
src/
├── systems/
│   └── save-system.ts      # Core save/load logic
├── ui/
│   └── save-menu.ts        # UI components
└── docs/
    └── SAVE_SYSTEM.md      # This documentation
```

## Dependencies

- **Built-in**: Uses native `localStorage` and `IndexedDB` APIs
- **Embedded**: LZ-string compression (embedded, no external dep)
- **Optional**: Pako for additional compression (future)

## Browser Compatibility

- Chrome 58+
- Firefox 55+
- Safari 10.1+
- Edge 79+

Requires:
- `Promise`
- `indexedDB`
- `localStorage`
- `navigator.clipboard` (for copy/export)

## Future Enhancements

Potential improvements:
- Cloud save integration
- Screenshot thumbnails for saves
- Save file encryption
- Multiple player profiles
- Automatic backup to external storage
- Save file compression with pako
