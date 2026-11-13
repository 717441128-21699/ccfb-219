import { COLORS, WEATHER_LEVELS, WORLD_H, WORLD_W } from '../config';
import type { EngineState } from './engine';
import { moverPos } from './engine';
import type { FlightRT, Scene, TruckRT, Vec } from '../types';
import type { Rng } from './rng';

// 确定性雪粒：粒子按 tick 推演，不依赖 Math.random
interface Flake {
  x: number;
  y: number;
  speed: number;
  drift: number;
  size: number;
}

export class Renderer {
  ctx: CanvasRenderingContext2D;
  flakes: Flake[] = [];

  constructor(public canvas: HTMLCanvasElement, rng: Rng) {
    this.ctx = canvas.getContext('2d')!;
    for (let i = 0; i < 140; i++) {
      this.flakes.push({
        x: rng.int(0, WORLD_W),
        y: rng.int(0, WORLD_H),
        speed: rng.int(6, 16) / 10,
        drift: rng.int(-4, 4) / 10,
        size: rng.int(12, 26) / 10,
      });
    }
  }

  resize() {
    const dpr = window.devicePixelRatio || 1;
    const rect = this.canvas.getBoundingClientRect();
    this.canvas.width = Math.round(rect.width * dpr);
    this.canvas.height = Math.round(rect.height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  worldFromEvent(ev: MouseEvent): Vec {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: ((ev.clientX - rect.left) / rect.width) * WORLD_W,
      y: ((ev.clientY - rect.top) / rect.height) * WORLD_H,
    };
  }

  drawScene(scene: Scene) {
    const ctx = this.ctx;
    ctx.fillStyle = COLORS.apron;
    ctx.fillRect(0, 0, WORLD_W, WORLD_H);
    // 滑行道
    ctx.lineCap = 'round';
    ctx.strokeStyle = COLORS.taxi;
    ctx.lineWidth = 14;
    for (const e of scene.edges) {
      const a = scene.nodes.find((n) => n.id === e.a)!;
      const b = scene.nodes.find((n) => n.id === e.b)!;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
    ctx.setLineDash([6, 8]);
    ctx.strokeStyle = 'rgba(255,255,255,.35)';
    ctx.lineWidth = 1.5;
    for (const e of scene.edges) {
      const a = scene.nodes.find((n) => n.id === e.a)!;
      const b = scene.nodes.find((n) => n.id === e.b)!;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    // 节点
    for (const n of scene.nodes) this.drawNode(n.kind, n.x, n.y, n.id);
  }

  private drawNode(kind: string, x: number, y: number, label: string) {
    const ctx = this.ctx;
    ctx.font = '10px monospace';
    ctx.textAlign = 'center';
    if (kind === 'pad') {
      ctx.fillStyle = COLORS.pad;
      ctx.fillRect(x - 26, y - 20, 52, 40);
      ctx.strokeStyle = COLORS.taxi;
      ctx.lineWidth = 2;
      ctx.strokeRect(x - 26, y - 20, 52, 40);
    } else if (kind === 'depot') {
      ctx.fillStyle = COLORS.depot;
      ctx.beginPath();
      ctx.arc(x, y, 18, 0, Math.PI * 2);
      ctx.fill();
    } else if (kind === 'exit') {
      ctx.fillStyle = COLORS.exit;
      ctx.beginPath();
      ctx.moveTo(x, y - 16);
      ctx.lineTo(x + 14, y + 12);
      ctx.lineTo(x - 14, y + 12);
      ctx.closePath();
      ctx.fill();
    } else if (kind === 'stand') {
      ctx.fillStyle = COLORS.stand;
      ctx.fillRect(x - 20, y - 16, 40, 32);
    } else {
      ctx.fillStyle = COLORS.taxi;
      ctx.beginPath();
      ctx.arc(x, y, 5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = COLORS.text;
    ctx.fillText(label, x, y + (kind === 'pad' ? 34 : 28));
  }

  draw(s: EngineState, selected: { flight?: string; truck?: string; pad?: string }) {
    const ctx = this.ctx;
    const wl = WEATHER_LEVELS[s.weatherLevel];
    ctx.fillStyle = wl.color;
    ctx.fillRect(0, 0, WORLD_W, WORLD_H);
    this.drawScene(s.scene);

    // 高亮选中坪位
    if (selected.pad) {
      const n = s.scene.nodes.find((x) => x.id === selected.pad);
      if (n) {
        ctx.strokeStyle = '#ffd166';
        ctx.lineWidth = 3;
        ctx.strokeRect(n.x - 28, n.y - 22, 56, 44);
      }
    }
    // 占用中的滑行道标红
    for (const [key, who] of s.edgeClaims) {
      const [a, b] = key.split('|');
      const pa = s.graph.pos(a);
      const pb = s.graph.pos(b);
      ctx.strokeStyle = who.startsWith('F:') ? 'rgba(239,111,108,.5)' : 'rgba(255,209,102,.5)';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(pa.x, pa.y);
      ctx.lineTo(pb.x, pb.y);
      ctx.stroke();
    }

    for (const f of s.flights) {
      if (f.phase === 'departed') continue;
      const p = moverPos(s, f.node, f.path, f.segIdx, f.segProgress);
      this.drawFlight(f, p, selected.flight === f.planId);
    }
    for (const t of s.trucks) {
      const p = moverPos(s, t.node, t.path, t.segIdx, t.segProgress);
      this.drawTruck(t, p, selected.truck === t.specId);
    }
    this.drawSnow(s.weatherLevel, s.tick);
  }

  private drawFlight(f: FlightRT, p: Vec, selected: boolean) {
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(p.x, p.y);
    // 机身：矢量三角 + 尾翼
    ctx.fillStyle = f.vip ? COLORS.vip : COLORS.flight;
    ctx.beginPath();
    ctx.moveTo(14, 0);
    ctx.lineTo(-10, -9);
    ctx.lineTo(-6, 0);
    ctx.lineTo(-10, 9);
    ctx.closePath();
    ctx.fill();
    if (selected) {
      ctx.strokeStyle = '#ffd166';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    ctx.fillStyle = COLORS.text;
    ctx.font = '9px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(f.planId, 0, -14);
    if (f.phase === 'holdover') {
      const ratio = Math.max(0, Math.min(1, f.holdoverLeft / 30));
      ctx.fillStyle = 'rgba(0,0,0,.5)';
      ctx.fillRect(-14, 12, 28, 4);
      ctx.fillStyle = ratio > 0.4 ? COLORS.truck : COLORS.warn;
      ctx.fillRect(-14, 12, 28 * ratio, 4);
    }
    if (f.vip) {
      ctx.fillStyle = COLORS.vip;
      ctx.fillText('VIP', 0, 22);
    }
    ctx.restore();
  }

  private drawTruck(t: TruckRT, p: Vec, selected: boolean) {
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.fillStyle = t.phase === 'working' ? '#ffd166' : COLORS.truck;
    ctx.fillRect(-8, -6, 16, 12);
    ctx.fillStyle = '#101826';
    ctx.fillRect(2, -4, 5, 8);
    if (selected) {
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.strokeRect(-9, -7, 18, 14);
    }
    // 液量小条
    ctx.fillStyle = 'rgba(0,0,0,.5)';
    ctx.fillRect(-10, -12, 20, 3);
    ctx.fillStyle = '#5ab1ef';
    ctx.fillRect(-10, -12, 20 * (t.fluidL / 2000), 3);
    ctx.fillStyle = COLORS.text;
    ctx.font = '9px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(t.specId, 0, 18);
    if (t.shiftLeft <= 60) {
      ctx.fillStyle = COLORS.warn;
      ctx.fillText('换班!', 0, -18);
    }
    ctx.restore();
  }

  private drawSnow(level: number, tick: number) {
    const density = WEATHER_LEVELS[level].snow;
    if (density === 0) return;
    const ctx = this.ctx;
    ctx.fillStyle = 'rgba(255,255,255,.8)';
    const count = Math.floor(this.flakes.length * density);
    for (let i = 0; i < count; i++) {
      const f = this.flakes[i];
      const y = (f.y + f.speed * tick) % WORLD_H;
      const x = (f.x + f.drift * tick + WORLD_W) % WORLD_W;
      ctx.beginPath();
      ctx.arc(x, y, f.size, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // 编辑器用：静态场景 + 可选悬停
  drawEditor(scene: Scene, hoverId: string | null, mode: string) {
    const ctx = this.ctx;
    ctx.fillStyle = '#16212f';
    ctx.fillRect(0, 0, WORLD_W, WORLD_H);
    this.drawScene(scene);
    if (hoverId) {
      const n = scene.nodes.find((x) => x.id === hoverId);
      if (n) {
        ctx.strokeStyle = mode === 'edge' ? '#ffd166' : '#ef6f6c';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(n.x, n.y, 24, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  }
}
