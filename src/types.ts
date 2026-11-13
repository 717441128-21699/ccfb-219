import type { FluidId } from './config';

// ---------- 场景（可编辑、可导入导出） ----------

export interface Vec {
  x: number;
  y: number;
}

export interface GraphNode {
  id: string;
  x: number;
  y: number;
  kind: 'taxi' | 'stand' | 'pad' | 'depot' | 'exit';
}

export interface GraphEdge {
  a: string;
  b: string;
}

export interface FlightPlan {
  id: string;
  airline: string;
  arrivalTick: number; // 进入等待队列的时刻
  standNode: string; // 机位节点
  exitNode: string; // 离场节点
  vip: boolean;
}

export interface WeatherSeg {
  startTick: number;
  level: number; // 0..3
}

export interface TruckSpec {
  id: string;
  depotNode: string;
}

export interface Scene {
  version: number;
  name: string;
  durationTicks: number;
  nodes: GraphNode[];
  edges: GraphEdge[];
  flights: FlightPlan[];
  weather: WeatherSeg[];
  trucks: TruckSpec[];
}

// ---------- 运行时实体 ----------

export type FlightPhase =
  | 'incoming'
  | 'queued'
  | 'toPad'
  | 'waitingPad'
  | 'deicing'
  | 'holdover'
  | 'toExit'
  | 'departed';

export interface FlightRT {
  planId: string;
  airline: string;
  vip: boolean;
  phase: FlightPhase;
  node: string; // 当前所在节点（移动中为起点）
  path: string[]; // 节点 id 路径
  segIdx: number; // 当前边在 path 中的索引
  segProgress: number; // 0..1
  padNode: string | null;
  fluid: FluidId | null;
  holdoverLeft: number; // 剩余保持时间（tick）
  deiceLeft: number;
  spawnTick: number;
  departedTick: number | null;
  reSprays: number;
  pressure: number;
  fined: boolean;
}

export type TruckPhase = 'idle' | 'moving' | 'working' | 'refilling' | 'swapping' | 'recalled';

export interface TruckRT {
  specId: string;
  phase: TruckPhase;
  node: string;
  path: string[];
  segIdx: number;
  segProgress: number;
  targetPad: string | null;
  fluidL: number;
  fluidChoice: FluidId;
  shiftLeft: number;
  workLeft: number; // 作业/加液/换班剩余 tick
  totalServed: number;
}

export interface GameEvent {
  tick: number;
  text: string;
  kind: 'info' | 'warn' | 'vip' | 'fine';
}

export interface Stats {
  departed: number;
  reSprays: number;
  delayTicks: number;
  fines: number;
  fluidCost: number;
  opCost: number;
  revenue: number;
}

// ---------- 玩家操作（动作流 = 录像） ----------

export type ActionType =
  | 'assignTruck'
  | 'recallTruck'
  | 'refillTruck'
  | 'swapShift'
  | 'assignPad'
  | 'setFluid'
  | 'speed';

export interface Action {
  tick: number;
  seq: number; // 同 tick 内序号，保证排序稳定
  type: ActionType;
  truckId?: string;
  flightId?: string;
  padNode?: string;
  fluid?: FluidId;
  speed?: number;
}

export interface Snapshot {
  tick: number;
  weatherLevel: number;
  budget: number;
  flights: FlightRT[];
  trucks: TruckRT[];
  events: GameEvent[];
  stats: Stats;
  edgeClaims: Record<string, string>; // "a|b" -> 占用实体 id
  checksum: number;
}
