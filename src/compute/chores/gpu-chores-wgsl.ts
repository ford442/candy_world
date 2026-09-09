/**
 * @file gpu-chores-wgsl.ts
 * @brief WGSL sources for the shared GPU chores (Tier 4a) — generic primitives
 *        that any subsystem can reuse: prefix sum, stream compaction, f32 reduce.
 *
 * Conventions shared by every kernel here:
 *
 * 1. **Live element count comes from a uniform, never `arrayLength()`.**
 *    Callers size their storage buffers for a worst-case capacity and only fill
 *    the first `params.count` slots. `arrayLength()` would report the capacity,
 *    so the tail of a partially-filled buffer (stale data from previous frames)
 *    would leak into the result and the "last element" bookkeeping in `compact`
 *    would land on a thread that was never dispatched.
 *
 * 2. **Workgroup size is 256 for all 1D kernels** (`WORKGROUP_SIZE` below), which
 *    is what the block-sum buffer sizing in every caller assumes.
 *
 * 3. **`prefixSum` is inclusive.** For a flag array, `offsets[i] - 1` is the
 *    destination slot of element `i`, and `offsets[count - 1]` is the total.
 *
 * @see docs/COMPUTE_GPU_DEFAULT.md — Tier 4a vs 4b
 */

/** Workgroup size assumed by every 1D chore kernel and by block-sum buffer sizing. */
export const WORKGROUP_SIZE = 256;

/**
 * Shared uniform block. `count` is the number of *live* elements for the pass,
 * which is not necessarily the capacity of the bound storage buffers.
 */
const CHORE_PARAMS_WGSL = /* wgsl */ `
struct ChoreParams {
    count: u32,
    _pad0: u32,
    _pad1: u32,
    _pad2: u32,
};
`;

/** Bytes of the `ChoreParams` uniform buffer (std140: 4 × u32). */
export const CHORE_PARAMS_BYTES = 16;

/**
 * Pass 1 of the prefix sum: inclusive Hillis–Steele scan within each 256-element
 * block, plus the per-block total written to `blockSums`.
 */
export const PREFIX_SUM_WGSL = /* wgsl */ `
${CHORE_PARAMS_WGSL}
@group(0) @binding(0) var<storage, read> input: array<u32>;
@group(0) @binding(1) var<storage, read_write> output: array<u32>;
@group(0) @binding(2) var<storage, read_write> blockSums: array<u32>;
@group(0) @binding(3) var<uniform> params: ChoreParams;

var<workgroup> sharedData: array<u32, 256>;

@compute @workgroup_size(256)
fn scanBlocks(
    @builtin(global_invocation_id) global_id: vec3<u32>,
    @builtin(local_invocation_id) local_id: vec3<u32>,
    @builtin(workgroup_id) group_id: vec3<u32>
) {
    let gid = global_id.x;
    let lid = local_id.x;

    // Elements past the live count contribute 0 so a partially-filled trailing
    // block cannot pick up stale data from a previous frame.
    if (gid < params.count) {
        sharedData[lid] = input[gid];
    } else {
        sharedData[lid] = 0u;
    }
    workgroupBarrier();

    // Inclusive scan within the block.
    for (var d = 1u; d < 256u; d = d * 2u) {
        var temp = 0u;
        if (lid >= d) {
            temp = sharedData[lid - d];
        }
        workgroupBarrier();
        if (lid >= d) {
            sharedData[lid] = sharedData[lid] + temp;
        }
        workgroupBarrier();
    }

    if (gid < params.count) {
        output[gid] = sharedData[lid];
    }

    // Block total = last slot of the inclusive scan.
    if (lid == 255u) {
        blockSums[group_id.x] = sharedData[255];
    }
}
`;

