// src/core/hud.ts
// HUD and Theme management

import * as THREE from 'three';
import { unlockSystem } from '../systems/unlocks.ts';
import { jitterMineSystem } from '../gameplay/jitter-mines.ts';
import { CYCLE_DURATION } from './config.ts';

// Theme state (managed here, but timeOffset is in main)
let isNight = false;
let lastIsNight: boolean | null = null;

// 🎨 Palette: Cache HUD Elements
const hudEnergyContainer = document.getElementById('energy-bar-container');
const hudEnergyFill = document.getElementById('energy-bar-fill');
const hudDash = document.getElementById('ability-dash');
const hudDashOverlay = hudDash ? hudDash.querySelector('.cooldown-overlay') as HTMLElement : null;
const hudMine = document.getElementById('ability-mine');
const hudMineOverlay = hudMine ? hudMine.querySelector('.cooldown-overlay') as HTMLElement : null;
const hudPhase = document.getElementById('ability-phase');
const hudPhaseOverlay = hudPhase ? hudPhase.querySelector('.cooldown-overlay') as HTMLElement : null;

// 🎨 Palette: Cache Tracker HUD Elements
const trackerPatternEl = document.getElementById('tracker-pattern');
const trackerRowEl = document.getElementById('tracker-row');
let _lastTrackerPattern: number | null = null;
let _lastTrackerRow: number | null = null;

// Track previous states to avoid DOM thrashing
let _lastDashReady: boolean | null = null;
let _lastMineReady: boolean | null = null;
let _currentEnergyPulseScale: number = 1.0;
let _lastPhaseCount: number | null = null;
let _lastPhaseActive: boolean | null = null;
let _lastStrikeState: boolean = false;

// Reference to input system for button state updates
let inputSystem: any = null;

export function setInputSystem(input: any) {
    inputSystem = input;
}

export function updateTheme(isNightMode: boolean) {
    const nightColor = '#0A0A2E'; // Deep Night Blue
    const dayColor = '#FFD1DC';   // Candy Pink

    const newColor = isNightMode ? nightColor : dayColor;

    // 1. Update Meta Theme Color (Mobile/Browser UI)
    const themeColorMeta = document.querySelector('meta[name="theme-color"]');
    if (themeColorMeta) {
        themeColorMeta.setAttribute('content', newColor);
    }

    // 2. Update Body Background (Bleed/Loading)
    document.body.style.background = newColor;

    // 3. Update Instructions Overlay Background (Immersive Pause Menu)
    const instructions = document.getElementById('instructions');
    if (instructions) {
        // Use rgba to keep transparency
        instructions.style.background = isNightMode
            ? 'rgba(10, 10, 46, 0.8)'   // Night: Dark Blue
            : 'rgba(255, 209, 220, 0.8)'; // Day: Pink
    }

    // 4. Sync Button State
    if (inputSystem) {
        inputSystem.updateDayNightButtonState(isNightMode);
    }
}

export function toggleDayNight(timeOffsetRef: { value: number }) {
    timeOffsetRef.value += CYCLE_DURATION / 2;
    // Note: We no longer update button state here.
    // The animate loop detects the time shift, updates 'isNight',
    // and triggers 'updateTheme()' automatically.
}

export function getIsNight(): boolean {
    return isNight;
}

export function setIsNight(value: boolean) {
    isNight = value;
}

export function getLastIsNight(): boolean | null {
    return lastIsNight;
}

export function setLastIsNight(value: boolean | null) {
    lastIsNight = value;
}

export function getLastStrikeState(): boolean {
    return _lastStrikeState;
}

export function setLastStrikeState(value: boolean) {
    _lastStrikeState = value;
}

export function updateTrackerHUD(audioState: any): void {
    if (audioState && trackerPatternEl && trackerRowEl) {
        const patternIndex = audioState.patternIndex || 0;
        const rowIndex = audioState.row || 0;

        if (patternIndex !== _lastTrackerPattern) {
            trackerPatternEl.textContent = patternIndex.toString().padStart(2, '0');
            _lastTrackerPattern = patternIndex;
        }
        if (rowIndex !== _lastTrackerRow) {
            trackerRowEl.textContent = rowIndex.toString().padStart(2, '0');
            _lastTrackerRow = rowIndex;
        }
    }
}

