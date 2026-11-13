/*  node --import tsx 脚本（npm run selftest）：
 *  1. 同种子同动作流两次运行校验和完全一致
 *  2. 不同种子产生不同结果
 *  3. 录像编码/解码往返一致
 *  4. 平衡模拟器批量跑局可完成且分布合理
 *  5. 存档 v1/v2 迁移到当前版本可读
 */
import assert from 'node:assert';
import { defaultScene } from '../src/sim/defaultScene';
import { createEngine, snapshot, step, applyAction } from '../src/sim/engine';
import { decodeReplay, encodeReplay, runToEnd } from '../src/sim/replay';
import { simulateBatch, simulateOne } from '../src/sim/balancer';
import type { Action } from '../src/types';
import { SAVE_VERSION } from '../src/config';

function scriptedActions(seed: number): Action[] {
  // 一个确定性的简单人工操作流：轮询把排队航班派到坪位、派空闲车
  const s = createEngine(defaultScene(), seed);
  const out: Action[] = [];
  let seq = 0;
  const emit = (a: Omit<Action, 'tick' | 'seq'>) => out.push({ tick: s.tick, seq: seq++, ...a });
  while (!s.finished) {
    const usedPads = new Set(s.flights.filter((f) => f.padNode && f.phase !== 'departed').map((f) => f.padNode!));
    for (const f of s.flights.filter((x) => x.phase === 'queued')) {
      const pad = s.scene.nodes.find((n) => n.kind === 'pad' && !usedPads.has(n.id));
      if (pad) { usedPads.add(pad.id); emit({ type: 'assignPad', flightId: f.planId, padNode: pad.id }); applyAction(s, { tick: s.tick, seq: seq - 1, type: 'assignPad', flightId: f.planId, padNode: pad.id }); }
    }
    const busy = new Set<string>();
    for (const f of s.flights.filter((x) => x.phase === 'waitingPad')) {
      const t = s.trucks.find((x) => (x.phase === 'idle') && !busy.has(x.specId) && x.fluidL >= 320);
      if (t) { busy.add(t.specId); emit({ type: 'assignTruck', truckId: t.specId, flightId: f.planId }); applyAction(s, { tick: s.tick, seq: seq - 1, type: 'assignTruck', truckId: t.specId, flightId: f.planId }); }
    }
    for (const t of s.trucks) {
      if (t.phase === 'idle' && t.fluidL < 320) {
        const depot = s.scene.trucks.find((x) => x.id === t.specId)!.depotNode;
        if (t.node === depot) { emit({ type: 'refillTruck', truckId: t.specId }); applyAction(s, { tick: s.tick, seq: seq - 1, type: 'refillTruck', truckId: t.specId }); }
        else { emit({ type: 'recallTruck', truckId: t.specId }); applyAction(s, { tick: s.tick, seq: seq - 1, type: 'recallTruck', truckId: t.specId }); }
      }
    }
    step(s);
  }
  return out;
}

console.log('1) 确定性复现测试…');
const scene = defaultScene();
const seed = 424242;
const actions = scriptedActions(seed);
const run1 = runToEnd(scene, seed, actions);
const run2 = runToEnd(structuredClone(scene), seed, structuredClone(actions));
assert.strictEqual(snapshot(run1.engine).checksum, snapshot(run2.engine).checksum, '同种子同动作流校验和不一致');
assert.deepStrictEqual(run1.checksums, run2.checksums, '检查点序列不一致');
console.log('   ✓ 两次运行逐检查点一致，终局预算', run1.engine.budget);

console.log('2) 不同种子发散测试…');
const other = runToEnd(scene, seed + 1, actions);
assert.notStrictEqual(snapshot(run1.engine).checksum, snapshot(other.engine).checksum, '不同种子结果不应相同');
console.log('   ✓ 种子改变导致结果发散');

console.log('3) 录像编解码往返…');
const text = encodeReplay(seed, scene.name, actions);
const rec = decodeReplay(text);
assert.strictEqual(rec.seed, seed);
assert.strictEqual(rec.actions.length, actions.length);
const run3 = runToEnd(scene, rec.seed, rec.actions);
assert.strictEqual(snapshot(run3.engine).checksum, snapshot(run1.engine).checksum, '录像回放不一致');
console.log('   ✓ 录像解码后回放校验和一致，动作数', actions.length);

console.log('4) 平衡模拟器批量 60 局…');
const report = simulateBatch(scene, 60);
assert.strictEqual(run1 ? report.runs.length : 0, 60);
assert.ok(report.budget.max >= report.budget.min);
assert.ok(report.departedRate > 0 && report.departedRate <= 1);
console.log('   ✓ 预算分布', report.budget);
console.log('   ✓ 保障率', (report.departedRate * 100).toFixed(1) + '%', '中位延误', report.delayTicks.median);

console.log('5) 单局结果可完成…');
const one = simulateOne(scene, 777);
assert.ok(one.finished);
assert.ok(one.stats.departed > 0);
console.log('   ✓ 自动策略离场', one.stats.departed, '架，重喷', one.stats.reSprays, '次');

console.log('6) 存档迁移（v1 -> v' + SAVE_VERSION + '）…');
const { migrateViaStorage } = await import('./migrate-test.ts');
const migrated = await migrateViaStorage();
assert.strictEqual(migrated.version, SAVE_VERSION);
assert.ok(Array.isArray(migrated.scene.weather));
assert.ok(migrated.actions.every((a: Action) => typeof a.seq === 'number'));
console.log('   ✓ 旧档迁移成功，版本', migrated.version);

console.log('\n全部自检通过 ✅');