/**
 * Pass 2 of the prefix sum: turn the per-block totals into *exclusive* per-block
 * offsets, in place.
 *
 * Dispatched as a single workgroup that walks `params.count` block totals in
 * chunks of 256 carrying a running sum, so any block count is supported.
 * Without this pass `addBlockSums` would only ever add the immediately
 * preceding block's total, which is correct for two blocks and wrong for three
 * or more (i.e. wrong above 512 elements).
 */
export const PREFIX_SUM_BLOCK_SCAN_WGSL = /* wgsl */ `
${CHORE_PARAMS_WGSL}
@group(0) @binding(0) var<storage, read_write> blockSums: array<u32>;
@group(0) @binding(1) var<uniform> params: ChoreParams;

var<workgroup> sharedData: array<u32, 256>;
var<workgroup> carry: u32;

@compute @workgroup_size(256)
fn scanBlockSums(@builtin(local_invocation_id) local_id: vec3<u32>) {
    let lid = local_id.x;

    if (lid == 0u) {
        carry = 0u;
    }
    workgroupBarrier();

    let n = params.count;
    var base = 0u;
    // base and n are uniform across the workgroup, so the barriers below
    // stay in uniform control flow.
    loop {
        if (base >= n) { break; }

        let gi = base + lid;
        var value = 0u;
        if (gi < n) {
            value = blockSums[gi];
        }
        sharedData[lid] = value;
        workgroupBarrier();

        for (var d = 1u; d < 256u; d = d * 2u) {
            var temp = 0u;
            if (lid >= d) {
                temp = sharedData[lid - d];
            }
            workgroupBarrier();
            if (lid >= d) {
                sharedData[lid] = sharedData[lid] + temp;
            }
            workgroupBarrier();
        }

        let chunkTotal = sharedData[255];
        // inclusive − own value = exclusive, then offset by everything before
        // this chunk.
        if (gi < n) {
            blockSums[gi] = carry + sharedData[lid] - value;
        }
        workgroupBarrier();

        if (lid == 0u) {
            carry = carry + chunkTotal;
        }
        workgroupBarrier();

        base = base + 256u;
    }
}
`;

/**
 * Pass 3 of the prefix sum: add each block's exclusive offset to every element
 * of that block, producing a whole-array inclusive scan.
 */
export const PREFIX_SUM_ADD_WGSL = /* wgsl */ `
${CHORE_PARAMS_WGSL}
@group(0) @binding(0) var<storage, read_write> output: array<u32>;
@group(0) @binding(1) var<storage, read> blockSums: array<u32>;
@group(0) @binding(2) var<uniform> params: ChoreParams;

@compute @workgroup_size(256)
fn addBlockSums(
    @builtin(global_invocation_id) global_id: vec3<u32>,
    @builtin(workgroup_id) group_id: vec3<u32>
) {
    let gid = global_id.x;
    if (gid >= params.count) {
        return;
    }
    // blockSums is exclusive after scanBlockSums, so block 0 adds 0.
    output[gid] = output[gid] + blockSums[group_id.x];
}
`;

/**
 * Stream compaction driven by an inclusive prefix sum of `inputFlags`.
 *
 * Writes the surviving source indices (and their LOD levels) densely, the total
 * to `outCount[0]`, and the same total to `indirectArgs[1]` — the `instanceCount`
 * slot of both the 4-word `draw` and the 5-word `drawIndexed` indirect layouts.
 */
