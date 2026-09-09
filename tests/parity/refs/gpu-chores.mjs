/**
 * JS mirror of the shared GPU chores WGSL (src/compute/chores/gpu-chores-wgsl.ts).
 *
 * These functions reproduce the *block structure* of the shaders — the 256-wide
 * Hillis–Steele scan, the single-workgroup scan of the block totals with its
 * running carry, the add-back pass, and the tree reduction — rather than taking
 * the shortcut of a plain sequential loop. That is the point: tests/gpu-chores.test.mjs
 * compares this mirror against a naive reference, so a block-boundary bug in the
 * WGSL (e.g. adding only the previous block's total instead of all preceding
 * ones) shows up as a mismatch instead of being papered over.
 *
 * Kept in sync by hand with the WGSL, in the same spirit as
 * tests/parity/refs/plant-pose.mjs mirrors gpu-plant-pose.ts.
 */

/** Must match WORKGROUP_SIZE in gpu-chores-wgsl.ts. */
export const WORKGROUP = 256;

export function blockCount(count) {
    return Math.ceil(count / WORKGROUP);
}

/** One workgroup of `scanBlocks`: inclusive Hillis–Steele scan over `shared`. */
function scanSharedInclusive(shared) {
    for (let d = 1; d < WORKGROUP; d *= 2) {
        // Every lane reads before any lane writes — this is the workgroupBarrier()
        // between the two halves of the WGSL loop body.
        const temp = new Uint32Array(WORKGROUP);
        for (let lid = 0; lid < WORKGROUP; lid++) {
            temp[lid] = lid >= d ? shared[lid - d] : 0;
        }
        for (let lid = 0; lid < WORKGROUP; lid++) {
            if (lid >= d) shared[lid] = (shared[lid] + temp[lid]) >>> 0;
        }
    }
}

/**
 * Mirror of PREFIX_SUM_WGSL + PREFIX_SUM_BLOCK_SCAN_WGSL + PREFIX_SUM_ADD_WGSL.
 *
 * @param {Uint32Array} input - values to scan; only the first `count` are live.
 * @param {number} count - live element count (the `params.count` uniform).
 * @returns {{ offsets: Uint32Array, blockOffsets: Uint32Array }} inclusive scan
 *   of the live range, plus the exclusive per-block offsets.
 */
export function prefixSumChore(input, count) {
    const offsets = new Uint32Array(count);
    const blocks = blockCount(count);
    const blockSums = new Uint32Array(Math.max(1, blocks));
    if (count === 0) return { offsets, blockOffsets: blockSums };

    // Pass 1: per-block inclusive scan + block totals.
    for (let b = 0; b < blocks; b++) {
        const shared = new Uint32Array(WORKGROUP);
        for (let lid = 0; lid < WORKGROUP; lid++) {
            const gid = b * WORKGROUP + lid;
            shared[lid] = gid < count ? input[gid] : 0;
        }
        scanSharedInclusive(shared);
        for (let lid = 0; lid < WORKGROUP; lid++) {
            const gid = b * WORKGROUP + lid;
            if (gid < count) offsets[gid] = shared[lid];
        }
        blockSums[b] = shared[WORKGROUP - 1];
    }

    // The shaders skip passes 2 and 3 entirely for a single block.
    if (blocks <= 1) return { offsets, blockOffsets: blockSums };

    // Pass 2: one workgroup turns the block totals into exclusive offsets,
    // walking them in chunks of 256 with a running carry.
    let carry = 0;
    for (let base = 0; base < blocks; base += WORKGROUP) {
        const shared = new Uint32Array(WORKGROUP);
        const original = new Uint32Array(WORKGROUP);
        for (let lid = 0; lid < WORKGROUP; lid++) {
            const gi = base + lid;
            const value = gi < blocks ? blockSums[gi] : 0;
            shared[lid] = value;
            original[lid] = value;
        }
        scanSharedInclusive(shared);
        const chunkTotal = shared[WORKGROUP - 1];
        for (let lid = 0; lid < WORKGROUP; lid++) {
            const gi = base + lid;
            if (gi < blocks) blockSums[gi] = (carry + shared[lid] - original[lid]) >>> 0;
        }
        carry = (carry + chunkTotal) >>> 0;
    }

    // Pass 3: fold each block's exclusive offset back into its elements.
    for (let gid = 0; gid < count; gid++) {
        offsets[gid] = (offsets[gid] + blockSums[(gid / WORKGROUP) | 0]) >>> 0;
    }

    return { offsets, blockOffsets: blockSums };
}

/**
 * Mirror of COMPACT_WGSL.
 *
 * @param {Uint32Array} flags - 0/1 per element.
 * @param {Uint32Array} lods - payload per element.
 * @param {Uint32Array} offsets - inclusive prefix sum of `flags`.
 * @param {number} count - live element count.
 * @param {number} capacity - slots available in the dense outputs.
 */
export function compactChore(flags, lods, offsets, count, capacity) {
    const outIndices = new Uint32Array(capacity);
    const outLods = new Uint32Array(capacity);
    const indirectArgs = new Uint32Array(5);
    let outCount = 0;

    for (let gid = 0; gid < count; gid++) {
        if (flags[gid] === 1) {
            const destIdx = offsets[gid] - 1;
            if (destIdx < capacity) {
                outIndices[destIdx] = gid;
                outLods[destIdx] = lods[gid];
            }
        }
        if (gid === count - 1) {
            outCount = offsets[gid];
            indirectArgs[1] = outCount;
        }
    }

    return { outIndices, outLods, outCount, indirectArgs };
}

/** One workgroup of `reduceBlocks`: tree sum over `shared`, result in shared[0]. */
function reduceSharedTree(shared) {
    for (let stride = WORKGROUP >> 1; stride > 0; stride >>= 1) {
        for (let lid = 0; lid < stride; lid++) {
            shared[lid] += shared[lid + stride];
        }
    }
    return shared[0];
}

/**
 * Mirror of REDUCE_F32_WGSL + REDUCE_F32_FINAL_WGSL.
 *
 * Summation order matters for floats, so this reproduces the shader's tree
 * order rather than summing left to right.
 *
 * @param {Float32Array} input - values to sum; only the first `count` are live.
 * @param {number} count - live element count.
 */
export function reduceF32Chore(input, count) {
    if (count === 0) return 0;
    const blocks = blockCount(count);
    const partials = new Float32Array(blocks);

    for (let b = 0; b < blocks; b++) {
        const shared = new Float32Array(WORKGROUP);
        for (let lid = 0; lid < WORKGROUP; lid++) {
            const gid = b * WORKGROUP + lid;
            shared[lid] = gid < count ? input[gid] : 0;
        }
        partials[b] = reduceSharedTree(shared);
    }

    // Final pass: single workgroup folding the partials in chunks of 256.
    let accum = 0;
    for (let base = 0; base < blocks; base += WORKGROUP) {
        const shared = new Float32Array(WORKGROUP);
        for (let lid = 0; lid < WORKGROUP; lid++) {
            const gi = base + lid;
            shared[lid] = gi < blocks ? partials[gi] : 0;
        }
        accum += reduceSharedTree(shared);
    }
    return accum;
}
