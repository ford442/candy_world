import re

with open('src/systems/batcher-lod.ts', 'r') as f:
    content = f.read()

search_block = """        let needsUpdate = false;
        for (let i = 0; i < count; i++) {
            const offset = i * 16;
            const px = matrixArray[offset + 12];
            const py = matrixArray[offset + 13];
            const pz = matrixArray[offset + 14];

            const dx = px - _cameraPos.x;
            const dy = py - _cameraPos.y;
            const dz = pz - _cameraPos.z;
            const distSq = dx * dx + dy * dy + dz * dz;

            // ⚡ OPTIMIZATION: Bypassed redundant second loop and double distance calculations by updating impostors inline.
            const target = computeTargetLodFactorSq(distSq, cfg);
            const current = smoothed[i];
            const diff = Math.abs(target - current);

            if (diff > 1e-3) {
                const next = current + (target - current) * blendT;
                smoothed[i] = next;
                attrArray[i] = next;
                accumulateStats(next, cfg);
                needsUpdate = true;
            } else if (current !== target) {
                smoothed[i] = target;
                attrArray[i] = target;
                accumulateStats(target, cfg);
                needsUpdate = true;
            } else {
                accumulateStats(target, cfg);
            }

            // Instances collapsed to zero scale (parked fauna, removed slots) get no billboard.
            if (impostor) {
                const c0 = matrixArray[offset];
                const c1 = matrixArray[offset + 1];
                const c2 = matrixArray[offset + 2];
                if (c0 * c0 + c1 * c1 + c2 * c2 > 1e-8) {
                    const factor = smoothed[i];
                    const alpha = impostorAlphaFromFactor(factor, cfg);
                    if (alpha > 0.001 && factor < 3 && impostorCount < _impostorCapacity && distSq < farCullSq) {
                        const scaleVal = maxScales ? maxScales[i] : 1;
                        const size = scaleVal * cfg.impostorScaleMul;

                        _billboardMatrixFromCamera(camera, px, py, pz, size, size * cfg.impostorAspect);
                        _billboardMatrix.toArray(impostor.instanceMatrix.array, impostorCount * 16);

                        if (impostor.instanceColor && colorArray) {
                            const dst = impostor.instanceColor.array as Float32Array;
                            const srcOff = i * 3;
                            const dstOff = impostorCount * 3;
                            let sr = colorArray[srcOff];
                            let sg = colorArray[srcOff + 1];
                            let sb = colorArray[srcOff + 2];
                            if (seasonRoleOff >= 0) {
                                _impostorTint[0] = sr;
                                _impostorTint[1] = sg;
                                _impostorTint[2] = sb;
                                tintRgbInPlace(
                                    _impostorTint,
                                    0,
                                    seasonRoleCpu,
                                    seasonRoleOff,
                                    seasonFrostCpu,
                                    IMPOSTOR_NORMAL_Y
                                );
                                sr = _impostorTint[0];
                                sg = _impostorTint[1];
                                sb = _impostorTint[2];
                            }
                            dst[dstOff] = sr * (1 - aerialMix) + fogR * aerialMix;
                            dst[dstOff + 1] = sg * (1 - aerialMix) + fogG * aerialMix;
                            dst[dstOff + 2] = sb * (1 - aerialMix) + fogB * aerialMix;
                        }

                        alphaArray![impostorCount] = alpha;
                        impostorCount++;
                    }
                }
            }
        }"""

