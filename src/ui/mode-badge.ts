export type WorldMode = 'CORE' | 'FULL';

let modeBadge: HTMLDivElement | null = null;
let rendererBadge: HTMLDivElement | null = null;

export function showRendererBadge(
  activeBackend: 'webgpu' | 'webgl',
  requested: 'webgpu' | 'webgl',
  fallbackReason: string | null,
) {
  if (rendererBadge) {
    rendererBadge.remove();
  }

  rendererBadge = document.createElement('div');
  rendererBadge.id = 'renderer-badge';

  Object.assign(rendererBadge.style, {
    position: 'fixed',
    top: '12px',
    left: '12px',
    padding: '6px 10px',
    borderRadius: '999px',
    fontSize: '12px',
    fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif',
    fontWeight: '700',
    letterSpacing: '0.4px',
    zIndex: '10000',
    pointerEvents: 'none',
    userSelect: 'none',
    whiteSpace: 'nowrap',
    boxShadow: '0 10px 30px rgba(0, 0, 0, 0.12)',
    border: '1px solid rgba(255, 255, 255, 0.45)',
    backdropFilter: 'blur(10px)',
    transition: 'transform 0.2s ease, opacity 0.2s ease',
    opacity: '0.98',
  });

  const isFallback = requested === 'webgpu' && activeBackend === 'webgl';
  const label = activeBackend === 'webgl'
    ? (requested === 'webgl' ? 'WEBGL2 DEBUG' : 'WEBGL2 FALLBACK')
    : 'WEBGPU';

  if (activeBackend === 'webgl') {
    rendererBadge.style.background = 'rgba(255, 209, 220, 0.92)';
    rendererBadge.style.color = '#3b1020';
  } else {
    rendererBadge.style.background = 'rgba(135, 206, 250, 0.92)';
    rendererBadge.style.color = '#0f2a3a';
  }

  rendererBadge.innerText = label;
  if (isFallback && fallbackReason) {
    rendererBadge.title = `Requested WebGPU; using WebGL (${fallbackReason})`;
  } else if (activeBackend === 'webgl') {
    rendererBadge.title = 'WebGL2 reference renderer — G: wireframe, M: material debug';
  }

  document.body.appendChild(rendererBadge);
}

export function removeRendererBadge() {
  if (rendererBadge) {
    rendererBadge.remove();
    rendererBadge = null;
  }
}

export function showModeBadge(mode: WorldMode) {
  if (modeBadge) {
    modeBadge.remove();
  }

  modeBadge = document.createElement('div');
  modeBadge.id = 'mode-badge';

  Object.assign(modeBadge.style, {
    position: 'fixed',
    top: '12px',
    right: '12px',
    padding: '6px 10px',
    borderRadius: '999px',
    fontSize: '12px',
    fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif',
    fontWeight: '700',
    letterSpacing: '0.4px',
    zIndex: '10000',
    pointerEvents: 'none',
    userSelect: 'none',
    whiteSpace: 'nowrap',
    boxShadow: '0 10px 30px rgba(0, 0, 0, 0.12)',
    border: '1px solid rgba(255, 255, 255, 0.45)',
    backdropFilter: 'blur(10px)',
    transition: 'transform 0.2s ease, opacity 0.2s ease',
    opacity: '0.98',
  });

  if (mode === 'CORE') {
    modeBadge.style.background = 'rgba(255, 158, 205, 0.92)';
    modeBadge.style.color = '#2b0f1c';
    modeBadge.innerText = 'CORE MODE';
  } else {
    modeBadge.style.background = 'rgba(125, 211, 252, 0.92)';
    modeBadge.style.color = '#0f2a3a';
    modeBadge.innerText = 'FULL MODE';
  }

  document.body.appendChild(modeBadge);
}

export function removeModeBadge() {
  if (modeBadge) {
    modeBadge.remove();
    modeBadge = null;
  }
}
