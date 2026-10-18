// src/core/hud.ts
// HUD and Theme management

import * as THREE from 'three';
import { unlockSystem } from '../systems/unlocks.ts';
import { mountAbilityHud, type AbilityHud } from '../ui/ability-hud.ts';
import { announce } from '../ui/announcer.ts';
import { setKitTheme } from '../ui/kit/index.ts';
import { CYCLE_DURATION } from './config.ts';

// Theme state (managed here, but timeOffset is in main)
let isNight = false;
let lastIsNight: boolean | null = null;

// 🎨 Palette: Ability HUD (Candy UI Kit — see src/ui/ability-hud.ts)
// Resolved lazily: this module is imported before the HUD is mounted, so a
// module-load DOM lookup would cache nulls.
let _abilityHud: AbilityHud | null = null;

function abilityHud(): AbilityHud | null {
    if (!_abilityHud && typeof document !== 'undefined') {
        _abilityHud = mountAbilityHud();
    }
    return _abilityHud;
}

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
let _lastPhaseAnnouncedSecond = -1;
let _lastStrikeState: boolean = false;

// ♿ Aria: Track low energy announcement to prevent spam
let _lastLowEnergyWarning: boolean = false;

// ⚡ OPTIMIZATION: Cache prefersReducedMotion to avoid DOM queries in hot path
let _cachedPrefersReducedMotion = false;
let _reducedMotionMediaQuery: MediaQueryList | null = null;

function _updateReducedMotionCache() {
    _cachedPrefersReducedMotion =
        document.body.classList.contains('a11y-motion-reduced') ||
        (_reducedMotionMediaQuery ? _reducedMotionMediaQuery.matches : false);
}

// Auto-init reduced motion listener
if (typeof window !== 'undefined') {
    _reducedMotionMediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    _reducedMotionMediaQuery.addEventListener('change', _updateReducedMotionCache);

    // Also listen for custom a11y system changes (body class mutation)
    const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
            if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
                _updateReducedMotionCache();
            }
        }
    });
    observer.observe(document.body, { attributes: true });

    _updateReducedMotionCache();
}

// Reference to input system for button state updates
let inputSystem: any = null;

export function setInputSystem(input: any) {
    inputSystem = input;
}

export function updateTheme(isNightMode: boolean) {
    const nightColor = '#0A0A2E'; // Deep Night Blue
    const dayColor = '#FFD1DC'; // Candy Pink

    const newColor = isNightMode ? nightColor : dayColor;

    // 0. Flip the UI kit token set (all --ck-* driven surfaces follow)
    setKitTheme(isNightMode);

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
            ? 'rgba(10, 10, 46, 0.8)' // Night: Dark Blue
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
    const hud = abilityHud();
    if (!hud) return;

    const { energy } = hud;
    energy.setValue(playerEnergy, playerMaxEnergy);

    // Pulse to the beat when energy is low (< 30%). The kit meter owns the
    // warning colours via [data-ck-state="low"]; we only drive the pulse.
    if (energy.isLow()) {
        if (!_lastLowEnergyWarning) {
            announce('Warning: Critical energy level', 'assertive');
            _lastLowEnergyWarning = true;
        }

        const kick = _cachedPrefersReducedMotion ? 0 : audioState?.kickTrigger || 0;
        // Add an intense, juicy pulse based on the beat
        const targetScale = 1.0 + kick * 0.25;

        // 🎨 Palette: Smooth organic pulse instead of instant snap
        _currentEnergyPulseScale = THREE.MathUtils.damp(
            _currentEnergyPulseScale,
            targetScale,
            15,
            delta
        );
        energy.setPulse(_currentEnergyPulseScale);
    } else {
        _lastLowEnergyWarning = false;

        // 🎨 Palette: Smoothly return to normal scale when energy recovers
        _currentEnergyPulseScale = THREE.MathUtils.damp(_currentEnergyPulseScale, 1.0, 10, delta);
        energy.setPulse(_currentEnergyPulseScale);
    }
}

export function updateDashHUD(dashCooldown: number, audioState: any): void {
    const hud = abilityHud();
    if (!hud) return;
    const slot = hud.dash;

    const dashPct = Math.min(1, Math.max(0, dashCooldown));
    slot.setCooldown(dashPct);

    const isReady = dashPct <= 0;
    if (isReady !== _lastDashReady) {
        if (isReady) {
            slot.setReady(true);
            slot.describe('Dash Ability (E) - Ready!', 'Dash (E) - Ready!');

            // ♿ Aria: Announce ability readiness specifically when pointer-locked
            if (_lastDashReady === false) {
                announce('Dash ready', 'polite');
            }
        } else {
            slot.setReady(false);
            slot.describe('Dash Ability (E) - Recharging...', 'Dash (E) - Recharging...');
        }
        _lastDashReady = isReady;
    }

    // PALETTE: Pulse to the beat when ready!
    if (isReady) {
        slot.pulse(_cachedPrefersReducedMotion ? 0 : audioState?.kickTrigger || 0);
    } else {
        slot.clearPulse(); // Reset to CSS
    }
}

