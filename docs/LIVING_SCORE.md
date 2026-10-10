# Living Score

Living Score is the system that triggers world events precisely in sync with the musical tracker row data from libopenmpt. Unlike continuous audio reactivity (which drives shaders directly via \`music-reactivity.ts\`), Living Score fires one-shot deterministic events on specific pattern rows.

## Architecture

The system avoids the overhead of traversing or querying the full visual matrix. Instead, edge-detection is performed in the `AudioWorklet` communication loop (\`src/audio/audio-system-playback.ts\`).

When the Audio System processes a visual update, it checks if \`(patternIndex, row)\` has advanced. If it has, it invokes \`onRowEdge\`, passing the \`order\`, \`row\`, and the current sticky \`channelData\`.

\`updateLivingScore\` (in \`src/systems/living-score.ts\`) processes this edge once per frame.

## Cues

Cues are defined in \`assets/score-cues.json\`. At runtime, they are loaded into pre-allocated struct arrays (SoA layout) to avoid object allocation during the hot \`update\` loop.

| id | biome | channel | match (instrument / note / rowMod) | event |
| --- | --- | --- | --- | --- |
| \`market.lantern_fill\` | \`night_market\` | 3 | instrument 12, rowMod 16 | \`lanternPhrase\` |
| \`grove.geyser\` | \`arpeggio_grove\` | 1 | note \`C-5\` | \`geyserBurst\` |
| \`cave.shimmer\` | \`sugar_caves\` | 2 | rowMod 8 | \`cavePulse\` |

## Target Systems

- **Night Market Lanterns**: \`lanternPhrase\` bumps the \`night_market\` shimmer uniform if it's night time (\`nightGate\`).
- **Arpeggio Grove Geysers**: \`geyserBurst\` triggers \`.triggerErupt()\` on the \`kickDrumGeyserBatcher\`.
- **Sugar Caves Shimmer**: \`cavePulse\` sets an envelope that decays locally in \`updateLivingScore\` to prevent conflicts with other bindings.
- **Fauna Impulse**: \`faunaImpulse\` calls \`.applyScoreImpulse()\` on the \`FaunaSystem\` to shove nearby dynamic bodies vertically.
- **Weather Bump**: \`weatherBump\` slightly increments the current weather intensity via \`getWeatherSystem()\`.

## Debugging

Enable the Living Score debug overlay by appending \`?debugScore=1\` to the URL. It displays:
- Current Order
- Current Row
- The last 8 fired cues.
