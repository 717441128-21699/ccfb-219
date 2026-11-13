import { SCENE_VERSION, WORLD_W } from '../config';
import { validateScene } from '../sim/graph';
import { Rng } from '../sim/rng';
import { Renderer } from '../sim/renderer';
import type { FlightPlan, GraphNode, Scene } from '../types';
import { h, fmtTick } from './dom';
import type { Route } from './app';
import { asScene, exportJSON, importJSON } from '../sim/storage';
import { pushToast } from './game';

type Mode = 'select' | 'node' | 'edge' | 'erase';
type NodeKind = GraphNode['kind'];

export function editorScreen(go: (r: Route) => void, root: HTMLElement, route: Extract<Route, { page: 'editor' }>) {
  const scene: Scene = structuredClone(route.scene);
  scene.version = SCENE_VERSION;
  let mode: Mode = 'select';
  let nodeKind: NodeKind = 'taxi';
  let edgeFirst: string | null = null;
  let hoverId: string | null = null;
  let dragId: string | null = null;
  let nodeCounter = scene.nodes.length;

  const rng = new Rng(1234);
  const canvas = h('canvas', { class: 'editor-canvas' }) as HTMLCanvasElement;
  const renderer = new Renderer(canvas, rng);
  const toolbar = h('div', { class: 'editor-toolbar' });
  const table = h('div', { class: 'editor-table' });

  root.append(
    h('div', { class: 'editor-layout' },
      h('div', { class: 'editor-left' }, toolbar, canvas),
      table,
    ),
  );
  renderer.resize();
  window.addEventListener('resize', onResize);
  function onResize() { renderer.resize(); }

  function redraw() {
    renderer.drawEditor(scene, hoverId, mode);
    if (edgeFirst) {
      const n = scene.nodes.find((x) => x.id === edgeFirst)!;
      const ctx = renderer.ctx;
      ctx.strokeStyle = '#ffd166';
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.arc(n.x, n.y, 26, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  function nodeAt(p: { x: number; y: number }): GraphNode | undefined {
    return scene.nodes.find((n) => Math.hypot(n.x - p.x, n.y - p.y) < 22);
  }

  canvas.addEventListener('mousedown', (ev) => {
    const p = renderer.worldFromEvent(ev);
    const n = nodeAt(p);
    if (mode === 'node') {
      if (n) return;
      const id = `${nodeKind}${++nodeCounter}`;
      scene.nodes.push({ id, x: clamp(p.x), y: clamp(p.y), kind: nodeKind });
      redraw();
    } else if (mode === 'edge') {
      if (!n) return;
      if (!edgeFirst) edgeFirst = n.id;
      else if (edgeFirst !== n.id) {
        const key = [edgeFirst, n.id].sort().join('|');
        const exists = scene.edges.some((e) => [e.a, e.b].sort().join('|') === key);
        if (!exists) scene.edges.push({ a: edgeFirst, b: n.id });
        edgeFirst = null;
      }
      redraw();
    } else if (mode === 'erase') {
      if (!n) return;
      scene.nodes = scene.nodes.filter((x) => x.id !== n.id);
      scene.edges = scene.edges.filter((e) => e.a !== n.id && e.b !== n.id);
      scene.flights = scene.flights.filter((f) => f.standNode !== n.id);
      redraw();
    } else if (n) {
      dragId = n.id;
    }
  });

  canvas.addEventListener('mousemove', (ev) => {
    const p = renderer.worldFromEvent(ev);
    hoverId = nodeAt(p)?.id ?? null;
    if (dragId) {
      const n = scene.nodes.find((x) => x.id === dragId);
      if (n) { n.x = clamp(p.x); n.y = clamp(p.y); }
    }
    redraw();
  });
  window.addEventListener('mouseup', () => { dragId = null; });

  function clamp(v: number) {
    return Math.max(20, Math.min(WORLD_W - 20, Math.round(v)));
  }

  function buildToolbar() {
    toolbar.replaceChildren(
      h('button', { class: 'mini', onclick: () => go({ page: 'menu' }) }, '← 菜单'),
      h('span', { class: 'sep' }, '|'),
      modeBtn('select', '选择/拖动'),
      modeBtn('node', '加节点'),
      modeBtn('edge', '连滑行道'),
      modeBtn('erase', '删除'),
      h('select', {
        onchange: (e) => { nodeKind = (e.target as HTMLSelectElement).value as NodeKind; },
      }, ...(['taxi', 'stand', 'pad', 'depot', 'exit'] as NodeKind[]).map((k) => h('option', { value: k }, kindLabel(k)))),
      h('span', { class: 'sep' }, '|'),
      h('button', { class: 'mini', onclick: onPlay }, '▶ 试玩'),
      h('button', { class: 'mini', onclick: () => exportJSON(scene, 'scene.json') }, '导出场景'),
      h('label', { class: 'mini file-btn' }, '导入场景', h('input', {
        type: 'file', accept: '.json', style: 'display:none', onchange: async (e) => {
          const file = (e.target as HTMLInputElement).files?.[0];
          if (!file) return;
          try {
            const imported = asScene(await importJSON(file));
            go({ page: 'editor', scene: imported });
          } catch (err) {
            pushToast('导入失败：' + (err as Error).message);
          }
        },
      })),
      h('button', { class: 'mini', onclick: validate }, '校验'),
      h('input', {
        class: 'scene-name',
        value: scene.name,
        oninput: (e) => { scene.name = (e.target as HTMLInputElement).value; },
      }),
    );
  }

  function modeBtn(m: Mode, label: string) {
    return h('button', { class: `mini ${mode === m ? 'active' : ''}`, onclick: () => { mode = m; edgeFirst = null; buildToolbar(); redraw(); } }, label);
  }

  function kindLabel(k: NodeKind) {
    return { taxi: '滑行点', stand: '机位', pad: '除冰坪', depot: '加液站', exit: '离场口' }[k];
  }

  function validate() {
    const errs = validateScene(scene);
    if (errs.length === 0) pushToast('校验通过：图连通、引用完整');
    else alert('场景问题：\n' + errs.join('\n'));
  }

  function onPlay() {
    const errs = validateScene(scene);
    if (errs.length) { alert('请先修复场景问题：\n' + errs.join('\n')); return; }
    go({ page: 'game', scene: structuredClone(scene), seed: (Date.now() % 1000000) >>> 0, replay: null });
  }

  // ---------- 右侧数据表 ----------

  function buildTable() {
    table.replaceChildren();
    table.append(
      h('h3', {}, '场景数据'),
      h('label', { class: 'form-row' }, '班次长度(tick)', numInput(scene.durationTicks, (v) => { scene.durationTicks = v; })),
      h('h4', {}, `航班表（${scene.flights.length}）`),
      h('button', { class: 'mini', onclick: () => { addFlight(); buildTable(); } }, '+ 航班'),
      ...scene.flights.map(flightRow),
      h('h4', {}, `天气分段（${scene.weather.length}）`),
      h('button', { class: 'mini', onclick: () => { scene.weather.push({ startTick: scene.durationTicks, level: 1 }); buildTable(); } }, '+ 天气段'),
      ...scene.weather.map(weatherRow),
      h('h4', {}, `除冰车（${scene.trucks.length}）`),
      h('button', { class: 'mini', onclick: () => { addTruck(); buildTable(); } }, '+ 车辆'),
      ...scene.trucks.map(truckRow),
    );
  }

  function flightRow(f: FlightPlan) {
    const stands = scene.nodes.filter((n) => n.kind === 'stand').map((n) => n.id);
    const exits = scene.nodes.filter((n) => n.kind === 'exit').map((n) => n.id);
    return h('div', { class: 'data-row' },
      h('input', { value: f.id, oninput: (e) => { f.id = (e.target as HTMLInputElement).value; } }),
      h('input', { value: f.airline, oninput: (e) => { f.airline = (e.target as HTMLInputElement).value; } }),
      numInput(f.arrivalTick, (v) => { f.arrivalTick = v; }),
      h('select', { onchange: (e) => { f.standNode = (e.target as HTMLSelectElement).value; } },
        ...stands.map((id) => h('option', { value: id, selected: f.standNode === id }, id))),
      h('select', { onchange: (e) => { f.exitNode = (e.target as HTMLSelectElement).value; } },
        ...exits.map((id) => h('option', { value: id, selected: f.exitNode === id }, id))),
      h('label', { class: 'chk' }, 'VIP', h('input', { type: 'checkbox', checked: f.vip, onchange: (e) => { f.vip = (e.target as HTMLInputElement).checked; } })),
      h('button', { class: 'mini danger', onclick: () => { scene.flights = scene.flights.filter((x) => x !== f); buildTable(); } }, '×'),
    );
  }

  function weatherRow(w: { startTick: number; level: number }) {
    return h('div', { class: 'data-row' },
      h('span', {}, '起'),
      numInput(w.startTick, (v) => { w.startTick = v; }),
      h('select', { onchange: (e) => { w.level = Number((e.target as HTMLSelectElement).value); } },
        ...[0, 1, 2, 3].map((lv) => h('option', { value: String(lv), selected: w.level === lv }, ['晴冷', '小雪', '中雪', '暴雪'][lv]))),
      h('span', { class: 'hint' }, fmtTick(w.startTick)),
      h('button', { class: 'mini danger', onclick: () => { scene.weather = scene.weather.filter((x) => x !== w); buildTable(); } }, '×'),
    );
  }

  function truckRow(t: { id: string; depotNode: string }) {
    const depots = scene.nodes.filter((n) => n.kind === 'depot').map((n) => n.id);
    return h('div', { class: 'data-row' },
      h('input', { value: t.id, oninput: (e) => { t.id = (e.target as HTMLInputElement).value; } }),
      h('select', { onchange: (e) => { t.depotNode = (e.target as HTMLSelectElement).value; } },
        ...depots.map((id) => h('option', { value: id, selected: t.depotNode === id }, id))),
      h('button', { class: 'mini danger', onclick: () => { scene.trucks = scene.trucks.filter((x) => x !== t); buildTable(); } }, '×'),
    );
  }

  function addFlight() {
    const stand = scene.nodes.find((n) => n.kind === 'stand')?.id;
    const exit = scene.nodes.find((n) => n.kind === 'exit')?.id;
    if (!stand || !exit) { pushToast('需要先有机位和离场口'); return; }
    scene.flights.push({
      id: 'F' + String(scene.flights.length + 1).padStart(3, '0'),
      airline: '新航司',
      arrivalTick: 10 + scene.flights.length * 12,
      standNode: stand,
      exitNode: exit,
      vip: false,
    });
  }

  function addTruck() {
    const depot = scene.nodes.find((n) => n.kind === 'depot')?.id;
    if (!depot) { pushToast('需要先有加液站'); return; }
    scene.trucks.push({ id: 'T' + (scene.trucks.length + 1), depotNode: depot });
  }

  function numInput(value: number, onSet: (v: number) => void) {
    return h('input', { type: 'number', value: String(value), oninput: (e) => onSet(Number((e.target as HTMLInputElement).value)) });
  }

  buildToolbar();
  buildTable();
  redraw();
}
