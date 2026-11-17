// =============================================================================
// Garden DSP: the polyphonic synth engine behind the garden AudioWorklet.
// =============================================================================
//
// This is its own small module (candy_dsp.wasm), separate from candy_native:
// it is single-threaded (no pthreads, no shared memory, no OpenMP) and has no
// JS glue and no imports, so AudioWorkletGlobalScope can instantiate it from
// the bytes the main thread posts. Build: emscripten/dsp/build.sh. Flags and
// the ABI contract: AGENTS.md ("Garden DSP module") and docs/MUSIC_GARDEN.md.
//
// Every buffer is static (no malloc, no memory growth), so the views the
// worklet makes over memory.buffer never detach.
//
// Signal flow, per 128-frame render quantum:
//
//   note events (absolute frames) -> voice allocation
//   voice: oscillator (wavetable | 2-op FM | kick | noise) -> SVF -> x env -> pan
//          -> duck bus (default) or free bus (duck sources / bypass)
//          -> mono reverb send
//   reverb (Freeverb, 8 comb + 4 allpass per side) -> duck bus
//   out = (duck bus * duck gain + free bus) * master -> soft clip
//
// Block-level work (clears, multiply-accumulate into the buses, the duck and
// master stage, the soft clip) is SIMD over the quantum (wasm_simd128.h). The
// recursive parts (oscillator phase, envelope, SVF state) are scalar per voice.
//
// Denormals: wasm has no flush-to-zero mode, and a denormal on x86 costs ~100x.
// Voices are killed at -80 dB, so no voice state decays to zero; the decaying
// side-chains (FM index, kick pitch, duck) flush below 1e-6; the reverb input
// carries a 1e-18 DC offset that keeps every comb and allpass state normal.
// dsp_scan_denormals() counts denormal floats in all state (tests only).

#include <math.h>
#include <stdint.h>
#include <string.h>

#ifdef __wasm_simd128__
#include <wasm_simd128.h>
#endif

#ifdef __EMSCRIPTEN__
#include <emscripten/emscripten.h>
#else
#define EMSCRIPTEN_KEEPALIVE
#endif

namespace {

// -----------------------------------------------------------------------------
// Constants (mirrored in src/audio/worklet/dsp-abi.ts; tests/dsp-render.test.mjs
// checks the mirror through dsp_get_patch / dsp_quantum / dsp_max_voices)
// -----------------------------------------------------------------------------

constexpr int QUANTUM = 128;
constexpr int SUB_BLOCK = 16;  // filter coefficients are updated per sub-block
constexpr int MAX_VOICES = 64;
constexpr int MAX_PATCHES = 32;
constexpr int MAX_EVENTS = 1024;
constexpr int MAX_DUE = 256;  // events applied per quantum; the rest wait one quantum

constexpr int TABLE_SIZE = 2048;
constexpr int TABLE_MASK = TABLE_SIZE - 1;
constexpr int TABLE_LEVELS = 10;  // level k holds 512 >> k harmonics
constexpr int TOP_HARMONICS = 512;

constexpr float PI = 3.14159265358979f;
constexpr float LN_1000 = 6.90775527898f;  // envelope times are T60 (-60 dB)
constexpr float VOICE_OFF_LEVEL = 1e-4f;   // -80 dB
constexpr float FLUSH_LEVEL = 1e-6f;
constexpr float ANTI_DENORMAL = 1e-18f;

enum Wave { W_SINE = 0, W_TRIANGLE, W_SAW, W_SQUARE, W_GLASS, W_ORGAN, W_COUNT };

enum Engine { E_WAVETABLE = 0, E_FM, E_KICK, E_NOISE };

enum FilterMode { F_OFF = 0, F_LOWPASS, F_BANDPASS, F_HIGHPASS };

enum DuckMode { DUCK_DUCKED = 0, DUCK_SOURCE, DUCK_BYPASS };

enum PatchParam {
    P_ENGINE = 0,
    P_WAVE,
    P_GAIN,
    P_ATTACK,
    P_DECAY,
    P_SUSTAIN,
    P_RELEASE,
    P_FILTER_MODE,
    P_CUTOFF,
    P_RESONANCE,
    P_FILTER_ENV,
    P_KEY_TRACK,
    P_DETUNE,
    P_OSC2_MIX,
    P_FM_RATIO,
    P_FM_INDEX,
    P_FM_DECAY,
    P_PITCH_START,
    P_PITCH_DECAY,
    P_REVERB_SEND,
    P_DUCK,
    P_COUNT
};

enum GlobalParam {
    G_MASTER_GAIN = 0,
    G_REVERB_ROOM,
    G_REVERB_DAMP,
    G_REVERB_WET,
    G_DUCK_DEPTH,
    G_DUCK_RELEASE,
    G_BRIGHTNESS,
    G_COUNT
};

enum EventType { EV_NOTE_ON = 1, EV_NOTE_OFF, EV_DUCK };

enum Stage { S_OFF = 0, S_ATTACK, S_DECAY, S_SUSTAIN, S_RELEASE };

// -----------------------------------------------------------------------------
// State (all static)
// -----------------------------------------------------------------------------

struct Voice {
    int stage;
    int patch;
    int tag;
    int engine;
    int filterMode;
    int duckMode;
    int delay;      // frames of this quantum before the voice starts
    int releaseIn;  // frames until release (-1: hold until note-off)
    uint32_t age;
    uint32_t noise;

    float env;
    float attackInc;
    float decayCoef;
    float sustain;
    float releaseCoef;

