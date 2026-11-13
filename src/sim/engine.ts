import { ECONOMY, FLUIDS, TICK_SECONDS, TRUCK, WEATHER_LEVELS } from '../config';
import type {
  Action,
  FlightRT,
  GameEvent,
  Scene,
  Stats,
  TruckRT,
  Vec,
} from '../types';
import type { FluidId } from '../config';
import { edgeKey, Graph } from './graph';
import { Rng } from './rng';

const FLIGHT_SPEED = 13; // 世界单位/秒（tick = 10 秒）
const TRUCK_SPEED = 16;
const SCHED_TURN_TICKS = 36; // 计划过站时间 6 分钟，超过即计延误
const MAX_EVENTS = 80;

export interface EngineState {
  scene: Scene;
  graph: Graph;
  seed: number;
  tick: number;
  weatherLevel: number;
  budget: number;
  flights: FlightRT[];
  trucks: TruckRT[];
  events: GameEvent[];
  stats: Stats;
  edgeClaims: Map<string, string>;
  padUse: Map<string, string>; // pad 节点 -> 航班 planId
  arrivalJitter: Map<string, number>; // 种子驱动的航班到达抖动（init 抽取，之后只读）
  finished: boolean;
  actionSeq: number;
}

export function weatherAt(scene: Scene, tick: number): number {
  let level = scene.weather[0]?.level ?? 0;
  for (const seg of scene.weather) {
    if (seg.startTick <= tick) level = seg.level;
    else break;
  }
  return level;
}

export function holdoverTicks(fluid: FluidId, weatherLevel: number): number {
  const f = FLUIDS.find((x) => x.id === fluid)!;
  const mul = WEATHER_LEVELS[weatherLevel].holdoverMul;
  return Math.max(1, Math.round(f.baseHoldover * (60 / TICK_SECONDS) * mul));
}

export function fluidCost(fluid: FluidId, liters: number): number {
  return Math.round(liters * FLUIDS.find((x) => x.id === fluid)!.costPerL);
}

export function createEngine(scene: Scene, seed: number): EngineState {
  const rng = new Rng(seed);
  const trucks: TruckRT[] = scene.trucks.map((t) => ({
    specId: t.id,
    phase: 'idle',
    node: t.depotNode,
    path: [],
    segIdx: 0,
    segProgress: 0,
    targetPad: null,
    fluidL: TRUCK.capacityL,
    shiftLeft: TRUCK.shiftLength,
    workLeft: 0,
    totalServed: 0,
    fluidChoice: 'type4' as FluidId,
  }));
  // 种子唯一的随机消费点：每架航班的到达抖动 ±3 tick，init 一次抽完，
  // step() 不再触碰任何随机源 —— 同种子必然逐 tick 复现。
  const arrivalJitter = new Map<string, number>();
  for (const p of scene.flights) {
    arrivalJitter.set(p.id, Math.max(-Math.floor(p.arrivalTick / 2), rng.int(-3, 3)));
  }
  return {
    scene,
    graph: new Graph(scene.nodes, scene.edges),
    seed,
    tick: 0,
    weatherLevel: weatherAt(scene, 0),
    budget: ECONOMY.initialBudget,
    flights: [],
    trucks,
    events: [],
    stats: { departed: 0, reSprays: 0, delayTicks: 0, fines: 0, fluidCost: 0, opCost: 0, revenue: 0 },
    edgeClaims: new Map(),
    padUse: new Map(),
    arrivalJitter,
    finished: false,
    actionSeq: 0,
  };
}

function pushEvent(s: EngineState, text: string, kind: GameEvent['kind']) {
  s.events.push({ tick: s.tick, text, kind });
  if (s.events.length > MAX_EVENTS) s.events.shift();
}

function findFlight(s: EngineState, id: string): FlightRT | undefined {
  return s.flights.find((f) => f.planId === id);
}
function findTruck(s: EngineState, id: string): TruckRT | undefined {
  return s.trucks.find((t) => t.specId === id);
}

// ---------- 玩家操作 ----------

