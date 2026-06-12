
export function getMemoryUsage(): number {
  if (typeof window !== 'undefined' && (window.performance as any)?.memory) {
    return (window.performance as any).memory.usedJSHeapSize;
  }
  return 0;
}

export function getMemoryTotal(): number {
  if (typeof window !== 'undefined' && (window.performance as any)?.memory) {
    return (window.performance as any).memory.totalJSHeapSize;
  }
  return 0;
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
