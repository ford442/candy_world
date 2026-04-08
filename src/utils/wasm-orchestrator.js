// WASM-First GPU Pipeline Orchestrator
// Stub file - re-exports from wasm-orchestrator.ts
//
// This file is maintained for backwards compatibility.
// All implementation has been moved to TypeScript.

export {
    LOADING_PHASES,
    PHASE_STATUS,
    getSharedBuffer,
    isSharedMemoryAvailable,
    initSharedBuffer,
    signalPhaseComplete,
    signalPhaseStart,
    parallelWasmLoad,
    createPlaceholderScene,
    removePlaceholderScene
} from './wasm-orchestrator.ts';
