// 迁移测试辅助：构造 v1 旧档结构，走 storage 的内部迁移逻辑。
// storage.ts 依赖 localStorage，这里用最小内存桩替代。
class MemStorage {
  private m = new Map<string, string>();
  getItem(k: string) { return this.m.get(k) ?? null; }
  setItem(k: string, v: string) { this.m.set(k, v); }
  removeItem(k: string) { this.m.delete(k); }
  clear() { this.m.clear(); }
}

export async function migrateViaStorage() {
  (globalThis as unknown as { localStorage: MemStorage }).localStorage = new MemStorage();
  const storage = await import('../src/sim/storage');
  const v1 = [
    {
      version: 1,
      savedAt: '2026-01-01T00:00:00.000Z',
      seed: 99,
      scene: {
        version: 1,
        name: '旧版场景',
        durationTicks: 120,
        nodes: [
          { id: 'stand1', x: 0, y: 0, kind: 'stand' },
          { id: 'exit', x: 100, y: 0, kind: 'exit' },
        ],
        edges: [{ a: 'stand1', b: 'exit' }],
        flights: [],
        // 故意缺 weather
        trucks: [{ id: 'T1', depotNode: 'stand1' }],
      },
      // 故意缺 seq
      actions: [{ tick: 0, type: 'speed', speed: 2 }],
      tick: 5,
      label: '旧档',
    },
  ];
  localStorage.setItem('frostbay.saves.v1', JSON.stringify(v1));
  const saves = storage.listSaves();
  if (saves.length !== 1) throw new Error('迁移后存档数量异常');
  return saves[0];
}
