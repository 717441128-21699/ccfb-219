import { SCENE_VERSION } from '../config';
import type { Scene } from '../types';

// 默认场景：两机位、两除冰坪、单加液站、单离场口，3 辆除冰车
export function defaultScene(): Scene {
  const nodes = [
    { id: 'stand1', x: 120, y: 480, kind: 'stand' as const },
    { id: 'stand2', x: 120, y: 360, kind: 'stand' as const },
    { id: 'j1', x: 320, y: 420, kind: 'taxi' as const },
    { id: 'j2', x: 520, y: 420, kind: 'taxi' as const },
    { id: 'pad1', x: 560, y: 250, kind: 'pad' as const },
    { id: 'pad2', x: 720, y: 250, kind: 'pad' as const },
    { id: 'depot', x: 340, y: 150, kind: 'depot' as const },
    { id: 'exit', x: 880, y: 420, kind: 'exit' as const },
  ];
  const edges = [
    { a: 'stand1', b: 'j1' },
    { a: 'stand2', b: 'j1' },
    { a: 'j1', b: 'j2' },
    { a: 'j2', b: 'pad1' },
    { a: 'j2', b: 'pad2' },
    { a: 'j1', b: 'depot' },
    { a: 'j2', b: 'exit' },
  ];
  const airlines = ['北雁航空', '松林航空', '蓝港航空', '极星货运'];
  const flights = Array.from({ length: 32 }, (_, i) => ({
    id: 'F' + String(i + 1).padStart(3, '0'),
    airline: airlines[i % airlines.length],
    arrivalTick: 5 + i * 7 + (i % 3) * 2,
    standNode: i % 2 === 0 ? 'stand1' : 'stand2',
    exitNode: 'exit',
    vip: i === 5 || i === 11 || i === 17 || i === 25,
  }));
  const weather = [
    { startTick: 0, level: 1 },
    { startTick: 30, level: 2 },
    { startTick: 70, level: 3 },
    { startTick: 140, level: 3 },
    { startTick: 210, level: 2 },
    { startTick: 260, level: 1 },
  ];
  const trucks = [
    { id: 'T1', depotNode: 'depot' },
    { id: 'T2', depotNode: 'depot' },
    { id: 'T3', depotNode: 'depot' },
  ];
  return {
    version: SCENE_VERSION,
    name: '霜湾机场 · 标准夜班',
    durationTicks: 360,
    nodes,
    edges,
    flights,
    weather,
    trucks,
  };
}
