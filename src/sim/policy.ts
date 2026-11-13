import type { Action, Scene } from '../types';
import type { EngineState } from './engine';
import { TRUCK } from '../config';

// 自动调度策略：供平衡模拟器批量跑局使用，也可作为玩家的对照基线。
// 策略本身只读取引擎状态并产出动作，不直接改引擎，保证与人工操作走同一条确定性路径。

export function policyActions(s: EngineState, seqStart: number): Action[] {
  const out: Action[] = [];
  let seq = seqStart;
  const at = (a: Omit<Action, 'tick' | 'seq'>): Action => ({ tick: s.tick, seq: seq++, ...a });

  const usedPads = new Set<string>();
  for (const f of s.flights) {
    if (f.phase === 'toPad' || f.phase === 'waitingPad' || f.phase === 'deicing' || f.phase === 'holdover') {
      if (f.padNode) usedPads.add(f.padNode);
    }
  }

  // VIP 优先：队列中要客排前
  const queue = s.flights
    .filter((f) => f.phase === 'queued')
    .sort((a, b) => Number(b.vip) - Number(a.vip) || a.spawnTick - b.spawnTick);

  for (const f of queue) {
    const free = s.scene.nodes
      .filter((n) => n.kind === 'pad' && !usedPads.has(n.id))
      .map((n) => ({ id: n.id, path: s.graph.path(f.node, n.id) }))
      .filter((x) => x.path !== null)
      .sort((a, b) => a.path!.length - b.path!.length)[0];
    if (free) {
      usedPads.add(free.id);
      out.push(at({ type: 'assignPad', flightId: f.planId, padNode: free.id }));
    }
  }

  // 派车：优先服务有车可到的等待坪位
  const busyTrucks = new Set(
    s.trucks.filter((t) => t.phase === 'moving' || t.phase === 'working').map((t) => t.specId),
  );
  const waitingPads = s.flights
    .filter((f) => f.phase === 'waitingPad')
    .sort((a, b) => Number(b.vip) - Number(a.vip) || a.spawnTick - b.spawnTick)
    .map((f) => f.padNode!)
    .filter((v, i, arr) => arr.indexOf(v) === i);

  for (const pad of waitingPads) {
    const candidate = s.trucks
      .filter((t) => !busyTrucks.has(t.specId) && t.shiftLeft > TRUCK.deiceTicks + 4 && t.fluidL >= TRUCK.fluidPerPlane)
      .map((t) => ({ t, path: s.graph.path(t.node, pad) }))
      .filter((x) => x.path !== null)
      .sort((a, b) => a.path!.length - b.path!.length)[0];
    if (candidate) {
      const flight = s.flights.find((f) => f.padNode === pad && f.phase === 'waitingPad');
      busyTrucks.add(candidate.t.specId);
      out.push(at({ type: 'assignTruck', truckId: candidate.t.specId, flightId: flight!.planId }));
    }
  }

  // 维护：低液回库加液；班次临近结束回库换班
  for (const t of s.trucks) {
    if (t.phase !== 'idle') continue;
    const depot = s.scene.trucks.find((x) => x.id === t.specId)!.depotNode;
    if (t.fluidL < TRUCK.fluidPerPlane) {
      if (t.node === depot) out.push(at({ type: 'refillTruck', truckId: t.specId }));
      else out.push(at({ type: 'recallTruck', truckId: t.specId }));
    } else if (t.shiftLeft <= TRUCK.shiftWarn) {
      if (t.node === depot) out.push(at({ type: 'swapShift', truckId: t.specId }));
      else out.push(at({ type: 'recallTruck', truckId: t.specId }));
    }
  }
  return out;
}

// 暴雪自动升级液体型号（演示配置驱动决策）
export function chooseFluid(scene: Scene, weatherLevel: number): Action['fluid'] {
  void scene;
  if (weatherLevel >= 3) return 'type4p';
  if (weatherLevel === 2) return 'type4';
  return 'type1';
}
