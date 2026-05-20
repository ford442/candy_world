export type Entity = number;

export interface Component {
  [key: string]: any;
}

export interface System {
  update: (dt: number) => void;
}
