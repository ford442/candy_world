// src/systems/weather.ts
// Compatibility re-export - weather system has been refactored into the weather/ directory
// @deprecated Import from './weather/' instead
//
// Value exports must NOT re-export from ./weather/index.ts — that creates an app ↔ weather
// Rollup chunk cycle (undefined live bindings). Use weather/lazy.ts for runtime loading.

export { WeatherState } from './weather-types.ts';
export type { WeatherSystem } from './weather/weather.ts';
