/**
 * The only module allowed to read `navigator.userAgent` (enforced by the
 * `no-restricted-syntax` rule in eslint.config.js).
 *
 * The raw string is for reporting (analytics, profiler, probe diagnostics).
 * Behaviour must not branch on it: use `getRunMode()` or
 * `getPlatformCapabilities()` instead. The one heuristic kept here,
 * {@link isMobileUserAgent}, only nudges the performance-budget score.
 */

export function readUserAgent(): string {
    try {
        return typeof navigator !== 'undefined' ? (navigator.userAgent ?? '') : '';
    } catch {
        return '';
    }
}

const MOBILE_UA = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i;

/** Phone/tablet UA tokens. iPadOS 13+ reports a desktop Mac UA and is not matched. */
export function isMobileUserAgent(ua: string = readUserAgent()): boolean {
    return MOBILE_UA.test(ua);
}
