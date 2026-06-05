/**
 * Loading Screen — barrel re-export.
 *
 * Implementation lives in:
 *   loading-screen-ui.ts      — LoadingScreen class
 *   loading-screen-progress.ts — singleton API & legacy window bindings
 *   loading-screen-types.ts   — shared types & DEFAULT_LOADING_PHASES
 *
 * Do NOT add implementation here; keeping everything in one place prevents
 * the duplicate-singleton bug that arose when this file also defined its own
 * LoadingScreen class and API functions.
 */

export * from './loading-screen-types';
export * from './loading-screen-ui';
export * from './loading-screen-progress';
export { LoadingScreen as default } from './loading-screen-ui';
