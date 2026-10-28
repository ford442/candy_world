/**
 * Frame hitches in the first seconds of play.
 *
 * Shader compiles on first draw are the main source of early hitches, and the
 * warmup (`rendering/shader-warmup.ts`) exists to move them off the frame. This
 * records what a player sees: the first frame's duration, and how many frame
 * intervals ran over 50 ms and 100 ms in the first {@link HITCH_WINDOW_MS}
 * after the loop started. {@link installFrameHitchCounter} publishes the live
 * report as `window.__frameHitches` and logs it once the window closes.
 *
 * Leaf module (no imports): it has its own Vite chunk so it stays out of `app`.
 */

export const HITCH_WINDOW_MS = 30_000;
export const HITCH_MS = 50;
export const SEVERE_HITCH_MS = 100;

export interface FrameHitchReport {
    /** Work time of the first frame (entry to end of `animate()`). */
    firstFrameMs: number;
    /** Frames recorded inside the window. */
    frames: number;
    /** Frame intervals over {@link HITCH_MS}. */
    over50: number;
    /** Frame intervals over {@link SEVERE_HITCH_MS}. */
    over100: number;
    worstMs: number;
    windowMs: number;
    /** True once the window has closed; the numbers stop changing. */
    done: boolean;
}

export interface FrameHitchCounter {
    /** Call at the top of every frame. */
    beginFrame(now: number): void;
    /** Call at the end of every frame. */
    endFrame(now: number): void;
    report(): Readonly<FrameHitchReport>;
}

export function createFrameHitchCounter(
    onDone: (report: Readonly<FrameHitchReport>) => void = () => {}
): FrameHitchCounter {
    const report: FrameHitchReport = {
        firstFrameMs: 0,
        frames: 0,
        over50: 0,
        over100: 0,
        worstMs: 0,
        windowMs: HITCH_WINDOW_MS,
        done: false,
    };
    let start = -1;
    let lastBegin = -1;
    let frameBegin = 0;

    return {
        beginFrame(now) {
            frameBegin = now;
            if (report.done) return;
            if (start < 0) start = now;
            if (lastBegin >= 0) {
                const interval = now - lastBegin;
                if (interval > HITCH_MS) report.over50++;
                if (interval > SEVERE_HITCH_MS) report.over100++;
                if (interval > report.worstMs) report.worstMs = interval;
            }
            lastBegin = now;
            report.frames++;
            if (now - start >= HITCH_WINDOW_MS) {
                report.done = true;
                onDone(report);
            }
        },
        endFrame(now) {
            if (report.frames === 1 && report.firstFrameMs === 0) {
                report.firstFrameMs = now - frameBegin;
                if (report.firstFrameMs > report.worstMs) report.worstMs = report.firstFrameMs;
            }
        },
        report: () => report,
    };
}

/** The game loop's counter: published on `window.__frameHitches`, logged once. */
export function installFrameHitchCounter(): FrameHitchCounter {
    const counter = createFrameHitchCounter((r) =>
        // Production players are who this is for, so not the stripped `log.info`.
        // eslint-disable-next-line no-console
        console.log(
            `[GameLoop] First ${r.windowMs / 1000} s: ${r.frames} frames, ${r.over50} over ` +
                `${HITCH_MS} ms, ${r.over100} over ${SEVERE_HITCH_MS} ms, worst ` +
                `${r.worstMs.toFixed(0)} ms, first frame ${r.firstFrameMs.toFixed(0)} ms`
        )
    );
    if (typeof window !== 'undefined') {
        (window as Window & { __frameHitches?: unknown }).__frameHitches = counter.report();
    }
    return counter;
}
