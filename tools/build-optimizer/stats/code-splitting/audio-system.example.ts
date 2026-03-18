// Dynamic audio system loading
class LazyAudioSystem {
  private audioSystem: any = null;
  private loading: Promise<any> | null = null;
  
  async init() {
    if (this.audioSystem) return this.audioSystem;
    if (this.loading) return this.loading;
    
    this.loading = import('./audio/audio-system.ts')
      .then(({ AudioSystem }) => {
        this.audioSystem = new AudioSystem();
        return this.audioSystem;
      });
    
    return this.loading;
  }
  
  async playSound(sound: string) {
    const audio = await this.init();
    return audio.play(sound);
  }
}

export const lazyAudio = new LazyAudioSystem();

// Usage - loads only when needed
button.addEventListener('click', () => {
  lazyAudio.playSound('click');
});
