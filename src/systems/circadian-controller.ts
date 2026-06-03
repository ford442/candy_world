import { CONFIG } from '../core/config.ts';
import { uCircadianPhase, uCircadianPoseOffset } from './biome-uniforms.ts';

const cfg = CONFIG.circadian;

// Smoothstep easing: 3t² - 2t³
function smoothstep(t: number): number {
    const c = Math.max(0, Math.min(1, t));
    return c * c * (3 - 2 * c);
}

class CircadianController {
    private phase = 0.5;   // 0 = night, 1 = day
    private target = 1.0;  // start assuming day

    setDayTarget(isDay: boolean): void {
        this.target = isDay ? 1.0 : 0.0;
    }

    update(dt: number): void {
        const speed = dt / cfg.transitionSeconds;
        this.phase += (this.target - this.phase) * Math.min(1.0, speed);

        const eased = smoothstep(this.phase);

        uCircadianPhase.value = this.phase;
        uCircadianPoseOffset.value =
            cfg.nightPoseOffset + (cfg.dayPoseOffset - cfg.nightPoseOffset) * eased;
    }

    getPhase(): number { return this.phase; }
}

export const circadianController = new CircadianController();
