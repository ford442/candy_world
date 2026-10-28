import type { ColorRepresentation } from 'three';
import { color } from 'three/tsl';
import type { Node } from 'three/webgpu';

/**
 * TSL node types for the material helpers. three r186's types merge the TSL
 * methods (`.mul()`, swizzles, …) into typed `Node<'float' | 'vec3' | …>`, so
 * the old `ShaderNodeObject<Node>` wrapper (and its deep
 * `three/src/nodes/tsl/TSLCore.js` import) is gone.
 */
export type TSLArg = Node;

export type TSLArgOpt = TSLArg | null;

export type FloatNode = Node<'float'>;
export type Vec2Node = Node<'vec2'>;
export type Vec3Node = Node<'vec3'>;
export type Vec4Node = Node<'vec4'>;

/** A vec3 or a colour; TSL's operators treat them alike. */
export type ColorLike = Node<'vec3'> | Node<'color'>;

/** A colour as a vec3 for maths (same WGSL type; type-only). */
export function asVec3(n: ColorLike): Vec3Node {
    return n as Vec3Node;
}

/** Anything a material's colour / emissive slot accepts. */
export type MaterialColorNode = Node<'vec3'> | Node<'color'> | Node<'vec4'> | Node<'float'>;

/**
 * `color()` for a `ColorRepresentation`. three's overloads take a number /
 * string or a `Color`, not their union, which is what the option bags hold.
 */
export function colorOf(c: ColorRepresentation): Node<'color'> {
    return color(c as number);
}

/**
 * Read a material node slot (`colorNode`, `emissiveNode`, …) as a vec3 for
 * further maths. Type-only: TSL converts the slot's value on use.
 */
export function $sn(n: Node | null | undefined): Vec3Node {
    if (n == null) throw new Error('$sn(): unexpected null/undefined TSL node');
    return n as Vec3Node;
}

/**
 * Re-type a node where TSL converts implicitly but three's types do not: a
 * uint `instanceIndex` against a float uniform, a bool mask in arithmetic,
 * floats into `ivec2()`. Type-only; the generated shader is unchanged.
 */
export function asNode<T extends Node>(n: unknown): T {
    return n as T;
}

/** Read a scalar material slot (`roughnessNode`, `opacityNode`, …) as a float. Type-only. */
export function $sf(n: Node | null | undefined): FloatNode {
    if (n == null) throw new Error('$sf(): unexpected null/undefined TSL node');
    return n as FloatNode;
}
