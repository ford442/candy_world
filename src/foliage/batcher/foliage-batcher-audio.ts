// src/foliage/batcher/foliage-batcher-audio.ts
// Audio analysis helper functions for foliage batch processing

/**
 * Get vibrato amount from audio data
 * Effect code 1 = vibrato
 */
export function getVibratoAmount(audioData: any): number {
    if (!audioData?.channelData) return 0;
    let amount = 0;
    for (const ch of audioData.channelData) {
        if (ch.activeEffect === 1) {
            amount = Math.max(amount, ch.effectValue || 0);
        }
    }
    return amount;
}

/**
 * Get tremolo amount from audio data
 * Effect code 3 = tremolo
 */
export function getTremoloAmount(audioData: any): number {
    if (!audioData?.channelData) return 0;
    let amount = 0;
    for (const ch of audioData.channelData) {
        if (ch.activeEffect === 3) {
            amount = Math.max(amount, ch.effectValue || 0);
        }
    }
    // Also add beat-based pulse
    amount = Math.max(amount, Math.sin((audioData.beatPhase || 0) * Math.PI * 2) * 0.3);
    return amount;
}

/**
 * Get high frequency amount (channels 3 and 4 volume)
 */
export function getHighFreqAmount(audioData: any): number {
    if (!audioData?.channelData) return 0;
    const ch3 = audioData.channelData[3]?.volume || 0;
    const ch4 = audioData.channelData[4]?.volume || 0;
    return Math.max(ch3, ch4);
}

/**
 * Get average volume across all channels
 */
export function getAverageVolume(audioData: any): number {
    if (!audioData?.channelData) return 1.0;
    let sum = 0;
    for (const ch of audioData.channelData) {
        sum += ch.volume || 0;
    }
    return sum / 4.0;
}

/**
 * Get pan activity (volume weighted by pan amount)
 */
export function getPanActivity(audioData: any): number {
    if (!audioData?.channelData) return 0;
    let activity = 0;
    for (const ch of audioData.channelData) {
        const vol = ch.volume || 0;
        const pan = ch.pan || 0;
        activity += vol * Math.abs(pan);
    }
    return activity;
}
