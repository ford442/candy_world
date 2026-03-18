export {};

// Loading Screen types
type LoadingPhase = {
  id: string;
  name: string;
  weight: number;
  description: string;
  isDeferred?: boolean;
  onStart?: () => void;
  onComplete?: () => void;
};

type LoadingProgress = {
  phase: string;
  phaseIndex: number;
  totalPhases: number;
  percent: number;
  overallPercent: number;
  taskDescription: string;
  estimatedTimeRemaining: number;
};

type LoadingScreenOptions = {
  debug?: boolean;
  showEstimatedTime?: boolean;
  allowSkipDeferred?: boolean;
  fadeOutDuration?: number;
  theme?: 'candy' | 'dark' | 'minimal';
};

declare global {
  interface Window {
    // Legacy loading API
    setLoadingStatus: (text: string) => void;
    hideLoadingScreen: () => void;
    showLoadingScreen: () => void;
    updateLoadingProgress: (phase: string, percent: number, taskDescription?: string) => void;
    
    // Scene ready flag
    __sceneReady?: boolean;
    
    // Audio
    libopenmptReady?: Promise<any>;
    libopenmpt?: {
      INITIAL_MEMORY: number;
      onRuntimeInitialized: () => void;
    };
    NativeWebAssembly?: typeof WebAssembly;
    
    // Loading Screen API
    LoadingScreen?: {
      new (options?: LoadingScreenOptions): LoadingScreenInstance;
    };
    getLoadingScreen?: () => LoadingScreenInstance | null;
    initLoadingScreen?: (options?: LoadingScreenOptions) => LoadingScreenInstance;
    setLoadingDebug?: (enabled: boolean) => void;
  }
  
  // Loading Screen instance interface
  interface LoadingScreenInstance {
    show(): void;
    hide(): void;
    setPhases(phases: LoadingPhase[]): void;
    startPhase(phaseId: string): void;
    updateProgress(percent: number, taskDescription?: string): void;
    completePhase(phaseId?: string): void;
    skipCurrentPhase(): void;
    setStatus(text: string): void;
    onSkip(callback: (phaseId: string) => void): () => void;
    onComplete(callback: () => void): () => void;
    onProgress(callback: (progress: LoadingProgress) => void): () => void;
    getVisible(): boolean;
    getProgress(): LoadingProgress;
    getTimingStats(): { phaseDurations: Map<string, number>; averagePhaseTime: number };
  }
}

// Declare modules for JS files without types
declare module '*/src/utils/wasm-loader.js' {
  export function initWasm(): Promise<boolean>;
  export function initWasmParallel(): Promise<boolean>;
  export function isWasmReady(): boolean;
  export function getGroundHeight(x: number, z: number): number;
  export const LOADING_PHASES: any;
}

declare module '*/src/core/init.js' {
  export function initScene(): any;
  export function forceFullSceneWarmup(renderer: any, scene: any, camera: any): Promise<void>;
}

declare module '*/src/utils/profiler.js' {
  export const profiler: {
    startFrame(): void;
    endFrame(): void;
    measure<T>(name: string, fn: () => T): T;
    toggle(): void;
  };
}

declare module '*/src/foliage/fluid_fog.js' {
  import { Mesh } from 'three';
  export function createFluidFog(width?: number, depth?: number): Mesh;
}
