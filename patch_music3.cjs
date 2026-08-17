const fs = require('fs');
const content = fs.readFileSync('src/systems/music-reactivity.ts', 'utf8');

const search = `        MRState.skyMoonIntensityAccum = 0.0;
        MRState.skyMoonNoteVal = 0;
        MRState.arpeggioNoteVal = 0;
        MRState.nebulaNoteVal = 0;
        MRState.gemCanopyNoteVal = 0;
        MRState.skyIslandsNoteVal = 0;
        MRState.sugarCavesNoteVal = 0;
        MRState.globalNoteVal = 0;

        // ⚡ OPTIMIZATION: Single pass over audio channels for note colors and sky intensity
        for (let i = 0; i < channels.length; i++) {
            const ch = channels[i];
            if (MRState.skyMoonIntensityCh.includes(i)) {
                MRState.skyMoonIntensityAccum += ch.volume;
            }

            if (ch.volume > 0.05) {
                const noteVal = parseInt(ch.note) || 0;

                if (MRState.skyMoonNoteVal === 0 && MRState.skyMoonNoteColorCh.includes(i)) {
                    MRState.skyMoonNoteVal = noteVal;
                }
                if (MRState.arpeggioNoteVal === 0 && MRState.arpeggioNoteColorCh.includes(i)) {
                    MRState.arpeggioNoteVal = noteVal;
                }
                if (MRState.nebulaNoteVal === 0 && MRState.nebulaNoteColorCh.includes(i)) {
                    MRState.nebulaNoteVal = noteVal;
                }
                if (MRState.globalNoteVal === 0 && MRState.globalNoteColorCh.includes(i)) {
                    MRState.globalNoteVal = noteVal;
                }
                if (MRState.gemCanopyNoteVal === 0 && MRState.gemCanopyNoteColorCh.includes(i)) {
                    MRState.gemCanopyNoteVal = noteVal;
                }
                if (MRState.skyIslandsNoteVal === 0 && MRState.skyIslandsNoteColorCh.includes(i)) {
                    MRState.skyIslandsNoteVal = noteVal;
                }
                if (MRState.sugarCavesNoteVal === 0 && MRState.sugarCavesNoteColorCh.includes(i)) {
                    MRState.sugarCavesNoteVal = noteVal;
                }
            }
        }`;

const replace = `        MRState.skyMoonIntensityAccum = 0.0;
        MRState.skyMoonNoteVal = 0;
        MRState.arpeggioNoteVal = 0;
        MRState.nebulaNoteVal = 0;
        MRState.gemCanopyNoteVal = 0;
        MRState.skyIslandsNoteVal = 0;
        MRState.sugarCavesNoteVal = 0;

        // Read Intensity
        for (let i = 0; i < MRState.skyMoonIntensityCh.length; i++) {
            const idx = MRState.skyMoonIntensityCh[i];
            if (idx < channels.length) MRState.skyMoonIntensityAccum += channels[idx].volume;
        }
        // Read Note Color (use first matching channel that has volume)
        for (let i = 0; i < MRState.skyMoonNoteColorCh.length; i++) {
            const idx = MRState.skyMoonNoteColorCh[i];
            if (idx < channels.length && channels[idx].volume > 0.05) {
                MRState.skyMoonNoteVal = parseInt(channels[idx].note) || 0; // Assume .note exists on the channel data
                break;
            }
        }
        // Read Arpeggio Note Color
        for (let i = 0; i < MRState.arpeggioNoteColorCh.length; i++) {
            const idx = MRState.arpeggioNoteColorCh[i];
            if (idx < channels.length && channels[idx].volume > 0.05) {
                MRState.arpeggioNoteVal = parseInt(channels[idx].note) || 0;
                break;
            }
        }
        // Read Nebula Note Color
        for (let i = 0; i < MRState.nebulaNoteColorCh.length; i++) {
            const idx = MRState.nebulaNoteColorCh[i];
            if (idx < channels.length && channels[idx].volume > 0.05) {
                MRState.nebulaNoteVal = parseInt(channels[idx].note) || 0;
                break;
            }
        }

        // Read Global Note Color
        for (let i = 0; i < MRState.globalNoteColorCh.length; i++) {
            const idx = MRState.globalNoteColorCh[i];
            if (idx < channels.length && channels[idx].volume > 0.05) {
                MRState.globalNoteVal = parseInt(channels[idx].note) || 0;
                break;
            }
        }

        // Read Gem Canopy Note Color
        for (let i = 0; i < MRState.gemCanopyNoteColorCh.length; i++) {
            const idx = MRState.gemCanopyNoteColorCh[i];
            if (idx < channels.length && channels[idx].volume > 0.05) {
                MRState.gemCanopyNoteVal = parseInt(channels[idx].note) || 0;
                break;
            }
        }

        // Read Sky Islands Note Color
        for (let i = 0; i < MRState.skyIslandsNoteColorCh.length; i++) {
            const idx = MRState.skyIslandsNoteColorCh[i];
            if (idx < channels.length && channels[idx].volume > 0.05) {
                MRState.skyIslandsNoteVal = parseInt(channels[idx].note) || 0;
                break;
            }
        }

        for (let i = 0; i < MRState.sugarCavesNoteColorCh.length; i++) {
            const idx = MRState.sugarCavesNoteColorCh[i];
            if (idx < channels.length && channels[idx].volume > 0.05) {
                MRState.sugarCavesNoteVal = parseInt(channels[idx].note) || 0;
                break;
            }
        }`;

if (content.includes(search)) {
    const newContent = content.replace(search, replace);
    fs.writeFileSync('src/systems/music-reactivity.ts', newContent, 'utf8');
    console.log("Successfully reverted music reactivity note colors priority");
} else {
    console.log("Could not find music reactivity note colors priority search block to revert");
}
