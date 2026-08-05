/**
 * Lazy photo-mode loader — cinematic controls only when FEATURE_FLAGS.photoMode
 * or on first use (P key after scene init registers options).
 */
import type * as THREE from 'three';
import { FEATURE_FLAGS } from '../../core/config.ts';
import type { PhotoModeInitOptions } from './photo-mode.ts';

type PhotoModule = typeof import('./index.ts');

let _mod: PhotoModule | null = null;
let _load: Promise<PhotoModule | null> | null = null;
let _initOpts: PhotoModeInitOptions | null = null;
let _initialized = false;

function ensurePhotoMode(): Promise<PhotoModule | null> {
    if (_mod) return Promise.resolve(_mod);
    if (!_load) {
        _load = import('./index.ts').then((m) => {
            _mod = m;
            return m;
        });
    }
    return _load;
}

export function registerPhotoModeInit(opts: PhotoModeInitOptions): void {
    _initOpts = opts;
    if (FEATURE_FLAGS.photoMode) {
        void preloadPhotoMode();
    }
}

export async function preloadPhotoMode(): Promise<void> {
    await ensurePhotoModeReady();
}

/** Load photo-mode chunk and run initPhotoMode when opts were registered. */
export async function ensurePhotoModeReady(): Promise<PhotoModule | null> {
    const m = await ensurePhotoMode();
    if (!m || !_initOpts) return null;
    if (!_initialized) {
        m.initPhotoMode(_initOpts);
        _initialized = true;
    }
    return m;
}

export function getPhotoMode(): ReturnType<PhotoModule['getPhotoMode']> | null {
    return _mod?.getPhotoMode() ?? null;
}

export function isPhotoModeActive(): boolean {
    return _mod?.isPhotoModeActive() ?? false;
}

export function initPhotoMode(opts: PhotoModeInitOptions): void {
    registerPhotoModeInit(opts);
}

/** Keyboard-safe toggle — loads chunk on first P press when flag was off. */
export function togglePhotoMode(): void {
    void ensurePhotoModeReady().then((m) => m?.getPhotoMode()?.toggle());
}
