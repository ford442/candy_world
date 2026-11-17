
/** Chromium's non-standard performance.memory. */
interface PerformanceMemory {
  usedJSHeapSize: number;
  totalJSHeapSize: number;
}

function performanceMemory(): PerformanceMemory | undefined {
  if (typeof window === 'undefined') return undefined;
  return (window.performance as Performance & { memory?: PerformanceMemory })?.memory;
}

export function getMemoryUsage(): number {
  return performanceMemory()?.usedJSHeapSize ?? 0;
}

export function getMemoryTotal(): number {
  return performanceMemory()?.totalJSHeapSize ?? 0;
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

export function formatDuration(ms: number): string {
  if (ms < 1) return ms.toFixed(2) + 'ms';
  if (ms < 1000) return ms.toFixed(0) + 'ms';
  return (ms / 1000).toFixed(2) + 's';
}
