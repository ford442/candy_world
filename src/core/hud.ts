export function updateEnergyBar(
    playerEnergy: number,
    playerMaxEnergy: number,
    audioState: any,
    delta: number
): void {
    if (!hudEnergyContainer || !hudEnergyFill) return;

    const energyPct = Math.max(0, Math.min(1, playerEnergy / playerMaxEnergy));
    hudEnergyFill.style.width = `${energyPct * 100}%`;

    // WCAG 4.1.2 fix: Use absolute values for dynamic maxEnergy
    // aria-valuenow = current energy (absolute)
    // aria-valuemax = playerMaxEnergy (dynamic, updates on upgrades)
    hudEnergyContainer.setAttribute('aria-valuenow', playerEnergy.toFixed(1));
    hudEnergyContainer.setAttribute('aria-valuemax', playerMaxEnergy.toString());

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