export function updateEnergyBar(
    playerEnergy: number,
    playerMaxEnergy: number,
    audioState: any,
    delta: number
): void {
    if (!hudEnergyContainer || !hudEnergyFill) return;

    const energyPct = Math.max(0, Math.min(1, playerEnergy / playerMaxEnergy));
    hudEnergyFill.style.width = `${energyPct * 100}%`;
    hudEnergyContainer.setAttribute('aria-valuenow', (energyPct * 10).toFixed(1));

    // Pulse to the beat when health/energy is low (< 30%)
    if (energyPct < 0.3) {
        hudEnergyContainer.classList.add('low-energy-pulse');
        const kick = audioState?.kickTrigger || 0;
        // Add an intense, juicy pulse based on the beat
        const targetScale = 1.0 + kick * 0.25;

        // 🎨 Palette: Smooth organic pulse instead of instant snap
        _currentEnergyPulseScale = THREE.MathUtils.damp(_currentEnergyPulseScale, targetScale, 15, delta);
        hudEnergyContainer.style.transform = `scale(${_currentEnergyPulseScale.toFixed(3)})`;

        // Color shift to warning red/orange
        hudEnergyFill.style.background = `linear-gradient(90deg, #ff4500, #ff0000)`;
        hudEnergyContainer.style.borderColor = '#ff0000';
    } else {
        hudEnergyContainer.classList.remove('low-energy-pulse');

        // 🎨 Palette: Smoothly return to normal scale when energy recovers
        _currentEnergyPulseScale = THREE.MathUtils.damp(_currentEnergyPulseScale, 1.0, 10, delta);
        if (Math.abs(_currentEnergyPulseScale - 1.0) > 0.001) {
            hudEnergyContainer.style.transform = `scale(${_currentEnergyPulseScale.toFixed(3)})`;
        } else {
            hudEnergyContainer.style.transform = '';
        }

        // Restore original candy pink gradient
        hudEnergyFill.style.background = `linear-gradient(90deg, #ff69b4, #ff1493)`;
        hudEnergyContainer.style.borderColor = ''; // Let CSS take over
    }
}

export function updateDashHUD(
    dashCooldown: number,
    audioState: any
): void {
    if (!hudDash || !hudDashOverlay) return;

    const dashPct = Math.min(1, Math.max(0, dashCooldown));

    // Only update height if it changed significantly?
    // Browser optimizes this well, but we can verify.
    hudDashOverlay.style.height = `${dashPct * 100}%`;

    const isReady = dashPct <= 0;
    if (isReady !== _lastDashReady) {
        if (isReady) {
            hudDash.classList.add('ready');
            hudDash.setAttribute('aria-disabled', 'false');
            hudDash.title = "Dash (E) - Ready!";
            hudDash.setAttribute('aria-label', "Dash Ability (E) - Ready!");
        } else {
            hudDash.classList.remove('ready');
            hudDash.setAttribute('aria-disabled', 'true');
            hudDash.title = "Dash (E) - Recharging...";
            hudDash.setAttribute('aria-label', "Dash Ability (E) - Recharging...");
        }
        _lastDashReady = isReady;
    }

    // PALETTE: Pulse to the beat when ready!
    if (isReady) {
        const kick = audioState?.kickTrigger || 0;
        const scale = 1.0 + kick * 0.15;
        const pressed = hudDash.classList.contains('pressed');
        // Multiply by 0.9 if pressed (mimics CSS active state)
        const finalScale = pressed ? scale * 0.9 : scale;
        hudDash.style.transform = `scale(${finalScale.toFixed(3)})`;
    } else {
        hudDash.style.transform = ''; // Reset to CSS
    }
}

export function updateMineHUD(
    mineCooldown: number,
    audioState: any
): void {
    if (!hudMine || !hudMineOverlay) return;

    const minePct = Math.min(1, Math.max(0, mineCooldown));
    hudMineOverlay.style.height = `${minePct * 100}%`;

    const isReady = minePct <= 0;
    if (isReady !== _lastMineReady) {
        if (isReady) {
            hudMine.classList.add('ready');
            hudMine.setAttribute('aria-disabled', 'false');
            hudMine.title = "Jitter Mine (F) - Ready!";
            hudMine.setAttribute('aria-label', "Jitter Mine Ability (F) - Ready!");
        } else {
            hudMine.classList.remove('ready');
            hudMine.setAttribute('aria-disabled', 'true');
            hudMine.title = "Jitter Mine (F) - Recharging...";
            hudMine.setAttribute('aria-label', "Jitter Mine Ability (F) - Recharging...");
        }
        _lastMineReady = isReady;
    }

    // PALETTE: Pulse to the beat when ready!
    if (isReady) {
        const kick = audioState?.kickTrigger || 0;
        const scale = 1.0 + kick * 0.15;
        const pressed = hudMine.classList.contains('pressed');
        const finalScale = pressed ? scale * 0.9 : scale;
        hudMine.style.transform = `scale(${finalScale.toFixed(3)})`;
    } else {
        hudMine.style.transform = '';
    }
}