export function updateMineHUD(mineCooldown: number, audioState: any): void {
    const hud = abilityHud();
    if (!hud) return;
    const slot = hud.mine;

    const minePct = Math.min(1, Math.max(0, mineCooldown));
    slot.setCooldown(minePct);

    const isReady = minePct <= 0;
    if (isReady !== _lastMineReady) {
        if (isReady) {
            slot.setReady(true);
            slot.describe('Jitter Mine Ability (F) - Ready!', 'Jitter Mine (F) - Ready!');

            // ♿ Aria: Announce ability readiness specifically when pointer-locked
            if (_lastMineReady === false) {
                announce('Jitter Mine ready', 'polite');
            }
        } else {
            slot.setReady(false);
            slot.describe(
                'Jitter Mine Ability (F) - Recharging...',
                'Jitter Mine (F) - Recharging...'
            );
        }
        _lastMineReady = isReady;
    }

    // PALETTE: Pulse to the beat when ready!
    if (isReady) {
        slot.pulse(_cachedPrefersReducedMotion ? 0 : audioState?.kickTrigger || 0);
    } else {
        slot.clearPulse();
    }
}

export function updatePhaseHUD(
    phaseCount: number,
    isPhasing: boolean,
    phaseTimer: number,
    audioState: any
): void {
    const hud = abilityHud();
    if (!hud) return;
    const slot = hud.phase;

    let countChanged = false;

    // Update Badge Count (Throttled by value check)
    if (phaseCount !== _lastPhaseCount) {
        slot.setBadge(phaseCount);
        _lastPhaseCount = phaseCount;
        countChanged = true;
    }

    // Handle State
    if (isPhasing) {
        const duration = 5.0; // From physics.ts
        const remaining = Math.max(0, phaseTimer);
        const pct = remaining / duration;

        // Show duration depleting
        slot.setCooldown(pct);

        if (isPhasing !== _lastPhaseActive) {
            slot.setActive(true);
            slot.setReady(true);
            _lastPhaseActive = isPhasing;
            announce('Phase shift active', 'polite');
            _lastPhaseAnnouncedSecond = Math.ceil(remaining);
        }

        // ♿ Aria: Throttle label updates to integer seconds to avoid screen reader spam
        const currentSecond = Math.ceil(remaining);
        if (currentSecond !== _lastPhaseAnnouncedSecond) {
            slot.describe(
                `Phase Shift active, ${currentSecond} seconds remaining`,
                `Phase Shift Active: ${currentSecond}s left`
            );
            _lastPhaseAnnouncedSecond = currentSecond;
        }
    } else {
        // Not Active - Show Availability
        slot.setCooldown(0); // Clear overlay

        const stateChanged = isPhasing !== _lastPhaseActive;
        if (stateChanged) {
            const wasActive = _lastPhaseActive;
            slot.setActive(false);
            _lastPhaseActive = isPhasing;
            // Only announce if we actually transitioned from true to false
            if (wasActive === true && _lastPhaseCount !== null) {
                announce(
                    `Phase shift ended. ${phaseCount} bulb${phaseCount !== 1 ? 's' : ''} remaining`,
                    'polite'
                );
            }
        }

        // Check Availability (Ammo) - Update only on state change or count change
        if (stateChanged || countChanged) {
            if (phaseCount > 0) {
                slot.setReady(true);
                const bulbs = `${phaseCount} Bulb${phaseCount !== 1 ? 's' : ''}`;
                slot.describe(
                    `Phase Shift (Z) - ${phaseCount} Bulbs Available`,
                    `Phase Shift (Z) - ${bulbs} Available`
                );
            } else {
                slot.setReady(false);
                slot.describe(
                    'Phase Shift (Z) - Empty (Need Tremolo Bulb)',
                    'Phase Shift (Z) - Need Tremolo Bulb'
                );
            }
        }

        // PALETTE: Pulse to the beat when ready (Ammo > 0)!
        if (phaseCount > 0) {
            slot.pulse(_cachedPrefersReducedMotion ? 0 : audioState?.kickTrigger || 0);
        } else {
            slot.clearPulse();
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
    /** Optional override; when omitted mine HUD stays at ready (0). */
    mineCooldown?: number;
}): void {
    const { player, audioState, delta, mineCooldown = 0 } = params;

    // 🎨 Palette: Update Energy Bar (UI Feedback)
    updateEnergyBar(player.energy, player.maxEnergy, audioState, delta);

    // 🎨 Palette: Update Ability HUD - Dash
    updateDashHUD(player.dashCooldown, audioState);

    // 🎨 Palette: Update Ability HUD - Mine
    updateMineHUD(mineCooldown, audioState);

    // 🎨 Palette: Update Phase Shift HUD (Ammo + Duration)
    updatePhaseHUD(
        unlockSystem.getItemCount('tremolo_bulb'),
        player.isPhasing,
        player.phaseTimer,
        audioState
    );
}
