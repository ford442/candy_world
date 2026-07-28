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

declare module 'three/tsl' {
    interface Node {
        compute?(workgroupCount: number | [number, number, number]): any;
    }
    interface ShaderNodeObject<T> {
        compute?(workgroupCount: number | [number, number, number]): any;
    }
}
