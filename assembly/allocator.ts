// Unmanaged allocations for JS-owned buffers in AS linear memory.
//
// heap.alloc/heap.free go straight to the TLSF allocator. Blocks are not GC
// objects, so the incremental collector never frees or moves them: JS may keep
// the pointer across frames until it calls free(). The heap starts at
// __heap_base, which --memoryBase keeps above every fixed region in
// memory_layout.ts.

export function malloc(size: usize): usize {
    return heap.alloc(size);
}

export function free(ptr: usize): void {
    if (ptr != 0) heap.free(ptr);
}

/** First byte of the runtime heap; tests and the layout check assert it. */
export function getHeapBase(): usize {
    return __heap_base;
}