export const COMPACT_WGSL = /* wgsl */ `
${CHORE_PARAMS_WGSL}
@group(0) @binding(0) var<storage, read> inputFlags: array<u32>;
@group(0) @binding(1) var<storage, read> inputLods: array<u32>;
@group(0) @binding(2) var<storage, read> offsets: array<u32>;
@group(0) @binding(3) var<storage, read_write> outIndices: array<u32>;
@group(0) @binding(4) var<storage, read_write> outLods: array<u32>;
@group(0) @binding(5) var<storage, read_write> outCount: array<u32>;
@group(0) @binding(6) var<storage, read_write> indirectArgs: array<u32>;
@group(0) @binding(7) var<uniform> params: ChoreParams;

@compute @workgroup_size(256)
fn compact(@builtin(global_invocation_id) global_id: vec3<u32>) {
    let gid = global_id.x;
    let count = params.count;
    if (gid >= count) {
        return;
    }

    if (inputFlags[gid] == 1u) {
        // offsets is an *inclusive* scan, so offsets[gid] − 1 is this element's
        // destination slot.
        let destIdx = offsets[gid] - 1u;
        if (destIdx < arrayLength(&outIndices)) {
            outIndices[destIdx] = gid;
            outLods[destIdx] = inputLods[gid];
        }
    }

    // Last *live* element publishes the total. Keyed off params.count, not
    // arrayLength(), so it lands on a thread that was actually dispatched.
    if (gid == count - 1u) {
        let totalCount = offsets[gid];
        outCount[0] = totalCount;
        if (arrayLength(&indirectArgs) >= 2u) {
            indirectArgs[1] = totalCount;
        }
    }
}
`;

/**
 * Pass 1 of `reduce_f32`: tree sum within each 256-element block into `partials`.
 */
export const REDUCE_F32_WGSL = /* wgsl */ `
${CHORE_PARAMS_WGSL}
@group(0) @binding(0) var<storage, read> input: array<f32>;
@group(0) @binding(1) var<storage, read_write> partials: array<f32>;
@group(0) @binding(2) var<uniform> params: ChoreParams;

var<workgroup> sharedData: array<f32, 256>;

@compute @workgroup_size(256)
fn reduceBlocks(
    @builtin(global_invocation_id) global_id: vec3<u32>,
    @builtin(local_invocation_id) local_id: vec3<u32>,
    @builtin(workgroup_id) group_id: vec3<u32>
) {
    let gid = global_id.x;
    let lid = local_id.x;

    var value = 0.0;
    if (gid < params.count) {
        value = input[gid];
    }
    sharedData[lid] = value;
    workgroupBarrier();

    for (var stride = 128u; stride > 0u; stride = stride >> 1u) {
        if (lid < stride) {
            sharedData[lid] = sharedData[lid] + sharedData[lid + stride];
        }
        workgroupBarrier();
    }

    if (lid == 0u) {
        partials[group_id.x] = sharedData[0];
    }
}
`;

/**
 * Pass 2 of `reduce_f32`: single workgroup folding `params.count` partials into
 * `result[0]`, in chunks of 256 with a running accumulator.
 */
export const REDUCE_F32_FINAL_WGSL = /* wgsl */ `
${CHORE_PARAMS_WGSL}
@group(0) @binding(0) var<storage, read> partials: array<f32>;
@group(0) @binding(1) var<storage, read_write> result: array<f32>;
@group(0) @binding(2) var<uniform> params: ChoreParams;

var<workgroup> sharedData: array<f32, 256>;
var<workgroup> accum: f32;

@compute @workgroup_size(256)
fn reduceFinal(@builtin(local_invocation_id) local_id: vec3<u32>) {
    let lid = local_id.x;

    if (lid == 0u) {
        accum = 0.0;
    }
    workgroupBarrier();

    let n = params.count;
    var base = 0u;
    loop {
        if (base >= n) { break; }

        let gi = base + lid;
        var value = 0.0;
        if (gi < n) {
            value = partials[gi];
        }
        sharedData[lid] = value;
        workgroupBarrier();

        for (var stride = 128u; stride > 0u; stride = stride >> 1u) {
            if (lid < stride) {
                sharedData[lid] = sharedData[lid] + sharedData[lid + stride];
            }
            workgroupBarrier();
        }

        if (lid == 0u) {
            accum = accum + sharedData[0];
        }
        workgroupBarrier();

        base = base + 256u;
    }

    if (lid == 0u) {
        result[0] = accum;
    }
}
`;