export function applyAction(s: EngineState, a: Action) {
  s.actionSeq = Math.max(s.actionSeq, a.seq);
  switch (a.type) {
    case 'assignTruck': {
      const t = a.truckId ? findTruck(s, a.truckId) : undefined;
      const f = a.flightId ? findFlight(s, a.flightId) : undefined;
      if (!t || !f || !f.padNode) return;
      if (t.phase === 'refilling' || t.phase === 'swapping' || t.phase === 'working') return;
      if (t.shiftLeft <= 0) return;
      if (t.fluidL < TRUCK.fluidPerPlane) {
        pushEvent(s, `除冰车 ${t.specId} 余量不足，无法派单`, 'warn');
        return;
      }
      const path = s.graph.path(t.node, f.padNode);
      if (!path) return;
      t.targetPad = f.padNode;
      t.path = path;
      t.segIdx = 0;
      t.segProgress = 0;
      t.phase = path.length === 1 ? 'idle' : 'moving';
      break;
    }
    case 'recallTruck': {
      const t = a.truckId ? findTruck(s, a.truckId) : undefined;
      if (!t || t.phase === 'working') return;
      const depot = s.scene.trucks.find((x) => x.id === t.specId)!.depotNode;
      const path = s.graph.path(t.node, depot);
      if (!path) return;
      t.targetPad = null;
      t.path = path;
      t.segIdx = 0;
      t.segProgress = 0;
      t.phase = path.length === 1 ? 'idle' : 'recalled';
      break;
    }
    case 'refillTruck': {
      const t = a.truckId ? findTruck(s, a.truckId) : undefined;
      if (!t) return;
      const depot = s.scene.trucks.find((x) => x.id === t.specId)!.depotNode;
      if (t.node !== depot || t.phase === 'working') return;
      t.phase = 'refilling';
      t.workLeft = TRUCK.refillTicks;
      break;
    }
    case 'swapShift': {
      const t = a.truckId ? findTruck(s, a.truckId) : undefined;
      if (!t) return;
      const depot = s.scene.trucks.find((x) => x.id === t.specId)!.depotNode;
      if (t.node !== depot || t.phase === 'working') return;
      t.phase = 'swapping';
      t.workLeft = TRUCK.swapTicks;
      break;
    }
    case 'assignPad': {
      const f = a.flightId ? findFlight(s, a.flightId) : undefined;
      if (!f || f.phase !== 'queued' || !a.padNode) return;
      if (s.padUse.has(a.padNode)) return;
      const path = s.graph.path(f.node, a.padNode);
      if (!path) return;
      f.padNode = a.padNode;
      f.path = path;
      f.segIdx = 0;
      f.segProgress = 0;
      f.phase = 'toPad';
      break;
    }
    case 'setFluid': {
      const t = a.truckId ? findTruck(s, a.truckId) : undefined;
      if (t && a.fluid) t.fluidChoice = a.fluid;
      break;
    }
    case 'speed':
      // 仅用于回放/UI 同步，引擎本身不消费
      break;
  }
}

// ---------- 移动与边占用 ----------

interface Mover {
  node: string;
  path: string[];
  segIdx: number;
  segProgress: number;
}

function edgeFree(s: EngineState, a: string, b: string, self: string): boolean {
  const occ = s.edgeClaims.get(edgeKey(a, b));
  return occ === undefined || occ === self;
}

// 直接修改实体的移动字段；返回 true 表示本 tick 到达路径终点
function stepMover(s: EngineState, m: Mover, id: string, speed: number): boolean {
  if (m.segIdx >= m.path.length - 1) return true;
  const from = m.path[m.segIdx];
  const to = m.path[m.segIdx + 1];
  if (!edgeFree(s, from, to, id)) {
    // 前方被占：释放已持有的边（首段即当前边，否则为上一段），
    // 避免汇合处互相持有边形成死锁；本 tick 原地等待
    const held = m.segIdx > 0 ? edgeKey(m.path[m.segIdx - 1], from) : edgeKey(from, to);
    s.edgeClaims.delete(held);
    return false;
  }
  const key = edgeKey(from, to);
  if (s.edgeClaims.get(key) !== id) s.edgeClaims.set(key, id);
  const edgeLen = s.graph.dist(from, to);
  // speed 单位为世界单位/秒，每 tick 推进 speed * 10 秒
  m.segProgress += (speed * TICK_SECONDS) / edgeLen;
  while (m.segProgress >= 1) {
    m.segProgress -= 1;
    s.edgeClaims.delete(key);
    m.segIdx += 1;
    m.node = m.path[m.segIdx];
    if (m.segIdx >= m.path.length - 1) {
      m.segProgress = 0;
      return true;
    }
    const nf = m.path[m.segIdx];
    const nt = m.path[m.segIdx + 1];
    if (!edgeFree(s, nf, nt, id)) {
      m.segProgress = 0;
      return false;
    }
    s.edgeClaims.set(edgeKey(nf, nt), id);
  }
  return false;
}

