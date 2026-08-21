const fs = require('fs');
let content = fs.readFileSync('src/systems/music-reactivity.ts', 'utf8');

const search = `            MRState.globalShimmerAccum = 0.0;
            MRState.globalHueShiftAccum = 0.0;
            MRState.gemCanopyShimmerAccum = 0.0;
            MRState.gemCanopyHueShiftAccum = 0.0;
            MRState.skyIslandsShimmerAccum = 0.0;
            MRState.skyIslandsHueShiftAccum = 0.0;
            MRState.skyIslandsFogAccum = 0.0;
            MRState.sugarCavesShimmerAccum = 0.0;
            MRState.sugarCavesHueShiftAccum = 0.0;
            MRState.nebulaShimmerAccum = 0.0;
            MRState.nebulaAmplitudeAccum = 0.0;

            for (let i = 0; i < channels.length; i++) {
                const vol = channels[i].volume;
                if (vol <= 0) continue;

                if (MRState.globalShimmerCh.includes(i)) MRState.globalShimmerAccum += vol;
                if (MRState.globalHueShiftCh.includes(i)) MRState.globalHueShiftAccum += vol;

                if (MRState.gemCanopyShimmerCh.includes(i)) MRState.gemCanopyShimmerAccum += vol;
                if (MRState.gemCanopyHueShiftCh.includes(i)) MRState.gemCanopyHueShiftAccum += vol;

                if (MRState.skyIslandsShimmerCh.includes(i)) MRState.skyIslandsShimmerAccum += vol;
                if (MRState.skyIslandsHueShiftCh.includes(i))
                    MRState.skyIslandsHueShiftAccum += vol;
                if (MRState.skyIslandsFogCh.includes(i)) MRState.skyIslandsFogAccum += vol;

                if (MRState.sugarCavesShimmerCh.includes(i)) MRState.sugarCavesShimmerAccum += vol;
                if (MRState.sugarCavesHueShiftCh.includes(i))
                    MRState.sugarCavesHueShiftAccum += vol;

                if (MRState.nebulaShimmerCh.includes(i)) MRState.nebulaShimmerAccum += vol;
                if (MRState.nebulaAmplitudeCh.includes(i)) MRState.nebulaAmplitudeAccum += vol;
            }`;

const replace = `            // --- Global: shimmer ---
            MRState.globalShimmerAccum = 0.0;
            for (let i = 0; i < MRState.globalShimmerCh.length; i++) {
                const idx = MRState.globalShimmerCh[i];
                if (idx < channels.length) MRState.globalShimmerAccum += channels[idx].volume;
            }

            // --- Global: hue shift ---
            MRState.globalHueShiftAccum = 0.0;
            for (let i = 0; i < MRState.globalHueShiftCh.length; i++) {
                const idx = MRState.globalHueShiftCh[i];
                if (idx < channels.length) MRState.globalHueShiftAccum += channels[idx].volume;
            }

            // --- Gem Canopy: shimmer ---
            MRState.gemCanopyShimmerAccum = 0.0;
            for (let i = 0; i < MRState.gemCanopyShimmerCh.length; i++) {
                const idx = MRState.gemCanopyShimmerCh[i];
                if (idx < channels.length) MRState.gemCanopyShimmerAccum += channels[idx].volume;
            }

            // --- Gem Canopy: hue shift (note-hit twist driver) ---
            MRState.gemCanopyHueShiftAccum = 0.0;
            for (let i = 0; i < MRState.gemCanopyHueShiftCh.length; i++) {
                const idx = MRState.gemCanopyHueShiftCh[i];
                if (idx < channels.length) MRState.gemCanopyHueShiftAccum += channels[idx].volume;
            }

            // --- Sky Islands: shimmer ---
            MRState.skyIslandsShimmerAccum = 0.0;
            for (let i = 0; i < MRState.skyIslandsShimmerCh.length; i++) {
                const idx = MRState.skyIslandsShimmerCh[i];
                if (idx < channels.length) MRState.skyIslandsShimmerAccum += channels[idx].volume;
            }

            // --- Sky Islands: hue shift ---
            MRState.skyIslandsHueShiftAccum = 0.0;
            for (let i = 0; i < MRState.skyIslandsHueShiftCh.length; i++) {
                const idx = MRState.skyIslandsHueShiftCh[i];
                if (idx < channels.length) MRState.skyIslandsHueShiftAccum += channels[idx].volume;
            }

            // --- Sky Islands: fog density ---
            MRState.skyIslandsFogAccum = 0.0;
            for (let i = 0; i < MRState.skyIslandsFogCh.length; i++) {
                const idx = MRState.skyIslandsFogCh[i];
                if (idx < channels.length) MRState.skyIslandsFogAccum += channels[idx].volume;
            }

            // --- Sugar Caves: shimmer + hue shift ---
            MRState.sugarCavesShimmerAccum = 0.0;
            for (let i = 0; i < MRState.sugarCavesShimmerCh.length; i++) {
                const idx = MRState.sugarCavesShimmerCh[i];
                if (idx < channels.length) MRState.sugarCavesShimmerAccum += channels[idx].volume;
            }
            MRState.sugarCavesHueShiftAccum = 0.0;
            for (let i = 0; i < MRState.sugarCavesHueShiftCh.length; i++) {
                const idx = MRState.sugarCavesHueShiftCh[i];
                if (idx < channels.length) MRState.sugarCavesHueShiftAccum += channels[idx].volume;
            }

            // --- Crystalline Nebula: shimmer ---
            MRState.nebulaShimmerAccum = 0.0;
            for (let i = 0; i < MRState.nebulaShimmerCh.length; i++) {
                const idx = MRState.nebulaShimmerCh[i];
                if (idx < channels.length) MRState.nebulaShimmerAccum += channels[idx].volume;
            }

            // --- Crystalline Nebula: amplitude scale ---
            MRState.nebulaAmplitudeAccum = 0.0;
            for (let i = 0; i < MRState.nebulaAmplitudeCh.length; i++) {
                const idx = MRState.nebulaAmplitudeCh[i];
                if (idx < channels.length) MRState.nebulaAmplitudeAccum += channels[idx].volume;
            }`;

if (content.includes(search)) {
    content = content.replace(search, replace);
    content = content.replace("        // ⚡ OPTIMIZATION: Single pass over audio channels for volume accumulations\n", "");
    fs.writeFileSync('src/systems/music-reactivity.ts', content, 'utf8');
    console.log("Successfully reverted music reactivity accumulation arrays");
} else {
    console.log("Could not find music reactivity accumulation arrays search block to revert");
}
