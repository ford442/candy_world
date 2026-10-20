/**
 * Who is driving this page: a person, or a test harness.
 *
 * `automation` is decided only by signals a harness sets on purpose:
 * `navigator.webdriver` (Playwright, Selenium, Puppeteer), the
 * `window.__IS_FULL_BOOT_TEST` flag the smoke and visual-regression runners
 * inject, and the `HeadlessChrome/` product token. A broad user-agent regex
 * is deliberately not used: `/headless|playwright|ci|test/i` matched
 * "Macintosh" and put every Mac player in CI mode with no frame loop (#1972).
 *
 * Subsystems ask the specific question they need (`isAutomation()`,
 * `getPlatformCapabilities().computeAvailable`, …), never "is this CI?".
 */

import { readUserAgent } from './user-agent.ts';

export type RunMode = 'player' | 'automation';

export interface RunModeSignals {
    userAgent: string;
    webdriver: boolean;
    fullBootTest: boolean;
}

const HEADLESS_CHROME = /\bHeadlessChrome\//;

/** Pure classifier — the only place the run mode is decided. */
export function classifyRunMode(signals: RunModeSignals): RunMode {
    if (signals.webdriver || signals.fullBootTest) return 'automation';
    if (HEADLESS_CHROME.test(signals.userAgent)) return 'automation';
    return 'player';
}

export function gatherRunModeSignals(): RunModeSignals {
    let webdriver = false;
    let fullBootTest = false;
    try {
        webdriver = typeof navigator !== 'undefined' && navigator.webdriver === true;
    } catch {
        /* non-browser */
    }
    try {
        fullBootTest =
            typeof window !== 'undefined' &&
            (window as Window & { __IS_FULL_BOOT_TEST?: boolean }).__IS_FULL_BOOT_TEST === true;
    } catch {
        /* non-browser */
    }
    return { userAgent: readUserAgent(), webdriver, fullBootTest };
}

let cached: RunMode | null = null;

/**
 * The run mode for this page load. Cached on first call: the harness flags are
 * injected before any module runs, and per-frame callers read this.
 */
export function getRunMode(): RunMode {
    if (cached) return cached;
    const mode = classifyRunMode(gatherRunModeSignals());
    // Outside a browser (node tests) nothing is cached, so a test can install
    // a fake window/navigator and see the result.
    if (typeof window !== 'undefined') cached = mode;
    return mode;
}

export function isAutomation(): boolean {
    return getRunMode() === 'automation';
}

/**
 * `?freezeLoop=1`: boot to `__sceneReady` without starting the animation loop.
 * Opt-in only, for harnesses where a running loop wedges headless WebGPU. A
 * player never loses the loop because of what their browser is.
 */
export function isLoopFreezeRequested(): boolean {
    try {
        const v = new URLSearchParams(window.location.search).get('freezeLoop');
        return v === '1' || v === 'true' || v === '';
    } catch {
        return false;
    }
}

/** @internal tests */
export function __resetRunModeForTests(): void {
    cached = null;
}