export function moverPos(s: EngineState, node: string, path: string[], segIdx: number, prog: number): Vec {
  if (segIdx >= path.length - 1 || path.length === 0) return s.graph.pos(node);
  const a = s.graph.pos(path[segIdx]);
  const b = s.graph.pos(path[segIdx + 1]);
  return { x: a.x + (b.x - a.x) * prog, y: a.y + (b.y - a.y) * prog };
}

// ---------- 主推进 ----------

export function step(s: EngineState) {
  if (s.finished) return;
  s.tick += 1;
  s.weatherLevel = weatherAt(s.scene, s.tick);

  // 1. 航班 spawn（到达时刻 = 场景计划 + 种子抖动）
  for (const plan of s.scene.flights) {
    const spawnAt = plan.arrivalTick + (s.arrivalJitter.get(plan.id) ?? 0);
    if (spawnAt === s.tick && !s.flights.some((f) => f.planId === plan.id)) {
      s.flights.push({
        planId: plan.id,
        airline: plan.airline,
        vip: plan.vip,
        phase: 'queued',
        node: plan.standNode,
        path: [],
        segIdx: 0,
        segProgress: 0,
        padNode: null,
        fluid: null,
        holdoverLeft: 0,
        deiceLeft: 0,
        spawnTick: s.tick,
        departedTick: null,
        reSprays: 0,
        pressure: plan.vip ? 40 : 0,
        fined: false,
      });
      if (plan.vip) pushEvent(s, `要客航班 ${plan.id} 进入队列，要求优先保障`, 'vip');
    }
  }

  // 2. 航班移动 / 坪位 / 保持时间
  for (const f of s.flights) {
    const plan = s.scene.flights.find((p) => p.id === f.planId)!;
    switch (f.phase) {
      case 'toPad': {
        const arrived = stepMover(s, f, 'F:' + f.planId, FLIGHT_SPEED);
        if (arrived) {
          s.padUse.set(f.padNode!, f.planId);
          f.phase = 'waitingPad';
          f.node = f.padNode!;
        }
        break;
      }
      case 'waitingPad':
        f.node = f.padNode!;
        break;
      case 'deicing':
        f.node = f.padNode!;
        f.deiceLeft -= 1;
        if (f.deiceLeft <= 0) f.deiceLeft = 0;
        break;
      case 'holdover': {
        f.holdoverLeft -= 1;
        if (f.holdoverLeft <= 0) {
          // 保持时间耗尽：必须回坪重喷
          rerouteToPad(s, f) || pushEvent(s, `航班 ${f.planId} 保持时间耗尽，等待空闲坪位`, 'warn');
          break;
        }
        if (f.path.length > 0) {
          const arrived = stepMover(s, f, 'F:' + f.planId, FLIGHT_SPEED);
          if (arrived) {
            f.path = [];
            const phase: string = f.phase;
            if (phase === 'toExit') departFlight(s, f, plan.exitNode);
            else if (phase === 'toPad') {
              s.padUse.set(f.padNode!, f.planId);
              f.phase = 'waitingPad';
              f.node = f.padNode!;
            }
          }
        } else {
          // 刚完成除冰，启动离场滑行
          const path = s.graph.path(f.node, plan.exitNode);
          if (path) {
            s.padUse.delete(f.padNode!);
            f.path = path;
            f.segIdx = 0;
            f.segProgress = 0;
            f.phase = 'toExit';
          }
        }
        break;
      }
      case 'toExit': {
        const arrived = stepMover(s, f, 'F:' + f.planId, FLIGHT_SPEED);
        if (arrived) departFlight(s, f, plan.exitNode);
        break;
      }
    }
  }

  // 3. 除冰车
  for (const t of s.trucks) {
    t.shiftLeft -= 1;
    s.budget -= TRUCK.opCostPerTick;
    s.stats.opCost += TRUCK.opCostPerTick;
    switch (t.phase) {
      case 'moving':
      case 'recalled': {
        const arrived = stepMover(s, t, 'T:' + t.specId, TRUCK_SPEED);
        if (arrived) {
          t.node = t.path[t.path.length - 1];
          t.path = [];
          t.segProgress = 0;
          if (t.phase === 'recalled') {
            t.phase = 'idle';
            if (t.shiftLeft <= 0) beginAutoSwap(s, t);
          } else {
            t.phase = 'idle';
            tryBeginWork(s, t);
          }
        }
        break;
      }
      case 'idle': {
        if (t.shiftLeft <= 0) {
          const depot = s.scene.trucks.find((x) => x.id === t.specId)!.depotNode;
          if (t.node === depot) beginAutoSwap(s, t);
          else {
            const path = s.graph.path(t.node, depot);
            if (path) {
              t.path = path;
              t.segIdx = 0;
              t.segProgress = 0;
              t.phase = 'recalled';
            }
          }
        } else if (t.targetPad) {
          tryBeginWork(s, t);
        }
        break;
      }
      case 'working': {
        t.workLeft -= 1;
        if (t.workLeft <= 0) {
          const f = s.flights.find((x) => x.padNode === t.node && x.phase === 'deicing');
          if (f) finishTruckSpray(s, t, f);
          else {
            t.phase = 'idle';
            t.workLeft = 0;
          }
        }
        break;
      }
      case 'refilling':
        t.workLeft -= 1;
        if (t.workLeft <= 0) {
          t.fluidL = TRUCK.capacityL;
          t.phase = 'idle';
          pushEvent(s, `除冰车 ${t.specId} 加液完成`, 'info');
        }
        break;
      case 'swapping':
        t.workLeft -= 1;
        if (t.workLeft <= 0) {
          t.shiftLeft = TRUCK.shiftLength;
          t.phase = 'idle';
          pushEvent(s, `除冰车 ${t.specId} 换班完成`, 'info');
        }
        break;
    }
  }

  // 4. 催单压力与延误罚则
  for (const f of s.flights) {
    if (f.phase === 'departed') continue;
    const plan = s.scene.flights.find((p) => p.id === f.planId)!;
    if (f.phase === 'queued' || f.phase === 'waitingPad' || f.phase === 'toPad') {
      f.pressure += ECONOMY.pressurePerWaitTick * (f.vip ? 2 : 1);
      if (f.pressure >= ECONOMY.pressureThreshold && !f.fined) {
        f.fined = true;
        const fine = ECONOMY.pressureFine * (f.vip ? 2 : 1);
        s.budget -= fine;
        s.stats.fines += fine;
        pushEvent(s, `${f.vip ? '要客' : ''}航班 ${f.planId} 催单罚则 -¥${fine}`, 'fine');
      }
    }
    const scheduled = plan.arrivalTick + SCHED_TURN_TICKS;
    if (s.tick > scheduled) {
      s.budget -= ECONOMY.delayFinePerTick;
      s.stats.fines += ECONOMY.delayFinePerTick;
      s.stats.delayTicks += 1;
    }
  }

  // 5. 结束判定
  const allDeparted =
    s.scene.flights.length > 0 &&
    s.scene.flights.every((p) => s.flights.some((f) => f.planId === p.id && f.phase === 'departed'));
  if (allDeparted || s.tick >= s.scene.durationTicks) {
    s.finished = true;
    pushEvent(s, '本班次结束', 'info');
  }
}

