let cameraShake = 0;

export function addCameraShake(amount: number) {
    cameraShake = Math.max(cameraShake, amount);
}

export function getCameraShake(): number {
    return cameraShake;
}

export function setCameraShake(amount: number) {
    cameraShake = amount;
}
