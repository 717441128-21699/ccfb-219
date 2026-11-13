import type { Action, Scene, Stats } from '../types';
import { createEngine, step, applyAction, snapshot } from './engine';
import { chooseFluid, policyActions } from './policy';

export interface SimOutcome {
  seed: number;
  stats: Stats;
  finalBudget: number;
  ticks: number;
  actionCount: number;
  finished: boolean;
}

export interface BatchReport {
  runs: SimOutcome[];
  delayTicks: Distribution;
  budget: Distribution;
  fines: Distribution;
  reSprays: Distribution;
  departedRate: number;
  meanChecksum: number;
}

export interface Distribution {
  min: number;
  p10: number;
  median: number;
  p90: number;
  max: number;
  mean: number;
}

function dist(values: number[]): Distribution {
  const sorted = [...values].sort((a, b) => a - b);
  const q = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
  const mean = values.reduce((a, b) => a + b, 0) / Math.max(1, values.length);
  return { min: sorted[0] ?? 0, p10: q(0.1), median: q(0.5), p90: q(0.9), max: sorted[sorted.length - 1] ?? 0, mean: Math.round(mean) };
}

// 单局：策略自动操作，完整动作流也一并返回（可保存为录像）
export function simulateOne(scene: Scene, seed: number): SimOutcome & { actions: Action[]; checksum: number } {
  const s = createEngine(scene, seed);
  const actions: Action[] = [];
  let seq = 0;
  while (!s.finished) {
    const batch = policyActions(s, seq);
    for (const a of batch) {
      actions.push(a);
      applyAction(s, a);
    }
    seq += batch.length;
    // 每 60 tick 根据天气调整所有空闲车的液体选择
    if (s.tick % 60 === 0) {
      const fluid = chooseFluid(scene, s.weatherLevel);
      for (const t of s.trucks) {
        if (t.fluidChoice !== fluid) {
          const a: Action = { tick: s.tick, seq: seq++, type: 'setFluid', truckId: t.specId, fluid };
          actions.push(a);
          applyAction(s, a);
        }
      }
    }
    step(s);
  }
  return {
    seed,
    stats: structuredClone(s.stats),
    finalBudget: Math.round(s.budget),
    ticks: s.tick,
    actionCount: actions.length,
    finished: s.finished,
    actions,
    checksum: snapshot(s).checksum,
  };
}

// 批量跑 N 局（每局不同种子），产出分布
export function simulateBatch(scene: Scene, count: number, baseSeed = 20260101): BatchReport {
  const runs: SimOutcome[] = [];
  const checksums: number[] = [];
  for (let i = 0; i < count; i++) {
    const r = simulateOne(scene, (baseSeed + i * 7919) >>> 0);
    runs.push({ seed: r.seed, stats: r.stats, finalBudget: r.finalBudget, ticks: r.ticks, actionCount: r.actionCount, finished: r.finished });
    checksums.push(r.checksum);
  }
  const totalPlanned = scene.flights.length || 1;
  const departed = runs.reduce((a, r) => a + r.stats.departed, 0) / (runs.length * totalPlanned);
  return {
    runs,
    delayTicks: dist(runs.map((r) => r.stats.delayTicks)),
    budget: dist(runs.map((r) => r.finalBudget)),
    fines: dist(runs.map((r) => r.stats.fines)),
    reSprays: dist(runs.map((r) => r.stats.reSprays)),
    departedRate: departed,
    meanChecksum: checksums.reduce((a, b) => a + b, 0) / Math.max(1, checksums.length),
  };
}
