export type Entity = number;

export interface Component {
  [key: string]: any;
}

export interface System {
  update: (dt: number) => void;
}

export interface NativeComponentCodec<T extends Component> {
  strideBytes: number;
  maxEntities?: number;
  write: (view: DataView, component: T) => void;
  read: (view: DataView) => T;
}

export interface NativeQueryTable {
  ids: Uint32Array;
  pointers: Record<string, Uint32Array>;
  count: number;
}
