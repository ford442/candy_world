import type { ShaderNodeObject } from 'three/src/nodes/tsl/TSLCore.js';
import type { Node } from 'three/webgpu';

export type TSLArg = ShaderNodeObject<Node>;

export type TSLArgOpt = TSLArg | null;

export function $sn(n: Node | null | undefined): ShaderNodeObject<Node> {
    if (n == null) throw new Error('$sn(): unexpected null/undefined TSL node');
    return n as ShaderNodeObject<Node>;
}
