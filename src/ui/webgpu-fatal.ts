/**
 * @file webgpu-fatal.ts
 * @description Blocking boot screen for "this browser cannot run Candy World".
 *
 * WebGPU is required to enter the world. When `probeWebGPU()` fails there is no
 * WebGL rescue in this phase — booting the GL renderer instead is exactly what
 * used to hide the Chrome-vs-Edge adapter failure behind a picture that looked
 * fine. So we stop here and show the user what broke, with the probe JSON right
 * on screen so a bug report can be copied in one click.
 *
 * @see docs/WEBGPU_CONTEXT.md
 */

import { getWebGPUProbeReport } from '../rendering/gpu-context.ts';

const OVERLAY_ID = 'webgpu-fatal';

/** Human-facing explanation per probe stage. Keep these actionable. */
const STAGE_ADVICE: Record<string, string> = {
    navigator:
        'This browser does not expose WebGPU at all. Use Chrome or Edge 113+, or a browser with WebGPU enabled.',
    adapter:
        'The browser has WebGPU but could not open a graphics adapter. Your GPU or driver may be blocklisted — check chrome://gpu (edge://gpu) and update your graphics driver.',
    device: 'A GPU adapter was found but refused to create a device. This usually means an out-of-date driver.',
    canvas: 'The page could not obtain a WebGPU canvas context.',
    configure: 'The GPU device could not be attached to the canvas.',
    pipeline:
        'The GPU device cannot compile compute shaders, which Candy World needs for foliage, culling and particles.',
    renderer: 'The renderer failed to start on WebGPU, and this build will not fall back to WebGL.',
};

function stageAdvice(stage: unknown): string {
    return (
        STAGE_ADVICE[String(stage)] ?? 'WebGPU could not be initialised on this browser and device.'
    );
}

/**
 * Replace the loading screen with a blocking, non-dismissable failure screen.
 *
 * Idempotent: the first failure wins, so a follow-on rejection cannot overwrite
 * the message that actually explains the fault.
 *
 * @param error The error that stopped boot.
 */
export function showWebGPUFatalScreen(error: unknown): void {
    if (typeof document === 'undefined' || !document.body) return;
    if (document.getElementById(OVERLAY_ID)) return;

    const report = (getWebGPUProbeReport() ?? {}) as Record<string, unknown>;
    const stage = report.stage ?? (error as { stage?: string })?.stage ?? 'unknown';
    const reason =
        (report.reason as string | null) ??
        (error instanceof Error ? error.message : String(error ?? 'Unknown error'));
    const browser = (report.browser ?? {}) as { name?: string; version?: string };

    // Stop the loading screen's spinner/ticker from animating underneath.
    document.getElementById('loading-container')?.classList.add('fatal-error');
    document.body.removeAttribute('aria-busy');

    const overlay = document.createElement('div');
    overlay.id = OVERLAY_ID;
    overlay.setAttribute('role', 'alertdialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'webgpu-fatal-title');
    overlay.setAttribute('aria-describedby', 'webgpu-fatal-body');

    const diagnostics = JSON.stringify(
        { stage, reason, ...report, error: error instanceof Error ? error.stack : String(error) },
        null,
        2
    );

    overlay.innerHTML = `
      <style>
        #${OVERLAY_ID} {
          position: fixed; inset: 0; z-index: 2147483647;
          display: flex; align-items: center; justify-content: center; padding: 24px;
          background: linear-gradient(160deg, #2a1020 0%, #3b1430 60%, #24101f 100%);
          font-family: Inter, ui-sans-serif, system-ui, sans-serif; color: #ffe9f2;
          overflow: auto;
        }
        #${OVERLAY_ID} .card {
          max-width: 640px; width: 100%;
          background: rgba(255, 233, 242, 0.06);
          border: 1px solid rgba(255, 209, 220, 0.28);
          border-radius: 20px; padding: 28px 30px;
          box-shadow: 0 24px 70px rgba(0, 0, 0, 0.45);
        }
        #${OVERLAY_ID} h1 { margin: 0 0 6px; font-size: 22px; letter-spacing: 0.2px; }
        #${OVERLAY_ID} .stage {
          display: inline-block; margin-bottom: 16px; padding: 3px 10px;
          border-radius: 999px; font-size: 11px; font-weight: 700;
          letter-spacing: 0.6px; text-transform: uppercase;
          background: rgba(255, 138, 178, 0.22); color: #ffc2d8;
        }
        #${OVERLAY_ID} p { margin: 0 0 14px; line-height: 1.55; font-size: 14px; color: #f5d9e6; }
        #${OVERLAY_ID} .reason {
          font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
          font-size: 12px; color: #ffb9d2; word-break: break-word;
        }
        #${OVERLAY_ID} details { margin-top: 16px; }
        #${OVERLAY_ID} summary { cursor: pointer; font-size: 13px; color: #ffc2d8; }
        #${OVERLAY_ID} pre {
          margin: 10px 0 0; padding: 12px; max-height: 240px; overflow: auto;
          background: rgba(0, 0, 0, 0.34); border-radius: 12px;
          font-size: 11px; line-height: 1.45; color: #ffd9e8; white-space: pre-wrap;
        }
        #${OVERLAY_ID} .actions { display: flex; gap: 10px; margin-top: 20px; flex-wrap: wrap; }
        #${OVERLAY_ID} button {
          font: inherit; font-weight: 600; font-size: 13px; cursor: pointer;
          padding: 9px 18px; border-radius: 999px; border: 1px solid transparent;
        }
        #${OVERLAY_ID} .primary { background: #ffd1dc; color: #3b1020; }
        #${OVERLAY_ID} .secondary {
          background: transparent; color: #ffd1dc; border-color: rgba(255, 209, 220, 0.45);
        }
        #${OVERLAY_ID} button:focus-visible { outline: 3px solid #ffe9f2; outline-offset: 2px; }
      </style>
      <div class="card">
        <h1 id="webgpu-fatal-title">Candy World needs WebGPU</h1>
        <div class="stage">probe failed at: ${escapeHtml(String(stage))}</div>
        <div id="webgpu-fatal-body">
          <p>${escapeHtml(stageAdvice(stage))}</p>
          <p class="reason">${escapeHtml(reason)}</p>
          <p>Detected browser: <strong>${escapeHtml(
              `${browser.name ?? 'unknown'} ${browser.version ?? ''}`.trim()
          )}</strong></p>
        </div>
        <details>
          <summary>Diagnostics</summary>
          <pre id="webgpu-fatal-json"></pre>
        </details>
        <div class="actions">
          <button type="button" class="primary" id="webgpu-fatal-reload">Reload</button>
          <button type="button" class="secondary" id="webgpu-fatal-copy">Copy diagnostics</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    // Assigned via textContent, never innerHTML — the report carries a UA string
    // and driver-supplied adapter strings.
    const pre = overlay.querySelector('#webgpu-fatal-json') as HTMLElement;
    pre.textContent = diagnostics;

    const reload = overlay.querySelector('#webgpu-fatal-reload') as HTMLButtonElement;
    reload.addEventListener('click', () => window.location.reload());

    const copy = overlay.querySelector('#webgpu-fatal-copy') as HTMLButtonElement;
    copy.addEventListener('click', async () => {
        try {
            await navigator.clipboard.writeText(diagnostics);
            copy.textContent = 'Copied';
        } catch {
            copy.textContent = 'Copy failed — select the text above';
        }
    });

    reload.focus({ preventScroll: true });
    console.error('[Boot] WebGPU hard-fail:', diagnostics);
}

function escapeHtml(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}
