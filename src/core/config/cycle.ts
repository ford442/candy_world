// Cycle: Sunrise (1m), Day (7m), Sunset (1m), Night (7m) = Total 16m = 960s
export const DURATION_SUNRISE = 60;
export const DURATION_DAY = 420;
export const DURATION_SUNSET = 60;
export const DURATION_DUSK_NIGHT = 180; // 3 min
export const DURATION_DEEP_NIGHT = 120; // 2 min
export const DURATION_PRE_DAWN = 120; // 2 min
export const CYCLE_DURATION =
    DURATION_SUNRISE +
    DURATION_DAY +
    DURATION_SUNSET +
    DURATION_DUSK_NIGHT +
    DURATION_DEEP_NIGHT +
    DURATION_PRE_DAWN; // 960s
