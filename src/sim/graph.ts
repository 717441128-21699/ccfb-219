import type { GraphEdge, GraphNode, Scene, Vec } from '../types';

// 无向边的规范化键
export function edgeKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

export class Graph {
  nodes = new Map<string, GraphNode>();
  adj = new Map<string, string[]>();

  constructor(nodes: GraphNode[], edges: GraphEdge[]) {
    for (const n of nodes) this.nodes.set(n.id, { ...n });
    for (const n of nodes) this.adj.set(n.id, []);
    for (const e of edges) {
      if (!this.nodes.has(e.a) || !this.nodes.has(e.b)) continue;
      this.adj.get(e.a)!.push(e.b);
      this.adj.get(e.b)!.push(e.a);
    }
    // 邻接表排序，保证遍历顺序确定
    for (const list of this.adj.values()) list.sort();
  }

  pos(id: string): Vec {
    const n = this.nodes.get(id)!;
    return { x: n.x, y: n.y };
  }

  dist(a: string, b: string): number {
    const pa = this.pos(a);
    const pb = this.pos(b);
    return Math.hypot(pa.x - pb.x, pa.y - pb.y);
  }

  // Dijkstra（边权 = 欧氏距离），返回节点 id 路径；不可达返回 null
  path(from: string, to: string, blocked: Set<string> = new Set()): string[] | null {
    if (from === to) return [from];
    const dist = new Map<string, number>([[from, 0]]);
    const prev = new Map<string, string>();
    const visited = new Set<string>();
    while (true) {
      let u: string | null = null;
      let best = Infinity;
      for (const [id, d] of dist) {
        if (!visited.has(id) && d < best) {
          best = d;
          u = id;
        }
      }
      if (u === null) return null;
      if (u === to) break;
      visited.add(u);
      for (const v of this.adj.get(u) ?? []) {
        if (blocked.has(v) && v !== to) continue;
        const nd = best + this.dist(u, v);
        if (nd < (dist.get(v) ?? Infinity)) {
          dist.set(v, nd);
          prev.set(v, u);
        }
      }
    }
    const out: string[] = [];
    let cur: string | undefined = to;
    while (cur !== undefined) {
      out.push(cur);
      cur = prev.get(cur);
    }
    return out.reverse();
  }
}

export function nodeById(scene: Scene, id: string): GraphNode | undefined {
  return scene.nodes.find((n) => n.id === id);
}

export function padsOf(scene: Scene): GraphNode[] {
  return scene.nodes.filter((n) => n.kind === 'pad');
}

export function validateScene(scene: Scene): string[] {
  const errs: string[] = [];
  const ids = new Set<string>();
  for (const n of scene.nodes) {
    if (ids.has(n.id)) errs.push(`节点 id 重复: ${n.id}`);
    ids.add(n.id);
  }
  const g = new Graph(scene.nodes, scene.edges);
  for (const e of scene.edges) {
    if (!ids.has(e.a) || !ids.has(e.b)) errs.push(`边引用了不存在的节点: ${e.a}-${e.b}`);
  }
  if (!scene.nodes.some((n) => n.kind === 'depot')) errs.push('缺少加液站(depot)节点');
  if (!scene.nodes.some((n) => n.kind === 'exit')) errs.push('缺少离场(exit)节点');
  if (padsOf(scene).length === 0) errs.push('缺少除冰坪(pad)节点');
  for (const f of scene.flights) {
    if (!ids.has(f.standNode)) errs.push(`航班 ${f.id} 的机位节点不存在`);
    if (!ids.has(f.exitNode)) errs.push(`航班 ${f.id} 的离场节点不存在`);
    const p = g.path(f.standNode, f.exitNode);
    if (!p) errs.push(`航班 ${f.id} 从机位到离场无连通路径`);
  }
  for (const t of scene.trucks) {
    if (!ids.has(t.depotNode)) errs.push(`除冰车 ${t.id} 的车库节点不存在`);
  }
  if (scene.weather.length === 0) errs.push('缺少天气分段');
  return errs;
}
