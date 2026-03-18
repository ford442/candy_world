// Feature-based code splitting
const featureModules = {
  'weather': () => import('./systems/weather.ts'),
  'advanced-effects': () => import('./foliage/effects.ts'),
  'multiplayer': () => import('./systems/multiplayer.ts')
};

export async function loadFeature(feature: keyof typeof featureModules) {
  const loader = featureModules[feature];
  if (!loader) throw new Error(`Unknown feature: ${feature}`);
  return loader();
}

// Check user preferences and load accordingly
const userPrefs = JSON.parse(localStorage.getItem('prefs') || '{}');

if (userPrefs.enableWeather) {
  loadFeature('weather');
}

if (userPrefs.quality === 'high') {
  loadFeature('advanced-effects');
}