    float phase, inc;
    float phase2, inc2, osc2Mix;
    float modPhase, modInc, fmIndex, fmEnv, fmCoef;
    float pitchEnv, pitchCoef, pitchDepth;

    float gain, gl, gr, send;
    float cutoff, filterEnvOct, k;
    float ic1, ic2;

    const float* table;
};

struct Event {
    double frame;
    int type;
    int patch;
    int tag;
    float note;
    float velocity;
    float duration;
    float pan;
};

struct Comb {
    float* buf;
    int size;
    int idx;
    float store;
};

struct Allpass {
    float* buf;
    int size;
    int idx;
};

constexpr int COMB_COUNT = 8;
constexpr int ALLPASS_COUNT = 4;
constexpr int STEREO_SPREAD = 23;
// Freeverb tunings at 44.1 kHz; scaled by the sample rate, buffers sized for 96 kHz.
constexpr int COMB_TUNING[COMB_COUNT] = {1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617};
constexpr int ALLPASS_TUNING[ALLPASS_COUNT] = {556, 441, 341, 225};
constexpr int COMB_CAP = 3584;
constexpr int ALLPASS_CAP = 1280;

float g_tables[W_COUNT][TABLE_LEVELS][TABLE_SIZE + 1];
float g_sine[TABLE_SIZE + 1];  // alias of the sine wave's level 0 (FM, kick)

float g_patches[MAX_PATCHES][P_COUNT];
float g_globals[G_COUNT];

Voice g_voices[MAX_VOICES];
Event g_events[MAX_EVENTS];
int g_eventCount = 0;
uint32_t g_noteCounter = 0;
int g_droppedEvents = 0;

float g_combBuf[2][COMB_COUNT][COMB_CAP];
float g_allpassBuf[2][ALLPASS_COUNT][ALLPASS_CAP];
Comb g_combs[2][COMB_COUNT];
Allpass g_allpasses[2][ALLPASS_COUNT];
float g_combFeedback = 0.84f;
float g_combDamp = 0.2f;

float g_duckEnv = 0.0f;
float g_duckTarget = 0.0f;
int g_duckHold = 0;
float g_duckAttackCoef = 0.0f;
float g_duckReleaseCoef = 0.0f;

float g_sampleRate = 0.0f;
bool g_ready = false;

alignas(16) float g_outL[QUANTUM];
alignas(16) float g_outR[QUANTUM];
alignas(16) float g_duckL[QUANTUM];
alignas(16) float g_duckR[QUANTUM];
alignas(16) float g_freeL[QUANTUM];
alignas(16) float g_freeR[QUANTUM];
alignas(16) float g_revIn[QUANTUM];
alignas(16) float g_duckTrig[QUANTUM];
alignas(16) float g_duckGain[QUANTUM];
alignas(16) float g_scratch[QUANTUM];
alignas(16) float g_envBuf[QUANTUM];

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

inline float clampf(float x, float lo, float hi) { return x < lo ? lo : (x > hi ? hi : x); }

inline bool isFiniteF(float x) { return x == x && x - x == 0.0f; }

/** One-pole coefficient that decays by 60 dB over `seconds`. */
inline float t60Coef(float seconds) {
    const float frames = fmaxf(seconds, 1e-4f) * g_sampleRate;
    return expf(-LN_1000 / frames);
}

inline float midiToHz(float note) { return 440.0f * exp2f((note - 69.0f) / 12.0f); }

inline float readTable(const float* t, float phase) {
    const float x = phase * TABLE_SIZE;
    const int i = (int)x;
    const float f = x - (float)i;
    const float a = t[i & TABLE_MASK];
    return a + (t[(i & TABLE_MASK) + 1] - a) * f;
}

inline float wrap01(float p) { return p - floorf(p); }

/** Mip level for a phase increment: the most harmonics that stay below Nyquist. */
inline int tableLevel(float inc) {
    int level = 0;
    float harmonics = (float)TOP_HARMONICS;
    while (level < TABLE_LEVELS - 1 && harmonics * inc > 0.5f) {
        harmonics *= 0.5f;
        level++;
    }
    return level;
}

inline bool isDenormal(float x) {
    const float a = fabsf(x);
    return a != 0.0f && a < 1.17549435e-38f;
}

// --- SIMD block helpers ------------------------------------------------------

inline void clearBlock(float* dst) {
#ifdef __wasm_simd128__
    const v128_t z = wasm_f32x4_splat(0.0f);
    for (int i = 0; i < QUANTUM; i += 4) wasm_v128_store(dst + i, z);
#else
    memset(dst, 0, sizeof(float) * QUANTUM);
#endif
}

/** x[i] *= env[i] * gain, then L += x*gl, R += x*gr, S += x*gs (from `start`). */
inline void mixVoice(const float* __restrict x, const float* __restrict env, float gain, float gl,
                     float gr, float gs, float* __restrict L, float* __restrict R,
                     float* __restrict S, int start) {
    int i = start;
    // Scalar head up to the first 4-aligned index.
    for (; i < QUANTUM && (i & 3); i++) {
        const float v = x[i] * env[i] * gain;
        L[i] += v * gl;
        R[i] += v * gr;
        S[i] += v * gs;
    }
#ifdef __wasm_simd128__
    const v128_t vg = wasm_f32x4_splat(gain);
    const v128_t vl = wasm_f32x4_splat(gl);
    const v128_t vr = wasm_f32x4_splat(gr);
    const v128_t vs = wasm_f32x4_splat(gs);
    for (; i < QUANTUM; i += 4) {
        const v128_t v = wasm_f32x4_mul(wasm_f32x4_mul(wasm_v128_load(x + i), wasm_v128_load(env + i)), vg);
        wasm_v128_store(L + i, wasm_f32x4_add(wasm_v128_load(L + i), wasm_f32x4_mul(v, vl)));
        wasm_v128_store(R + i, wasm_f32x4_add(wasm_v128_load(R + i), wasm_f32x4_mul(v, vr)));
        wasm_v128_store(S + i, wasm_f32x4_add(wasm_v128_load(S + i), wasm_f32x4_mul(v, vs)));
    }
#else
    for (; i < QUANTUM; i++) {
        const float v = x[i] * env[i] * gain;
        L[i] += v * gl;
        R[i] += v * gr;
        S[i] += v * gs;
    }
#endif
}

/** out = clip((duck * duckGain + free) * master), per channel. */
inline void masterStage(float master) {
#ifdef __wasm_simd128__
    const v128_t vm = wasm_f32x4_splat(master);
    const v128_t c27 = wasm_f32x4_splat(27.0f);
    const v128_t c9 = wasm_f32x4_splat(9.0f);
    const v128_t one = wasm_f32x4_splat(1.0f);
    const v128_t neg = wasm_f32x4_splat(-1.0f);
    const v128_t lim = wasm_f32x4_splat(3.0f);
    const v128_t nlim = wasm_f32x4_splat(-3.0f);
    float* outs[2] = {g_outL, g_outR};
    const float* ducks[2] = {g_duckL, g_duckR};
    const float* frees[2] = {g_freeL, g_freeR};
    for (int c = 0; c < 2; c++) {
        for (int i = 0; i < QUANTUM; i += 4) {
            v128_t x = wasm_f32x4_add(wasm_f32x4_mul(wasm_v128_load(ducks[c] + i), wasm_v128_load(g_duckGain + i)),
                                      wasm_v128_load(frees[c] + i));
            x = wasm_f32x4_mul(x, vm);
            x = wasm_v128_and(x, wasm_f32x4_eq(x, x));  // NaN -> 0
            x = wasm_f32x4_pmax(nlim, wasm_f32x4_pmin(lim, x));
            // tanh-like rational soft clip, exact 1.0 at |x| = 3
            const v128_t x2 = wasm_f32x4_mul(x, x);
            v128_t y = wasm_f32x4_div(wasm_f32x4_mul(x, wasm_f32x4_add(c27, x2)),
                                      wasm_f32x4_add(c27, wasm_f32x4_mul(c9, x2)));
            y = wasm_f32x4_pmax(neg, wasm_f32x4_pmin(one, y));
            wasm_v128_store(outs[c] + i, y);
        }
    }
#else
    float* outs[2] = {g_outL, g_outR};
    const float* ducks[2] = {g_duckL, g_duckR};
    const float* frees[2] = {g_freeL, g_freeR};
    for (int c = 0; c < 2; c++) {
        for (int i = 0; i < QUANTUM; i++) {
            float x = (ducks[c][i] * g_duckGain[i] + frees[c][i]) * master;
            x = x != x ? 0.0f : clampf(x, -3.0f, 3.0f);
            const float x2 = x * x;
            outs[c][i] = clampf(x * (27.0f + x2) / (27.0f + 9.0f * x2), -1.0f, 1.0f);
        }
    }
#endif
}

// -----------------------------------------------------------------------------
// Wavetables
// -----------------------------------------------------------------------------

double harmonicAmp(int wave, int h) {
    switch (wave) {
        case W_SINE:
            return h == 1 ? 1.0 : 0.0;
        case W_TRIANGLE:
            if ((h & 1) == 0) return 0.0;
            return (((h - 1) / 2) & 1 ? -1.0 : 1.0) / ((double)h * (double)h);
        case W_SAW:
            return (h & 1 ? 1.0 : -1.0) / (double)h;
        case W_SQUARE:
            return (h & 1) ? 1.0 / (double)h : 0.0;
        case W_GLASS:
            // Bright, bell-ish: falling partials, even ones at half weight.
            if (h > 24) return 0.0;
            return ((h & 1) ? 1.0 : 0.5) / pow((double)h, 1.6);
        case W_ORGAN: {
            // Drawbar-style registration.
            switch (h) {
                case 1: return 1.0;
                case 2: return 0.7;
                case 3: return 0.5;
                case 4: return 0.35;
                case 6: return 0.25;
                case 8: return 0.2;
                case 10: return 0.12;
                case 12: return 0.1;
                default: return 0.0;
            }
        }
        default:
            return 0.0;
    }
}

void buildTables() {
    static double sinT[TABLE_SIZE];
    static double acc[TABLE_SIZE];
    const double twoPi = 6.283185307179586476925;
    for (int i = 0; i < TABLE_SIZE; i++) sinT[i] = sin(twoPi * (double)i / TABLE_SIZE);

    for (int w = 0; w < W_COUNT; w++) {
        memset(acc, 0, sizeof(acc));
        int built = 0;  // harmonics already summed into acc
        // Top level (fewest harmonics) first; each lower level adds the next octave of partials.
        for (int level = TABLE_LEVELS - 1; level >= 0; level--) {
            const int harmonics = TOP_HARMONICS >> level;
            for (int h = built + 1; h <= harmonics; h++) {
                const double a = harmonicAmp(w, h);
                if (a == 0.0) continue;
                for (int i = 0; i < TABLE_SIZE; i++) acc[i] += a * sinT[(h * i) & TABLE_MASK];
            }
            built = harmonics;
            for (int i = 0; i < TABLE_SIZE; i++) g_tables[w][level][i] = (float)acc[i];
        }
        // One gain per wave (from its richest level), so levels match in loudness.
        float peak = 0.0f;
        for (int i = 0; i < TABLE_SIZE; i++) peak = fmaxf(peak, fabsf(g_tables[w][0][i]));
        const float norm = peak > 0.0f ? 1.0f / peak : 1.0f;
        for (int level = 0; level < TABLE_LEVELS; level++) {
            float* t = g_tables[w][level];
            for (int i = 0; i < TABLE_SIZE; i++) t[i] *= norm;
            t[TABLE_SIZE] = t[0];  // guard sample for interpolation
        }
    }
    memcpy(g_sine, g_tables[W_SINE][0], sizeof(g_sine));
}

// -----------------------------------------------------------------------------
// Reverb
// -----------------------------------------------------------------------------

void initReverb() {
    const float scale = g_sampleRate / 44100.0f;
    for (int c = 0; c < 2; c++) {
        const int spread = c == 0 ? 0 : STEREO_SPREAD;
        for (int i = 0; i < COMB_COUNT; i++) {
            Comb& cb = g_combs[c][i];
            cb.buf = g_combBuf[c][i];
            cb.size = (int)clampf((float)(COMB_TUNING[i] + spread) * scale, 16.0f, (float)COMB_CAP);
            cb.idx = 0;
            cb.store = 0.0f;
            memset(cb.buf, 0, sizeof(float) * COMB_CAP);
        }
        for (int i = 0; i < ALLPASS_COUNT; i++) {
            Allpass& ap = g_allpasses[c][i];
            ap.buf = g_allpassBuf[c][i];
            ap.size = (int)clampf((float)(ALLPASS_TUNING[i] + spread) * scale, 8.0f, (float)ALLPASS_CAP);
            ap.idx = 0;
            memset(ap.buf, 0, sizeof(float) * ALLPASS_CAP);
        }
    }
}

void updateReverbParams() {
    g_combFeedback = 0.7f + 0.28f * clampf(g_globals[G_REVERB_ROOM], 0.0f, 1.0f);
    g_combDamp = 0.4f * clampf(g_globals[G_REVERB_DAMP], 0.0f, 1.0f);
}

/** Adds the reverb of g_revIn into the duck bus. */
void processReverb() {
    const float wet = clampf(g_globals[G_REVERB_WET], 0.0f, 1.0f) * 3.0f;  // Freeverb's scaleWet
    if (wet <= 0.0f) return;
    const float fb = g_combFeedback;
    const float damp = g_combDamp;
    const float damp1 = 1.0f - damp;
    float* outs[2] = {g_duckL, g_duckR};
    for (int c = 0; c < 2; c++) {
        Comb* combs = g_combs[c];
        Allpass* aps = g_allpasses[c];
        float* out = outs[c];
        for (int i = 0; i < QUANTUM; i++) {
            const float input = g_revIn[i] * 0.015f + ANTI_DENORMAL;  // Freeverb's fixedGain
            float acc = 0.0f;
            for (int k = 0; k < COMB_COUNT; k++) {
                Comb& cb = combs[k];
                const float y = cb.buf[cb.idx];
                cb.store = y * damp1 + cb.store * damp;
                cb.buf[cb.idx] = input + cb.store * fb;
                if (++cb.idx >= cb.size) cb.idx = 0;
                acc += y;
            }
            for (int k = 0; k < ALLPASS_COUNT; k++) {
                Allpass& ap = aps[k];
                const float b = ap.buf[ap.idx];
                ap.buf[ap.idx] = acc + b * 0.5f;
                if (++ap.idx >= ap.size) ap.idx = 0;
                acc = b - acc;
            }
            out[i] += acc * wet;
        }
    }
}

// -----------------------------------------------------------------------------
// Patches and voices
// -----------------------------------------------------------------------------

void setPatchDefaults(float* p) {
    p[P_ENGINE] = E_WAVETABLE;
    p[P_WAVE] = W_SINE;
    p[P_GAIN] = 0.3f;
    p[P_ATTACK] = 0.005f;
    p[P_DECAY] = 0.3f;
    p[P_SUSTAIN] = 0.7f;
    p[P_RELEASE] = 0.2f;
    p[P_FILTER_MODE] = F_OFF;
    p[P_CUTOFF] = 8000.0f;
    p[P_RESONANCE] = 0.1f;
    p[P_FILTER_ENV] = 0.0f;
    p[P_KEY_TRACK] = 0.0f;
    p[P_DETUNE] = 0.0f;
    p[P_OSC2_MIX] = 0.0f;
    p[P_FM_RATIO] = 2.0f;
    p[P_FM_INDEX] = 0.0f;
    p[P_FM_DECAY] = 0.5f;
    p[P_PITCH_START] = 1.0f;
    p[P_PITCH_DECAY] = 0.1f;
    p[P_REVERB_SEND] = 0.2f;
    p[P_DUCK] = DUCK_DUCKED;
}

void setGlobalDefaults() {
    g_globals[G_MASTER_GAIN] = 0.8f;
    g_globals[G_REVERB_ROOM] = 0.5f;
    g_globals[G_REVERB_DAMP] = 0.5f;
    g_globals[G_REVERB_WET] = 0.25f;
    g_globals[G_DUCK_DEPTH] = 0.0f;
    g_globals[G_DUCK_RELEASE] = 0.18f;
    g_globals[G_BRIGHTNESS] = 0.0f;
}

void resetVoice(Voice& v) {
    memset(&v, 0, sizeof(Voice));
    v.stage = S_OFF;
    v.releaseIn = -1;
    v.table = g_sine;
}

Voice* allocVoice() {
    Voice* oldestRelease = nullptr;
    Voice* oldest = nullptr;
    for (int i = 0; i < MAX_VOICES; i++) {
        Voice& v = g_voices[i];
        if (v.stage == S_OFF) return &v;
        if (v.stage == S_RELEASE && (!oldestRelease || v.env < oldestRelease->env)) oldestRelease = &v;
        if (!oldest || v.age < oldest->age) oldest = &v;
    }
    return oldestRelease ? oldestRelease : oldest;
}

void triggerDuck(int offset, float amount) {
    if (offset < 0) offset = 0;
    if (offset >= QUANTUM) offset = QUANTUM - 1;
    g_duckTrig[offset] = fmaxf(g_duckTrig[offset], clampf(amount, 0.0f, 1.0f));
}

void startVoice(const Event& ev, int offset) {
    const int patchId = ev.patch >= 0 && ev.patch < MAX_PATCHES ? ev.patch : 0;
    const float* p = g_patches[patchId];
    Voice* vp = allocVoice();
    Voice& v = *vp;
    const bool stolen = v.stage != S_OFF;
    const float carryEnv = stolen ? v.env : 0.0f;
    resetVoice(v);

    const float sr = g_sampleRate;
    const float note = clampf(isFiniteF(ev.note) ? ev.note : 60.0f, 0.0f, 135.0f);
    const float hz = clampf(midiToHz(note), 1.0f, 0.45f * sr);

    v.patch = patchId;
    v.tag = ev.tag;
    v.engine = (int)clampf(p[P_ENGINE], 0.0f, (float)E_NOISE);
    v.filterMode = (int)clampf(p[P_FILTER_MODE], 0.0f, (float)F_HIGHPASS);
    v.duckMode = (int)clampf(p[P_DUCK], 0.0f, (float)DUCK_BYPASS);
    v.delay = offset;
    v.age = ++g_noteCounter;
    v.noise = 0x9e3779b9u ^ (v.age * 2654435761u);
    if (v.noise == 0) v.noise = 1;

    v.stage = S_ATTACK;
    v.env = carryEnv;
    v.attackInc = 1.0f / (fmaxf(p[P_ATTACK], 0.0005f) * sr);
    v.decayCoef = t60Coef(p[P_DECAY]);
    v.sustain = clampf(p[P_SUSTAIN], 0.0f, 1.0f);
    v.releaseCoef = t60Coef(p[P_RELEASE]);
    const float duration = isFiniteF(ev.duration) ? ev.duration : 0.0f;
    // Counted from the voice's first frame (runEnvelope starts counting at `delay`).
    v.releaseIn = duration > 0.0f ? (int)(duration * sr) : -1;

    v.inc = hz / sr;
    const int wave = (int)clampf(p[P_WAVE], 0.0f, (float)(W_COUNT - 1));
    v.table = g_tables[wave][tableLevel(v.inc)];
    v.osc2Mix = clampf(p[P_OSC2_MIX], 0.0f, 1.0f);
    v.inc2 = v.inc * exp2f(p[P_DETUNE] / 1200.0f);
    v.phase2 = 0.37f;  // decorrelate the detuned oscillator

    v.modInc = v.inc * fmaxf(p[P_FM_RATIO], 0.0f);
    v.fmIndex = fmaxf(p[P_FM_INDEX], 0.0f) / (2.0f * PI);  // radians -> cycles
    v.fmEnv = 1.0f;
    v.fmCoef = t60Coef(p[P_FM_DECAY]);
    v.pitchEnv = 1.0f;
    v.pitchCoef = t60Coef(p[P_PITCH_DECAY]);
    v.pitchDepth = fmaxf(p[P_PITCH_START], 1.0f) - 1.0f;

    const float velocity = clampf(isFiniteF(ev.velocity) ? ev.velocity : 0.0f, 0.0f, 1.0f);
    v.gain = fmaxf(p[P_GAIN], 0.0f) * velocity;
    const float pan = clampf(isFiniteF(ev.pan) ? ev.pan : 0.0f, -1.0f, 1.0f);
    const float angle = (pan + 1.0f) * 0.25f * PI;
    v.gl = cosf(angle);
    v.gr = sinf(angle);
    v.send = clampf(p[P_REVERB_SEND], 0.0f, 1.0f);

    v.cutoff = fmaxf(p[P_CUTOFF], 20.0f) * exp2f(p[P_KEY_TRACK] * (note - 60.0f) / 12.0f);
    v.filterEnvOct = p[P_FILTER_ENV];
    v.k = 2.0f - 1.96f * clampf(p[P_RESONANCE], 0.0f, 1.0f);

    if (v.duckMode == DUCK_SOURCE) triggerDuck(offset, velocity);
}

void releaseTag(int tag, int offset) {
    for (int i = 0; i < MAX_VOICES; i++) {
        Voice& v = g_voices[i];
        if (v.stage == S_OFF || v.tag != tag) continue;
        // releaseIn counts from the voice's first frame in this quantum (its delay).
        const int at = offset > v.delay ? offset - v.delay : 0;
        if (v.releaseIn < 0 || v.releaseIn > at) v.releaseIn = at;
    }
}

/** Amplitude envelope for frames [start, QUANTUM) into g_envBuf; handles release timing. */
void runEnvelope(Voice& v, int start) {
    float env = v.env;
    int stage = v.stage;
    int releaseIn = v.releaseIn;
    for (int i = start; i < QUANTUM; i++) {
        if (releaseIn == 0 && stage != S_RELEASE && stage != S_OFF) stage = S_RELEASE;
        if (releaseIn >= 0) releaseIn--;
        switch (stage) {
            case S_ATTACK:
                env += v.attackInc;
                if (env >= 1.0f) {
                    env = 1.0f;
                    stage = S_DECAY;
                }
                break;
            case S_DECAY:
                env = v.sustain + (env - v.sustain) * v.decayCoef;
                if (env - v.sustain < 1e-4f) {
                    env = v.sustain;
                    stage = v.sustain > VOICE_OFF_LEVEL ? S_SUSTAIN : S_OFF;
                }
                break;
            case S_SUSTAIN:
                env = v.sustain;
                break;
            case S_RELEASE:
                env *= v.releaseCoef;
                if (env < VOICE_OFF_LEVEL) stage = S_OFF;
                break;
            default:
                env = 0.0f;
                break;
        }
        g_envBuf[i] = stage == S_OFF ? 0.0f : env;
    }
    v.env = stage == S_OFF ? 0.0f : env;
    v.stage = stage;
    v.releaseIn = releaseIn;
}

/** Oscillator for frames [start, QUANTUM) into g_scratch. */
void runOscillator(Voice& v, int start) {
    float* out = g_scratch;
    switch (v.engine) {
        case E_FM: {
            float ph = v.phase, mph = v.modPhase, fmEnv = v.fmEnv;
            const float inc = v.inc, minc = v.modInc, idx = v.fmIndex, coef = v.fmCoef;
            for (int i = start; i < QUANTUM; i++) {
                const float m = readTable(g_sine, mph) * idx * fmEnv;
                out[i] = readTable(g_sine, wrap01(ph + m));
                ph += inc;
                if (ph >= 1.0f) ph -= 1.0f;
                mph += minc;
                if (mph >= 1.0f) mph -= floorf(mph);
                fmEnv *= coef;
            }
            v.phase = ph;
            v.modPhase = mph;
            v.fmEnv = fmEnv < FLUSH_LEVEL ? 0.0f : fmEnv;
            break;
        }
        case E_KICK: {
            float ph = v.phase, pe = v.pitchEnv;
            const float inc = v.inc, depth = v.pitchDepth, coef = v.pitchCoef;
            for (int i = start; i < QUANTUM; i++) {
                out[i] = readTable(g_sine, ph);
                ph += inc * (1.0f + depth * pe);
                ph -= floorf(ph);
                pe *= coef;
            }
            v.phase = ph;
            v.pitchEnv = pe < FLUSH_LEVEL ? 0.0f : pe;
            break;
        }
        case E_NOISE: {
            uint32_t s = v.noise;
            for (int i = start; i < QUANTUM; i++) {
                s ^= s << 13;
                s ^= s >> 17;
                s ^= s << 5;
                out[i] = (float)(int32_t)s * (1.0f / 2147483648.0f);
            }
            v.noise = s;
            break;
        }
        default: {
            const float* t = v.table;
            float ph = v.phase;
            const float inc = v.inc;
            if (v.osc2Mix > 0.0f) {
                float ph2 = v.phase2;
                const float inc2 = v.inc2;
                const float m2 = v.osc2Mix;
                const float m1 = 1.0f - 0.5f * m2;
                for (int i = start; i < QUANTUM; i++) {
                    out[i] = readTable(t, ph) * m1 + readTable(t, ph2) * m2 * 0.5f;
                    ph += inc;
                    if (ph >= 1.0f) ph -= 1.0f;
                    ph2 += inc2;
                    if (ph2 >= 1.0f) ph2 -= 1.0f;
                }
                v.phase2 = ph2;
            } else {
                for (int i = start; i < QUANTUM; i++) {
                    out[i] = readTable(t, ph);
                    ph += inc;
                    if (ph >= 1.0f) ph -= 1.0f;
                }
            }
            v.phase = ph;
            break;
        }
    }
}

/** Cytomic trapezoidal SVF over g_scratch, coefficients per sub-block. */
void runFilter(Voice& v, int start) {
    if (v.filterMode == F_OFF) return;
    const float nyq = 0.45f * g_sampleRate;
    const float brightness = g_globals[G_BRIGHTNESS];
    float ic1 = v.ic1, ic2 = v.ic2;
    const float k = v.k;
    float* x = g_scratch;
    for (int s = start; s < QUANTUM; s += SUB_BLOCK) {
        const int end = s + SUB_BLOCK < QUANTUM ? s + SUB_BLOCK : QUANTUM;
        const float env = g_envBuf[s];
        const float fc = clampf(v.cutoff * exp2f(brightness + v.filterEnvOct * env), 20.0f, nyq);
        const float g = tanf(PI * fc / g_sampleRate);
        const float a1 = 1.0f / (1.0f + g * (g + k));
        const float a2 = g * a1;
        const float a3 = g * a2;
        for (int i = s; i < end; i++) {
            const float v0 = x[i];
            const float v3 = v0 - ic2;
            const float v1 = a1 * ic1 + a2 * v3;
            const float v2 = ic2 + a2 * ic1 + a3 * v3;
            ic1 = 2.0f * v1 - ic1;
            ic2 = 2.0f * v2 - ic2;
            switch (v.filterMode) {
                case F_LOWPASS: x[i] = v2; break;
                case F_BANDPASS: x[i] = v1; break;
                default: x[i] = v0 - k * v1 - v2; break;
            }
        }
    }
    v.ic1 = ic1;
    v.ic2 = ic2;
}

void renderVoice(Voice& v) {
    // delay is the voice's start offset inside this quantum (processEvents keeps it < QUANTUM).
    const int start = v.delay;
    v.delay = 0;
    // Only the started part of the quantum is processed; [0, start) stays silent.
    runEnvelope(v, start);
    runOscillator(v, start);
    runFilter(v, start);
    // A bad parameter can only poison this voice: drop it before it reaches the mix.
    if (!isFiniteF(v.env) || !isFiniteF(v.ic1) || !isFiniteF(v.ic2) || !isFiniteF(v.phase)) {
        resetVoice(v);
        return;
    }
    const bool free = v.duckMode != DUCK_DUCKED;
    mixVoice(g_scratch, g_envBuf, v.gain, v.gl, v.gr, v.send, free ? g_freeL : g_duckL,
             free ? g_freeR : g_duckR, g_revIn, start);
}

void runDuck() {
    const float depth = clampf(g_globals[G_DUCK_DEPTH], 0.0f, 1.0f);
    float env = g_duckEnv, target = g_duckTarget;
    int hold = g_duckHold;
    const int attackFrames = (int)(0.004f * g_sampleRate);
    for (int i = 0; i < QUANTUM; i++) {
        const float trig = g_duckTrig[i];
        if (trig > 0.0f) {
            target = fmaxf(trig, hold > 0 ? target : 0.0f);
            hold = attackFrames;
        }
        if (hold > 0) {
            env += (target - env) * g_duckAttackCoef;
            hold--;
        } else {
            env *= g_duckReleaseCoef;
            if (env < FLUSH_LEVEL) env = 0.0f;
        }
        g_duckGain[i] = 1.0f - depth * env;
    }
    g_duckEnv = env;
    g_duckTarget = target;
    g_duckHold = hold;
}

void updateDuckCoefs() {
    g_duckAttackCoef = 1.0f - expf(-1.0f / (0.0015f * g_sampleRate));
    g_duckReleaseCoef = t60Coef(fmaxf(g_globals[G_DUCK_RELEASE], 0.01f));
}

void applyEvent(const Event& ev, double frame) {
    const double rel = ev.frame - frame;
    const int offset = rel <= 0.0 ? 0 : (int)rel;
    switch (ev.type) {
        case EV_NOTE_ON: startVoice(ev, offset); break;
        case EV_NOTE_OFF: releaseTag(ev.tag, offset); break;
        case EV_DUCK: triggerDuck(offset, ev.velocity); break;
        default: break;
    }
}

/**
 * Apply the events due before frame + QUANTUM in time order, so a note-off
 * follows its note-on. At equal frames note-offs go first: retriggering a tag
 * releases the old voice and keeps the new one.
 */
inline bool goesAfter(const Event& a, const Event& b) {
    if (a.frame != b.frame) return a.frame > b.frame;
    return b.type == EV_NOTE_OFF && a.type != EV_NOTE_OFF;
}

void processEvents(double frame) {
    static Event due[MAX_DUE];
    const double end = frame + QUANTUM;
    int n = 0;
    int i = 0;
    while (i < g_eventCount && n < MAX_DUE) {
        if (g_events[i].frame >= end) {
            i++;
            continue;
        }
        int j = n++;
        while (j > 0 && goesAfter(due[j - 1], g_events[i])) {
            due[j] = due[j - 1];
            j--;
        }
        due[j] = g_events[i];
        g_events[i] = g_events[--g_eventCount];
    }
    for (int k = 0; k < n; k++) applyEvent(due[k], frame);
}

int pushEvent(const Event& ev) {
    if (!g_ready || !(ev.frame - ev.frame == 0.0)) return 0;  // NaN or infinite frame
    if (g_eventCount >= MAX_EVENTS) {
        g_droppedEvents++;
        return 0;
    }
    g_events[g_eventCount++] = ev;
    return 1;
}

int countDenormals(const float* p, int n) {
    int c = 0;
    for (int i = 0; i < n; i++) c += isDenormal(p[i]) ? 1 : 0;
    return c;
}

}  // namespace

