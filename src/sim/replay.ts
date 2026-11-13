import type { Action, Scene } from '../types';
import { applyAction, createEngine, snapshot, step, type EngineState } from './engine';

export interface RunResult {
  engine: EngineState;
  checksums: { tick: number; checksum: number }[];
}

// 按 (tick, seq) 排序动作；同种子同动作流逐 tick 复现
export function sortActions(actions: Action[]): Action[] {
  return [...actions].sort((a, b) => a.tick - b.tick || a.seq - b.seq);
}

export function runToEnd(scene: Scene, seed: number, actions: Action[], checkpointEvery = 30): RunResult {
  const engine = createEngine(scene, seed);
  const ordered = sortActions(actions);
  const checksums: { tick: number; checksum: number }[] = [];
  let idx = 0;
  while (!engine.finished) {
    while (idx < ordered.length && ordered[idx].tick <= engine.tick) {
      applyAction(engine, ordered[idx]);
      idx++;
    }
    step(engine);
    if (engine.tick % checkpointEvery === 0) {
      checksums.push({ tick: engine.tick, checksum: snapshot(engine).checksum });
    }
  }
  return { engine, checksums };
}

// 校验两次运行（如录像回放 vs 原局）逐检查点一致
export function verifyReplay(a: RunResult, b: RunResult): boolean {
  if (a.checksums.length !== b.checksums.length) return false;
  return a.checksums.every((c, i) => c.tick === b.checksums[i].tick && c.checksum === b.checksums[i].checksum);
}

// 把动作流编码为紧凑文本（录像导出）
export function encodeReplay(seed: number, sceneName: string, actions: Action[]): string {
  const rows = sortActions(actions).map((a) =>
    [a.tick, a.seq, a.type, a.truckId ?? '', a.flightId ?? '', a.padNode ?? '', a.fluid ?? '', a.speed ?? ''].join(','),
  );
  return ['REPLAY1', seed, sceneName, ...rows].join('\n');
}

export function decodeReplay(text: string): { seed: number; sceneName: string; actions: Action[] } {
  const lines = text.trim().split(/\r?\n/);
  if (lines[0] !== 'REPLAY1') throw new Error('录像格式无法识别');
  const seed = Number(lines[1]);
  const sceneName = lines[2];
  const actions: Action[] = lines.slice(3).filter(Boolean).map((line) => {
    const [tick, seq, type, truckId, flightId, padNode, fluid, speed] = line.split(',');
    return {
      tick: Number(tick),
      seq: Number(seq),
      type: type as Action['type'],
      truckId: truckId || undefined,
      flightId: flightId || undefined,
      padNode: padNode || undefined,
      fluid: (fluid || undefined) as Action['fluid'],
      speed: speed ? Number(speed) : undefined,
    };
  });
  return { seed, sceneName, actions };
}
