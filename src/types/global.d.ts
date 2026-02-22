export {};

declare global {
  interface Window {
    setLoadingStatus: (text: string) => void;
    hideLoadingScreen: () => void;
    __sceneReady?: boolean;
    libopenmptReady?: Promise<any>;
    libopenmpt?: {
      INITIAL_MEMORY: number;
      onRuntimeInitialized: () => void;
    };
    NativeWebAssembly?: typeof WebAssembly;
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