// ---------- 辅助 ----------

function tryBeginWork(s: EngineState, t: TruckRT) {
  if (!t.targetPad || t.node !== t.targetPad) return;
  const f = s.flights.find((x) => x.padNode === t.node && x.phase === 'waitingPad');
  if (!f) return; // 飞机还没到，车在坪位上等
  if (t.fluidL < TRUCK.fluidPerPlane) {
    pushEvent(s, `除冰车 ${t.specId} 液体不足，需回库加液`, 'warn');
    t.targetPad = null;
    return;
  }
  f.phase = 'deicing';
  f.fluid = t.fluidChoice;
  f.deiceLeft = TRUCK.deiceTicks;
  t.phase = 'working';
  t.workLeft = TRUCK.deiceTicks;
}

function finishTruckSpray(s: EngineState, t: TruckRT, f: FlightRT) {
  const fluid = t.fluidChoice;
  const cost = fluidCost(fluid, TRUCK.fluidPerPlane);
  t.fluidL -= TRUCK.fluidPerPlane;
  s.budget -= cost;
  s.stats.fluidCost += cost;
  f.fluid = fluid;
  f.holdoverLeft = holdoverTicks(fluid, s.weatherLevel);
  f.phase = 'holdover';
  f.deiceLeft = 0;
  t.phase = 'idle';
  t.workLeft = 0;
  t.totalServed += 1;
  t.targetPad = null;
  pushEvent(s, `航班 ${f.planId} 喷洒 ${fluid} 完成，保持 ${f.holdoverLeft} tick`, 'info');
}

