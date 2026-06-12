/**
 * fast-array-utils.ts
 *
 * ⚡ OPTIMIZATION: Zero-allocation array utilities for hot paths.
 * Prevents GC spikes by modifying arrays in place instead of returning new ones.
 */

export const FastArrayUtils = {
    /**
     * Filters an array in-place without allocating a new array.
     * @param arr The array to filter
     * @param predicate Function to test each element
     * @returns The same array, modified in-place
     */
    filterInPlace<T>(arr: T[], predicate: (item: T, index: number) => boolean): T[] {
        let writeIndex = 0;
        for (let readIndex = 0; readIndex < arr.length; readIndex++) {
            if (predicate(arr[readIndex], readIndex)) {
                arr[writeIndex++] = arr[readIndex];
            }
        }
        arr.length = writeIndex;
        return arr;
    },

    /**
     * Maps an array in-place without allocating a new array.
     * @param arr The array to map
     * @param mapper Function that produces an element of the same type
     * @returns The same array, modified in-place
     */
    mapInPlace<T>(arr: T[], mapper: (item: T, index: number) => T): T[] {
        for (let i = 0; i < arr.length; i++) {
            arr[i] = mapper(arr[i], i);
        }
        return arr;
    },

    /**
     * Removes an element from an array without preserving order.
     * Swaps the element with the last one and pops, O(1) instead of O(N).
     * @param arr The array to modify
     * @param index The index of the element to remove
     */
    removeUnordered<T>(arr: T[], index: number): void {
        if (index < 0 || index >= arr.length) return;
        if (index !== arr.length - 1) {
            arr[index] = arr[arr.length - 1];
        }
        arr.pop();
    }
};
