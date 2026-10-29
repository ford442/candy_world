// src/systems/discovery-log.ts
//
// The Discovery Log overlay. Hidden harmonics only appear once found, unless
// the Resonance Tuner is owned (see `buildDiscoveryLogEntries`).

import { input } from '../core/input/actions/index.ts';
import { trapFocusInside } from '../utils/focus-trap.ts';
import { yieldToPaint } from '../utils/yield-to-paint.ts';
import { buildDiscoveryLogEntries, DISCOVERY_MAP } from './discovery-map.ts';
import { unlockSystem } from './unlocks.ts';

/** Pops the `menu` input context the open log holds. */
let popMenuContext: (() => void) | null = null;
let lastFocusedElement: HTMLElement | null = null;
let releaseFocusTrap: (() => void) | null = null;

export function showDiscoveryLog(isFound: (id: string) => boolean): void {
    // Remove existing if any
    const existingLog = document.getElementById('discovery-log-overlay');
    if (existingLog) {
        if (releaseFocusTrap) {
            releaseFocusTrap();
            releaseFocusTrap = null;
        }
        existingLog.style.opacity = '0';
        setTimeout(() => {
            existingLog.remove();
        }, 300);
        popMenuContext?.();
        popMenuContext = null;
        if (lastFocusedElement && typeof lastFocusedElement.focus === 'function') {
            lastFocusedElement.focus({ preventScroll: true });
            lastFocusedElement = null;
        }
        return; // Toggle behavior
    }

    lastFocusedElement = document.activeElement as HTMLElement | null;

    const overlay = document.createElement('div');
    overlay.id = 'discovery-log-overlay';
    popMenuContext?.();
    popMenuContext = input.pushContext('menu');

    // ♿ Aria: Apply modal semantics to the container element
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('tabindex', '-1');
    overlay.setAttribute('aria-labelledby', 'discovery-log-title');

    overlay.style.position = 'fixed';
    overlay.style.top = '0';
    overlay.style.left = '0';
    overlay.style.width = '100vw';
    overlay.style.height = '100vh';
    overlay.style.backgroundColor = 'rgba(0, 0, 0, 0.8)';
    overlay.style.display = 'flex';
    overlay.style.opacity = '1';
    overlay.style.transition = 'opacity 0.3s ease';
    overlay.style.justifyContent = 'center';
    overlay.style.alignItems = 'center';
    overlay.style.zIndex = '10000';
    overlay.style.backdropFilter = 'blur(5px)';

    const logContainer = document.createElement('div');
    logContainer.style.backgroundColor = '#2c2c3e';
    logContainer.style.color = 'white';
    logContainer.style.padding = '30px';
    logContainer.style.borderRadius = '15px';
    logContainer.style.width = '80%';
    logContainer.style.maxWidth = '600px';
    logContainer.style.maxHeight = '80vh';
    logContainer.style.overflowY = 'auto';
    logContainer.style.boxShadow = '0 10px 30px rgba(0,0,0,0.5)';
    logContainer.style.position = 'relative';

    const title = document.createElement('h2');
    title.id = 'discovery-log-title';
    title.innerText = 'Discovery Log 🌿';
    title.style.marginTop = '0';
    title.style.borderBottom = '2px solid #ff69b4';
    title.style.paddingBottom = '10px';
    title.style.textAlign = 'center';
    logContainer.appendChild(title);

    const closeBtn = document.createElement('button');
    closeBtn.className = 'discovery-close-btn';
    closeBtn.innerText = '✕';
    closeBtn.setAttribute('aria-label', 'Close discovery log');
    closeBtn.style.position = 'absolute';
    closeBtn.style.top = '15px';
    closeBtn.style.right = '20px';
    closeBtn.style.background = 'none';
    closeBtn.style.border = 'none';
    closeBtn.style.color = 'white';
    closeBtn.style.fontSize = '24px';
    closeBtn.style.cursor = 'pointer';

    const closeOverlay = () => {
        if (releaseFocusTrap) {
            releaseFocusTrap();
            releaseFocusTrap = null;
        }
        overlay.style.opacity = '0';
        setTimeout(() => {
            overlay.remove();
        }, 300);
        popMenuContext?.();
        popMenuContext = null;

        if (lastFocusedElement && typeof lastFocusedElement.focus === 'function') {
            lastFocusedElement.focus({ preventScroll: true });
            lastFocusedElement = null;
        }
    };
    closeBtn.onclick = closeOverlay;

    // Escape to close
    overlay.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            closeOverlay();
        }
    });



    logContainer.appendChild(closeBtn);

    const grid = document.createElement('div');
    grid.style.display = 'grid';
    grid.style.gridTemplateColumns = 'repeat(auto-fill, minmax(250px, 1fr))';
    grid.style.gap = '15px';
    grid.style.marginTop = '20px';

    const tuned = unlockSystem.isUnlocked('resonance_tuner');
    const entries = buildDiscoveryLogEntries(DISCOVERY_MAP, isFound, tuned);
    let count = 0;
    for (const entry of entries) {
        const itemDiv = document.createElement('div');
        itemDiv.style.padding = '10px';
        itemDiv.style.borderRadius = '10px';
        itemDiv.style.display = 'flex';
        itemDiv.style.alignItems = 'center';
        itemDiv.style.gap = '15px';
        itemDiv.style.backgroundColor = '#3c3c5e';

        const icon = document.createElement('span');
        icon.style.fontSize = '24px';
        const label = document.createElement('span');
        if (entry.state === 'found') {
            icon.textContent = entry.icon;
            label.textContent = entry.name;
            count++;
        } else if (entry.state === 'sensed') {
            itemDiv.style.opacity = '0.6';
            icon.textContent = '🎵';
            label.textContent = `${entry.name} (hidden harmonic)`;
        } else {
            itemDiv.style.opacity = '0.4';
            icon.textContent = '❓';
            label.textContent = 'Unknown Flora';
        }
        itemDiv.append(icon, label);
        grid.appendChild(itemDiv);
    }
    const totalItems = entries.length;

    const subtitle = document.createElement('p');
    subtitle.innerText = `Found ${count} of ${totalItems} rare species`;
    subtitle.style.textAlign = 'center';
    subtitle.style.color = '#ff69b4';
    subtitle.style.fontWeight = 'bold';
    logContainer.appendChild(subtitle);

    logContainer.appendChild(grid);
    overlay.appendChild(logContainer);
    document.body.appendChild(overlay);

    // Force reflow before trapping focus
    void overlay.offsetWidth;

    // Trap focus inside the overlay
    yieldToPaint(50).then(() => {
        if (document.getElementById('discovery-log-overlay')) {
            releaseFocusTrap = trapFocusInside(overlay, { skipAutoFocus: true });
            // Focus close button for accessibility
            closeBtn.focus({ preventScroll: true });
        }
    });
}

