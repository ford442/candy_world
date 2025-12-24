#include <cmath>

// Global result storage
float arpeggioResult[2]; // [targetStep, unfurlStep]

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

float getArpeggioTargetStep_c() {
    return arpeggioResult[0];
}

float getArpeggioUnfurlStep_c() {
    return arpeggioResult[1];
}
