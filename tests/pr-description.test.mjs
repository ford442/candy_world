import assert from 'node:assert/strict';
import { checkDescription } from '../scripts/check-pr-description.mjs';

const body946 = 'Adds a `plumeDirty` flag in `kick-drum-geyser-batcher.ts` so the update loop skips clean plumes.';
const body960 = 'Breaks cycles: see src/ui/loading-screen-ui.ts and src/systems/weather/weather-atmosphere.ts.';

// Stale-base junk: described change is absent from the diff.
assert.equal(
    checkDescription({ body: body946, files: ['src/core/main/scene-pipeline.ts'], diffText: '+catch (e) {}' }).ok,
    false
);
assert.equal(checkDescription({ body: body960, files: ['scripts/eslint-baseline.json'], diffText: '' }).ok, false);
// Matching file by basename or full path.
assert.ok(checkDescription({ body: body946, files: ['src/foliage/kick-drum-geyser-batcher.ts'], diffText: '' }).ok);
assert.ok(checkDescription({ body: body960, files: ['src/ui/loading-screen-ui.ts'], diffText: '' }).ok);
// Identifier in the diff alone is enough.
assert.ok(checkDescription({ body: body946, files: ['x.ts'], diffText: '+this.plumeDirty = true' }).ok);
// Nothing checkable passes.
assert.ok(checkDescription({ body: 'misc cleanup', files: ['a.ts'], diffText: '' }).ok);
console.log('pr-description tests passed');
