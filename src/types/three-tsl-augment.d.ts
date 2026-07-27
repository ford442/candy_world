import 'three/tsl';

declare module 'three/tsl' {
  interface Node {
    compute?(workgroupCount: number | [number, number, number]): any;
  }
  interface ShaderNodeObject<T> {
    compute?(workgroupCount: number | [number, number, number]): any;
  }
}
