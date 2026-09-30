/**
 * World-generation token: bumped at the start of every generation run so
 * background decorator tasks can tell they belong to a stale world and bail.
 *
 * Lives outside generation-core.ts because generation-decorators-procedural-extras.ts
 * reads it, and generation-core reaches that module (through decorator-streamer),
 * which closed an import cycle (#1827).
 */
let worldGenerationToken = 0;

export function getWorldGenerationToken(): number {
    return worldGenerationToken;
}

/** Start a new generation run; returns its token. */
export function bumpWorldGenerationToken(): number {
    worldGenerationToken = Date.now();
    return worldGenerationToken;
}
