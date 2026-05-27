/**
 * @file analytics-debug.ts
 * @brief Analytics Debug Overlay for Candy World
 * 
 * Provides an in-game debug view for analytics data.
 * Toggle with `/stats` command or call `toggleAnalyticsDebug()`.
 * 
 * This is a barrel file that exports the UI and handler implementations.
 */

export * from './analytics-debug-ui.ts';
export * from './analytics-debug-handlers.ts';
import { analyticsDebug } from './analytics-debug-handlers.ts';

export default analyticsDebug;
