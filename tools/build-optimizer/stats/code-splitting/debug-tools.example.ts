// Development-only debug tools
let debugTools: any = null;

export async function loadDebugTools() {
  // Only load in development
  if (process.env.NODE_ENV === 'production') {
    return null;
  }
  
  if (debugTools) return debugTools;
  
  const { profiler, enableStartupProfiler } = await import('./utils/profiler.js');
  debugTools = { profiler, enableStartupProfiler };
  return debugTools;
}

// Usage
if (location.hash === '#debug') {
  loadDebugTools().then(tools => {
    tools?.enableStartupProfiler();
  });
}