function rerouteToPad(s: EngineState, f: FlightRT): boolean {
  const freePad = s.scene.nodes
    .filter((n) => n.kind === 'pad' && !s.padUse.has(n.id))
    .map((n) => ({ n, path: s.graph.path(f.node, n.id) }))
    .filter((x) => x.path !== null)
    .sort((a, b) => a.path!.length - b.path!.length)[0];
  if (!freePad) return false;
  f.reSprays += 1;
  s.stats.reSprays += 1;
  f.padNode = freePad.n.id;
  f.path = freePad.path!;
  f.segIdx = 0;
  f.segProgress = 0;
  f.phase = 'toPad';
  pushEvent(s, `航班 ${f.planId} 保持时间失效，改派坪位 ${freePad.n.id} 重喷`, 'warn');
  return true;
}

function departFlight(s: EngineState, f: FlightRT, exitNode: string) {
  if (f.node !== exitNode) return;
  f.phase = 'departed';
  f.departedTick = s.tick;
  s.stats.departed += 1;
  const reward = Math.round(f.fluid ? fluidCost(f.fluid, TRUCK.fluidPerPlane) * (1 + ECONOMY.deiceRewardRate) : 0);
  s.budget += reward;
  s.stats.revenue += reward;
  pushEvent(s, `航班 ${f.planId} 离场，服务费 +¥${reward}`, 'info');
}

function beginAutoSwap(s: EngineState, t: TruckRT) {
  t.phase = 'swapping';
  t.workLeft = TRUCK.swapTicks;
  pushEvent(s, `除冰车 ${t.specId} 班次耗尽，强制换班`, 'warn');
}

// ---------- 快照与校验和 ----------

export function snapshot(s: EngineState) {
  const parts: unknown[] = [
    s.tick,
    s.weatherLevel,
    Math.round(s.budget),
    s.flights.map((f) => [f.planId, f.phase, f.node, f.padNode ?? '', f.segIdx, Math.round(f.segProgress * 1000), f.holdoverLeft, Math.round(f.pressure)]),
    s.trucks.map((t) => [t.specId, t.phase, t.node, t.segIdx, Math.round(t.segProgress * 1000), Math.round(t.fluidL), t.shiftLeft, t.workLeft]),
    [...s.edgeClaims.entries()].sort(),
    [...s.padUse.entries()].sort(),
    s.stats,
  ];
  const json = JSON.stringify(parts);
  let h = 2166136261 >>> 0;
  for (let i = 0; i < json.length; i++) {
    h ^= json.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return {
    tick: s.tick,
    weatherLevel: s.weatherLevel,
    budget: s.budget,
    flights: s.flights,
    trucks: s.trucks,
    events: s.events,
    stats: s.stats,
    edgeClaims: Object.fromEntries(s.edgeClaims),
    checksum: h >>> 0,
  };
}
