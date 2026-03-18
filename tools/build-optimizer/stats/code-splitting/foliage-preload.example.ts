// Preload foliage when near loading completion
class FoliagePreloader {
  private foliageModule: any = null;
  
  preload() {
    // Start loading in background after core is ready
    if (document.readyState === 'complete') {
      this.doPreload();
    } else {
      window.addEventListener('load', () => this.doPreload());
    }
  }
  
  private async doPreload() {
    // Wait a bit for initial render
    await new Promise(r => setTimeout(r, 100));
    
    // Prefetch the chunk
    const link = document.createElement('link');
    link.rel = 'prefetch';
    link.as = 'script';
    link.href = '/chunks/foliage-[hash].js';
    document.head.appendChild(link);
    
    // Actually import when needed
    this.foliageModule = await import('./foliage/index.ts');
  }
  
  getFoliage() {
    return this.foliageModule;
  }
}

export const foliagePreloader = new FoliagePreloader();