export function updatePhaseHUD(
    phaseCount: number,
    isPhasing: boolean,
    phaseTimer: number,
    audioState: any
): void {
    if (!hudPhase || !hudPhaseOverlay) return;

    let countChanged = false;

    // Update Badge Count (Throttled by value check)
    if (phaseCount !== _lastPhaseCount) {
        const badge = hudPhase.querySelector('.ability-count');
        if (badge) badge.textContent = phaseCount.toString();
        _lastPhaseCount = phaseCount;
        countChanged = true;
    }

    // Handle State
    if (isPhasing) {
        const duration = 5.0; // From physics.ts
        const remaining = Math.max(0, phaseTimer);
        const pct = remaining / duration;

        // Show duration depleting
        hudPhaseOverlay.style.height = `${pct * 100}%`;

        if (isPhasing !== _lastPhaseActive) {
            hudPhase.classList.add('active');
            hudPhase.classList.remove('ready');
            hudPhase.setAttribute('aria-disabled', 'false');
            _lastPhaseActive = isPhasing;
        }

        // Dynamic ARIA label for screen readers (maybe throttle this?)
        // For now, let's update title for hover
        hudPhase.title = `Phase Shift Active: ${remaining.toFixed(1)}s left`;

    } else {
        // Not Active - Show Availability
        hudPhaseOverlay.style.height = '0%'; // Clear overlay

        const stateChanged = (isPhasing !== _lastPhaseActive);
        if (stateChanged) {
            hudPhase.classList.remove('active');
            _lastPhaseActive = isPhasing;
        }

        // Check Availability (Ammo) - Update only on state change or count change
        if (stateChanged || countChanged) {
            const isReady = phaseCount > 0;
            if (isReady) {
                hudPhase.classList.add('ready');
                hudPhase.setAttribute('aria-disabled', 'false');
                hudPhase.title = `Phase Shift (Z) - ${phaseCount} Bulb${phaseCount !== 1 ? 's' : ''} Available`;
                hudPhase.setAttribute('aria-label', `Phase Shift (Z) - ${phaseCount} Bulbs Available`);
            } else {
                hudPhase.classList.remove('ready');
                hudPhase.setAttribute('aria-disabled', 'true');
                hudPhase.title = "Phase Shift (Z) - Need Tremolo Bulb";
                hudPhase.setAttribute('aria-label', "Phase Shift (Z) - Empty (Need Tremolo Bulb)");
            }
        }

        // PALETTE: Pulse to the beat when ready (Ammo > 0)!
        const isReady = phaseCount > 0;
        if (isReady) {
            const kick = audioState?.kickTrigger || 0;
            const scale = 1.0 + kick * 0.15;
            const pressed = hudPhase.classList.contains('pressed');
            const finalScale = pressed ? scale * 0.9 : scale;
            hudPhase.style.transform = `scale(${finalScale.toFixed(3)})`;
        } else {
            hudPhase.style.transform = '';
        }
    }
}

export function updateHUD(params: {
    player: {
        energy: number;
        maxEnergy: number;
        dashCooldown: number;
        isPhasing: boolean;
        phaseTimer: number;
    };
    audioState: any;
    delta: number;
}): void {
    const { player, audioState, delta } = params;

    // 🎨 Palette: Update Energy Bar (UI Feedback)
    updateEnergyBar(player.energy, player.maxEnergy, audioState, delta);

    // 🎨 Palette: Update Ability HUD - Dash
    updateDashHUD(player.dashCooldown, audioState);

    // 🎨 Palette: Update Ability HUD - Mine
    updateMineHUD(jitterMineSystem.cooldownTimer, audioState);

    // 🎨 Palette: Update Phase Shift HUD (Ammo + Duration)
    updatePhaseHUD(
        unlockSystem.getItemCount('tremolo_bulb'),
        player.isPhasing,
        player.phaseTimer,
        audioState
    );
}
