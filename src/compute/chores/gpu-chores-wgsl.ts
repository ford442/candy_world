export const PREFIX_SUM_WGSL = /* wgsl */ `
@group(0) @binding(0) var<storage, read> input: array<u32>;
@group(0) @binding(1) var<storage, read_write> output: array<u32>;
@group(0) @binding(2) var<storage, read_write> blockSums: array<u32>;

var<workgroup> sharedData: array<u32, 256>;

@compute @workgroup_size(256)
fn scanBlocks(
    @builtin(global_invocation_id) global_id: vec3<u32>,
    @builtin(local_invocation_id) local_id: vec3<u32>,
    @builtin(workgroup_id) group_id: vec3<u32>
) {
    let gid = global_id.x;
    let lid = local_id.x;

    // Load input into shared memory
    if (gid < arrayLength(&input)) {
        sharedData[lid] = input[gid];
    } else {
        sharedData[lid] = 0u;
    }
    workgroupBarrier();

    // Up-sweep (reduce) phase
    for (var d = 1u; d < 256u; d *= 2u) {
        var temp = 0u;
        if (lid >= d) {
            temp = sharedData[lid - d];
        }
        workgroupBarrier();
        if (lid >= d) {
            sharedData[lid] += temp;
        }
        workgroupBarrier();
    }

    // Write result to output
    if (gid < arrayLength(&input)) {
        output[gid] = sharedData[lid];
    }

    // Write block sum (last element of block)
    if (lid == 255u) {
        blockSums[group_id.x] = sharedData[255];
    }
}
`;

export const PREFIX_SUM_ADD_WGSL = /* wgsl */ `
@group(0) @binding(0) var<storage, read_write> output: array<u32>;
@group(0) @binding(1) var<storage, read> blockSums: array<u32>;

@compute @workgroup_size(256)
fn addBlockSums(
    @builtin(global_invocation_id) global_id: vec3<u32>,
    @builtin(workgroup_id) group_id: vec3<u32>
) {
    let gid = global_id.x;
    let bid = group_id.x;

    if (bid > 0u && gid < arrayLength(&output)) {
        // Add sum of previous blocks
        output[gid] += blockSums[bid - 1u];
    }
}
`;

export const COMPACT_WGSL = /* wgsl */ `
@group(0) @binding(0) var<storage, read> inputFlags: array<u32>;
@group(0) @binding(1) var<storage, read> inputLods: array<u32>;
@group(0) @binding(2) var<storage, read> offsets: array<u32>;
@group(0) @binding(3) var<storage, read_write> outIndices: array<u32>;
@group(0) @binding(4) var<storage, read_write> outLods: array<u32>;
@group(0) @binding(5) var<storage, read_write> outCount: array<u32>;
@group(0) @binding(6) var<storage, read_write> indirectArgs: array<u32>;

@compute @workgroup_size(256)
fn compact(
    @builtin(global_invocation_id) global_id: vec3<u32>
) {
    let gid = global_id.x;
    if (gid >= arrayLength(&inputFlags)) {
        return;
    }

    let isVisible = inputFlags[gid];
    if (isVisible == 1u) {
        // Offset for this element is the value in prefix sum MINUS its own contribution (if any)
        // Wait, standard exclusive scan gives the exact destination index.
        // If our prefix sum is inclusive (output[i] is sum of 0..i):
        let destIdx = offsets[gid] - 1u;

        outIndices[destIdx] = gid;
        outLods[destIdx] = inputLods[gid];
    }

    // Last thread updates the count and indirect buffer
    if (gid == arrayLength(&inputFlags) - 1u) {
        let totalCount = offsets[gid];
        outCount[0] = totalCount;

        // Indirect args: { vertexCount, instanceCount, firstVertex, firstInstance }
        // We write totalCount to instanceCount (offset 1)
        if (arrayLength(&indirectArgs) >= 4u) {
            indirectArgs[1] = totalCount;
        }
    }
}
`;
