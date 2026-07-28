/**
 * Gated logging utility — debug/info stripped from production bundles via
 * `import.meta.env.DEV` (Vite replaces with `false` at build time).
 *
 * Usage:
 *   log.info('GameLoop', 'frame tick');
 *   log.warn('WASM', 'retry', attempt);
 *   log.error('Compute', 'dispatch failed', err);
 *
 * Category is prefixed as `[Category]` unless the first arg already includes it.
 * Verbose levels also honor `?debug=1` in the URL (no CONFIG import — avoids cycles).
 */

type LogArgs = unknown[];

function isVerbose(): boolean {
    if (import.meta.env.DEV) return true;
    if (typeof window !== 'undefined') {
        return new URLSearchParams(window.location.search).has('debug');
    }
    return false;
}

function formatArgs(category: string, args: LogArgs): LogArgs {
    if (args.length === 0) return [`[${category}]`];
    const [first, ...rest] = args;
    if (typeof first === 'string' && first.startsWith(`[${category}]`)) {
        return args;
    }
    if (typeof first === 'string') {
        return [`[${category}] ${first}`, ...rest];
    }
    return [`[${category}]`, first, ...rest];
}

function emit(level: 'log' | 'warn' | 'error', category: string, args: LogArgs): void {
    const sink = console[level];
    sink(...formatArgs(category, args));
}

export const log = {
    /** Dev / ?debug=1 only — dead-code-eliminated in production builds. */
    debug(category: string, ...args: LogArgs): void {
        if (import.meta.env.DEV) {
            emit('log', category, args);
        } else if (isVerbose()) {
            emit('log', category, args);
        }
    },

    /** Dev / ?debug=1 only — dead-code-eliminated in production builds. */
    info(category: string, ...args: LogArgs): void {
        if (import.meta.env.DEV) {
            emit('log', category, args);
        } else if (isVerbose()) {
            emit('log', category, args);
        }
    },

    warn(category: string, ...args: LogArgs): void {
        emit('warn', category, args);
    },

    error(category: string, ...args: LogArgs): void {
        emit('error', category, args);
    },
} as const;
