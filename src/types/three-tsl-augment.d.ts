/**
 * TSL .compute() is missing on the inferred call-site type (often bare Node
 * when Fn(() => { …void }) fails overload resolution).
 * Augment Node itself — that is the type in the TS2339 message.
 */
declare module 'three/src/nodes/core/Node.js' {
    interface Node {
        compute(count: number | readonly [number, number, number], workgroupSize?: number[]): any;
    }
}

/** Also extend NodeElements so ShaderNodeObject mapped methods stay complete. */
declare module 'three/src/nodes/tsl/TSLCore.js' {
    interface NodeElements {
        compute: (
            node: any,
            count: number | readonly [number, number, number],
            workgroupSize?: number[]
        ) => any;
    }
}

declare module 'three/nodes' {
    interface Node {
        compute(count: number | readonly [number, number, number], workgroupSize?: number[]): any;
    }
}

import 'three/tsl';

/*
 * `three/tsl` (Three.TSL.d.ts) re-exports TSL *values* but no `Node` type, so
 * the interface below is what lets existing consumers write
 * `import type { Node } from 'three/tsl'`. Keep it.
 *
 * Do NOT add `interface ShaderNodeObject<T>` back to this block.
 *
 * Upstream, `ShaderNodeObject<T>` is a *type alias* — a mapped type over
 * `NodeElements` that supplies `.mul()`, `.add()`, swizzles and the rest — not
 * an interface. Declaring `interface ShaderNodeObject<T>` inside
 * `declare module 'three/tsl'` does not merge with that alias; it declares a
 * brand-new interface that *shadows* it for every consumer importing the name
 * from `three/tsl`. Those files then saw a type whose only member was the stub
 * declared here, so every chained TSL call failed with TS2339
 * ("Property 'mul' does not exist on type 'ShaderNodeObject<Node>'").
 *
 * That shadowing was the root cause of the bulk of the TSL errors across
 * material-core.ts, glitch.ts, wisteria-cluster.ts, jitter-mines.ts,
 * arpeggio-batcher.ts and rendering/materials.ts. The `three/src/nodes/**`
 * augmentations above are the correct mechanism for adding `.compute()`: they
 * extend the real declarations, which `three/tsl` re-exports, so the alias
 * keeps its full method surface.
 */
declare module 'three/tsl' {
    export { default as Node } from 'three/src/nodes/core/Node.js';
}