replace_block = """        let needsUpdate = false;

        // ⚡ OPTIMIZATION: Bypassed pure JS O(N) distance checks and smoothstep math with a single WASM batch call
        let useWasm = isEmscriptenReady();
        if (useWasm) {
            const statsArray = new Int32Array(6);
            batchUpdateLodFactors_c(
                matrixArray,
                smoothed,
                count,
                _cameraPos.x,
                _cameraPos.y,
                _cameraPos.z,
                cfg.heroMax,
                cfg.midMax,
                cfg.blendWidth,
                farCullSq,
                blendT,
                statsArray
            );

            _stats.hero += statsArray[0];
            _stats.mid += statsArray[1];
            _stats.far += statsArray[2];
            _stats.culled += statsArray[3];
            _stats.blendBand += statsArray[4];
            _stats.total += statsArray[5];

            for (let i = 0; i < count; i++) {
                if (attrArray[i] !== smoothed[i]) {
                    attrArray[i] = smoothed[i];
                    needsUpdate = true;
                }
            }
        }

        for (let i = 0; i < count; i++) {
            const offset = i * 16;
            const px = matrixArray[offset + 12];
            const py = matrixArray[offset + 13];
            const pz = matrixArray[offset + 14];

            const dx = px - _cameraPos.x;
            const dy = py - _cameraPos.y;
            const dz = pz - _cameraPos.z;
            const distSq = dx * dx + dy * dy + dz * dz;

            if (!useWasm) {
                // ⚡ OPTIMIZATION: Bypassed redundant second loop and double distance calculations by updating impostors inline.
                const target = computeTargetLodFactorSq(distSq, cfg);
                const current = smoothed[i];
                const diff = Math.abs(target - current);

                if (diff > 1e-3) {
                    const next = current + (target - current) * blendT;
                    smoothed[i] = next;
                    attrArray[i] = next;
                    accumulateStats(next, cfg);
                    needsUpdate = true;
                } else if (current !== target) {
                    smoothed[i] = target;
                    attrArray[i] = target;
                    accumulateStats(target, cfg);
                    needsUpdate = true;
                } else {
                    accumulateStats(target, cfg);
                }
            }

            // Instances collapsed to zero scale (parked fauna, removed slots) get no billboard.
            if (impostor) {
                const c0 = matrixArray[offset];
                const c1 = matrixArray[offset + 1];
                const c2 = matrixArray[offset + 2];
                if (c0 * c0 + c1 * c1 + c2 * c2 > 1e-8) {
                    const factor = smoothed[i];
                    const alpha = impostorAlphaFromFactor(factor, cfg);
                    if (alpha > 0.001 && factor < 3 && impostorCount < _impostorCapacity && distSq < farCullSq) {
                        const scaleVal = maxScales ? maxScales[i] : 1;
                        const size = scaleVal * cfg.impostorScaleMul;

                        _billboardMatrixFromCamera(camera, px, py, pz, size, size * cfg.impostorAspect);
                        _billboardMatrix.toArray(impostor.instanceMatrix.array, impostorCount * 16);

                        if (impostor.instanceColor && colorArray) {
                            const dst = impostor.instanceColor.array as Float32Array;
                            const srcOff = i * 3;
                            const dstOff = impostorCount * 3;
                            let sr = colorArray[srcOff];
                            let sg = colorArray[srcOff + 1];
                            let sb = colorArray[srcOff + 2];
                            if (seasonRoleOff >= 0) {
                                _impostorTint[0] = sr;
                                _impostorTint[1] = sg;
                                _impostorTint[2] = sb;
                                tintRgbInPlace(
                                    _impostorTint,
                                    0,
                                    seasonRoleCpu,
                                    seasonRoleOff,
                                    seasonFrostCpu,
                                    IMPOSTOR_NORMAL_Y
                                );
                                sr = _impostorTint[0];
                                sg = _impostorTint[1];
                                sb = _impostorTint[2];
                            }
                            dst[dstOff] = sr * (1 - aerialMix) + fogR * aerialMix;
                            dst[dstOff + 1] = sg * (1 - aerialMix) + fogG * aerialMix;
                            dst[dstOff + 2] = sb * (1 - aerialMix) + fogB * aerialMix;
                        }

                        alphaArray![impostorCount] = alpha;
                        impostorCount++;
                    }
                }
            }
        }"""

content = content.replace(search_block, replace_block)
with open('src/systems/batcher-lod.ts', 'w') as f:
    f.write(content)