// =============================================================================
// ABI (every export is dsp_*; listed in emscripten/dsp/exports.txt)
// =============================================================================

extern "C" {

/** Reset everything for `sampleRate`; returns the render quantum (frames), or 0 if the rate is unusable. */
EMSCRIPTEN_KEEPALIVE int dsp_init(float sampleRate) {
    if (!(sampleRate >= 8000.0f && sampleRate <= 384000.0f)) return 0;
    const bool tablesBuilt = g_ready;
    g_sampleRate = sampleRate;
    if (!tablesBuilt) buildTables();
    for (int i = 0; i < MAX_PATCHES; i++) setPatchDefaults(g_patches[i]);
    setGlobalDefaults();
    for (int i = 0; i < MAX_VOICES; i++) resetVoice(g_voices[i]);
    g_eventCount = 0;
    g_noteCounter = 0;
    g_droppedEvents = 0;
    g_duckEnv = g_duckTarget = 0.0f;
    g_duckHold = 0;
    initReverb();
    updateReverbParams();
    updateDuckCoefs();
    clearBlock(g_duckTrig);
    g_ready = true;
    return QUANTUM;
}

EMSCRIPTEN_KEEPALIVE int dsp_max_voices() { return MAX_VOICES; }

EMSCRIPTEN_KEEPALIVE int dsp_patch_param_count() { return P_COUNT; }

EMSCRIPTEN_KEEPALIVE int dsp_global_param_count() { return G_COUNT; }

/** Set one parameter of a patch (PatchParam in src/audio/worklet/dsp-abi.ts). Applies to notes started after it. */
EMSCRIPTEN_KEEPALIVE void dsp_set_patch(int patch, int param, float value) {
    if (patch < 0 || patch >= MAX_PATCHES || param < 0 || param >= P_COUNT || !isFiniteF(value)) return;
    g_patches[patch][param] = value;
}

EMSCRIPTEN_KEEPALIVE float dsp_get_patch(int patch, int param) {
    if (patch < 0 || patch >= MAX_PATCHES || param < 0 || param >= P_COUNT) return 0.0f;
    return g_patches[patch][param];
}

/** Set a global parameter (GlobalParam). Takes effect at the next quantum. */
EMSCRIPTEN_KEEPALIVE void dsp_set_global(int param, float value) {
    if (param < 0 || param >= G_COUNT || !isFiniteF(value)) return;
    g_globals[param] = value;
    if (!g_ready) return;
    if (param == G_REVERB_ROOM || param == G_REVERB_DAMP) updateReverbParams();
    if (param == G_DUCK_RELEASE) updateDuckCoefs();
}

EMSCRIPTEN_KEEPALIVE float dsp_get_global(int param) {
    if (param < 0 || param >= G_COUNT) return 0.0f;
    return g_globals[param];
}

/**
 * Queue a note at absolute `frame`. `durationSec` <= 0 holds it until
 * dsp_note_off(tag). Returns 1 if queued, 0 if the queue is full.
 */
EMSCRIPTEN_KEEPALIVE int dsp_note_on(double frame, int patch, float note, float velocity, float durationSec,
                                     float pan, int tag) {
    Event ev;
    ev.frame = frame;
    ev.type = EV_NOTE_ON;
    ev.patch = patch;
    ev.tag = tag;
    ev.note = note;
    ev.velocity = velocity;
    ev.duration = durationSec;
    ev.pan = pan;
    return pushEvent(ev);
}

/** Release every voice carrying `tag` at `frame`. */
EMSCRIPTEN_KEEPALIVE int dsp_note_off(double frame, int tag) {
    Event ev = {};
    ev.frame = frame;
    ev.type = EV_NOTE_OFF;
    ev.tag = tag;
    return pushEvent(ev);
}

/** Duck the ducked bus by `amount` (0..1, times the duck depth) at `frame`. */
EMSCRIPTEN_KEEPALIVE int dsp_duck(double frame, float amount) {
    Event ev = {};
    ev.frame = frame;
    ev.type = EV_DUCK;
    ev.velocity = amount;
    return pushEvent(ev);
}

/** Release every voice and drop every queued event (stop / panic). */
EMSCRIPTEN_KEEPALIVE void dsp_all_off() {
    g_eventCount = 0;
    for (int i = 0; i < MAX_VOICES; i++) {
        Voice& v = g_voices[i];
        if (v.stage == S_OFF) continue;
        if (v.delay > 0) resetVoice(v);
        else v.releaseIn = 0;
    }
}

/** Render one quantum starting at absolute `frame` into dsp_output(0/1). Returns the voices still sounding. */
EMSCRIPTEN_KEEPALIVE int dsp_render(double frame) {
    clearBlock(g_outL);
    clearBlock(g_outR);
    if (!g_ready) return 0;
    clearBlock(g_duckL);
    clearBlock(g_duckR);
    clearBlock(g_freeL);
    clearBlock(g_freeR);
    clearBlock(g_revIn);

    processEvents(frame);

    int active = 0;
    for (int i = 0; i < MAX_VOICES; i++) {
        Voice& v = g_voices[i];
        if (v.stage == S_OFF) continue;
        renderVoice(v);
        if (v.stage != S_OFF) active++;
    }

    processReverb();
    runDuck();
    clearBlock(g_duckTrig);
    masterStage(fmaxf(g_globals[G_MASTER_GAIN], 0.0f));
    return active;
}

/** Output channel (0 = left, 1 = right): QUANTUM floats, valid after dsp_render. */
EMSCRIPTEN_KEEPALIVE float* dsp_output(int channel) { return channel == 1 ? g_outR : g_outL; }

EMSCRIPTEN_KEEPALIVE int dsp_pending_events() { return g_eventCount; }

EMSCRIPTEN_KEEPALIVE int dsp_dropped_events() { return g_droppedEvents; }

/** Denormal floats anywhere in the engine state (reverb, voices, duck). Tests only. */
EMSCRIPTEN_KEEPALIVE int dsp_scan_denormals() {
    int n = 0;
    n += countDenormals(&g_combBuf[0][0][0], 2 * COMB_COUNT * COMB_CAP);
    n += countDenormals(&g_allpassBuf[0][0][0], 2 * ALLPASS_COUNT * ALLPASS_CAP);
    for (int c = 0; c < 2; c++)
        for (int k = 0; k < COMB_COUNT; k++) n += isDenormal(g_combs[c][k].store) ? 1 : 0;
    for (int i = 0; i < MAX_VOICES; i++) {
        const Voice& v = g_voices[i];
        const float s[] = {v.env, v.ic1, v.ic2, v.fmEnv, v.pitchEnv, v.phase, v.phase2, v.modPhase};
        n += countDenormals(s, (int)(sizeof(s) / sizeof(s[0])));
    }
    n += isDenormal(g_duckEnv) ? 1 : 0;
    n += countDenormals(g_outL, QUANTUM) + countDenormals(g_outR, QUANTUM);
    return n;
}

}  // extern "C"
