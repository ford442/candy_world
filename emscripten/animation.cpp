#include <cmath>
#include <emscripten.h>

extern "C" {

// Global result storage
float arpeggioResult[2]; // [targetStep, unfurlStep]

EMSCRIPTEN_KEEPALIVE
void calcArpeggioStep_c(float currentUnfurl, float currentTarget, int lastTrigger, int arpeggioActive, int noteTrigger, float maxSteps) {
    float nextTarget = currentTarget;

    if (arpeggioActive != 0) {
        if (noteTrigger != 0 && lastTrigger == 0) {
            nextTarget += 1.0f;
            if (nextTarget > maxSteps) nextTarget = maxSteps;
        }
    } else {
        nextTarget = 0.0f;
    }

    float speed = (nextTarget > currentUnfurl) ? 0.3f : 0.05f;
    float diff = nextTarget - currentUnfurl;
    float nextUnfurl = currentUnfurl + (diff * speed);

    arpeggioResult[0] = nextTarget;
    arpeggioResult[1] = nextUnfurl;
}

EMSCRIPTEN_KEEPALIVE
float getArpeggioTargetStep_c() {
    return arpeggioResult[0];
}

EMSCRIPTEN_KEEPALIVE
float getArpeggioUnfurlStep_c() {
    return arpeggioResult[1];
}

}
