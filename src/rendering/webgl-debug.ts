/**
 * WebGL2 debug helpers for visual inspection, agent screenshots, and CI.
 *
 * Active when the active renderer is WebGL (?renderer=webgl).
 * URL params:
 *   ?wireframe=1       — scene-wide wireframe overlay
 *   ?matDebug=1        — MeshNormalMaterial override
 *   ?webglLite=1       — disable GPU compute + force CORE world generation
 */

import * as THREE from 'three';
import type { RendererBackend } from './renderer-mode.ts';

export interface WebGLDebugOptions {
  wireframe: boolean;
  materialDebug: boolean;
  liteGeneration: boolean;
}

type MaterialSnapshot = { wireframe: boolean };

const materialSnapshots = new WeakMap<THREE.Material, MaterialSnapshot>();
let wireframeEnabled = false;
let materialDebugEnabled = false;
let normalOverride: THREE.MeshNormalMaterial | null = null;
let activeScene: THREE.Scene | null = null;

function hasFlag(key: string): boolean {
  try {
    return new URLSearchParams(window.location.search).has(key);
  } catch {
    return false;
  }
}

function hasTruthyParam(key: string): boolean {
  try {
    const raw = new URLSearchParams(window.location.search).get(key);
    return raw === '1' || raw === 'true';
  } catch {
    return false;
  }
}

export function parseWebGLDebugOptions(search: string = window.location.search): WebGLDebugOptions {
  const params = new URLSearchParams(search);
  return {
    wireframe: params.get('wireframe') === '1' || params.get('wireframe') === 'true',
    materialDebug:
      params.get('matDebug') === '1' ||
      params.get('matDebug') === 'true' ||
      params.get('materialDebug') === '1' ||
      params.get('materialDebug') === 'true',
    liteGeneration:
      params.get('webglLite') === '1' ||
      params.get('webglLite') === 'true' ||
      params.get('lite') === '1' ||
      params.get('lite') === 'true',
  };
}

export function isWebGLLiteMode(): boolean {
  return parseWebGLDebugOptions().liteGeneration || hasFlag('webglLite') || hasFlag('lite');
}

function forEachMaterial(
  material: THREE.Material | THREE.Material[],
  fn: (mat: THREE.Material) => void,
): void {
  if (Array.isArray(material)) {
    material.forEach(fn);
  } else {
    fn(material);
  }
}

function snapshotMaterial(mat: THREE.Material): MaterialSnapshot {
  return {
    wireframe: 'wireframe' in mat ? !!(mat as THREE.MeshStandardMaterial).wireframe : false,
  };
}

function applyWireframe(mat: THREE.Material, enabled: boolean): void {
  if ('wireframe' in mat) {
    (mat as THREE.MeshStandardMaterial).wireframe = enabled;
    mat.needsUpdate = true;
  }
}

function setWireframe(scene: THREE.Scene, enabled: boolean): void {
  wireframeEnabled = enabled;
  scene.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh || !mesh.material) return;

    forEachMaterial(mesh.material, (mat) => {
      if (!materialSnapshots.has(mat)) {
        materialSnapshots.set(mat, snapshotMaterial(mat));
      }
      applyWireframe(mat, enabled);
    });
  });
}

function setMaterialDebug(scene: THREE.Scene, enabled: boolean): void {
  materialDebugEnabled = enabled;
  if (enabled) {
    if (!normalOverride) {
      normalOverride = new THREE.MeshNormalMaterial();
    }
    scene.overrideMaterial = normalOverride;
  } else {
    scene.overrideMaterial = null;
  }
}

function syncUrlFlag(key: string, enabled: boolean): void {
  const params = new URLSearchParams(window.location.search);
  if (enabled) {
    params.set(key, '1');
  } else {
    params.delete(key);
  }
  const next = params.toString();
  window.history.replaceState({}, '', `${window.location.pathname}${next ? `?${next}` : ''}`);
}

export function applyWebGLLiteBootFlags(): void {
  if (!isWebGLLiteMode()) return;

  const target = window as Window & {
    __computeDisabled?: boolean;
    __WEBGL_LITE?: boolean;
  };
  target.__computeDisabled = true;
  target.__WEBGL_LITE = true;
  console.warn('[WebGLDebug] Lite mode active — compute disabled, CORE world recommended');
}

export function initWebGLDebug(scene: THREE.Scene, activeBackend: RendererBackend): WebGLDebugOptions {
  activeScene = scene;
  const options = parseWebGLDebugOptions();

  if (activeBackend !== 'webgl') {
    return options;
  }

  applyWebGLLiteBootFlags();

  if (options.wireframe) {
    setWireframe(scene, true);
  }
  if (options.materialDebug) {
    setMaterialDebug(scene, true);
  }

  const onKeyDown = (event: KeyboardEvent) => {
    const target = event.target as HTMLElement | null;
    if (
      target &&
      (target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT' ||
        target.isContentEditable)
    ) {
      return;
    }

    if (event.key === 'g' || event.key === 'G') {
      const next = !wireframeEnabled;
      setWireframe(scene, next);
      syncUrlFlag('wireframe', next);
      console.log(`[WebGLDebug] Wireframe ${next ? 'enabled' : 'disabled'}`);
    }

    if (event.key === 'm' || event.key === 'M') {
      const next = !materialDebugEnabled;
      setMaterialDebug(scene, next);
      syncUrlFlag('matDebug', next);
      console.log(`[WebGLDebug] Material debug ${next ? 'enabled' : 'disabled'}`);
    }
  };

  document.addEventListener('keydown', onKeyDown);

  (window as Window & {
    candy_set_webgl_debug_mode?: (mode: 'wireframe' | 'material' | 'lite', enabled: boolean) => void;
    candy_get_webgl_debug_state?: () => { wireframe: boolean; materialDebug: boolean; liteGeneration: boolean };
  }).candy_set_webgl_debug_mode = (mode, enabled) => {
    if (mode === 'wireframe') {
      setWireframe(scene, enabled);
      syncUrlFlag('wireframe', enabled);
    } else if (mode === 'material') {
      setMaterialDebug(scene, enabled);
      syncUrlFlag('matDebug', enabled);
    } else if (mode === 'lite' && enabled) {
      applyWebGLLiteBootFlags();
      syncUrlFlag('webglLite', true);
    }
  };

  (window as Window & {
    candy_get_webgl_debug_state?: () => { wireframe: boolean; materialDebug: boolean; liteGeneration: boolean };
  }).candy_get_webgl_debug_state = () => ({
    wireframe: wireframeEnabled,
    materialDebug: materialDebugEnabled,
    liteGeneration: isWebGLLiteMode(),
  });

  console.log(
    '%c[WebGLDebug] Helpers ready — G: wireframe, M: material debug',
    'color:#7dd3fc;font-weight:bold',
  );

  return options;
}

export function refreshWebGLDebugForScene(scene: THREE.Scene): void {
  if (activeScene !== scene) return;
  if (wireframeEnabled) setWireframe(scene, true);
  if (materialDebugEnabled) setMaterialDebug(scene, true);
}
