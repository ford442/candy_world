/**
 * Yields the main thread for a short duration to allow the browser to paint.
 * This is crucial for UI operations where an 'aria-busy' state or loading spinner
 * needs to be rendered *before* a heavy synchronous task (like saving/loading) begins.
 * @param ms - Duration to wait in milliseconds (defaults to 50ms)
 */
export function yieldToPaint(ms: number = 50): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}
