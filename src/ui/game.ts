import { FLUIDS, TICK_SECONDS, WEATHER_LEVELS } from '../config';
import { applyAction, createEngine, moverPos, snapshot, step, type EngineState } from '../sim/engine';
import { Rng } from '../sim/rng';
import { Renderer } from '../sim/renderer';
import type { Action, FlightRT, Scene, TruckRT } from '../types';
import { h, fmtTick, money } from './dom';
import type { Route } from './app';
import { encodeReplay, runToEnd } from '../sim/replay';
import { writeSave, exportJSON } from '../sim/storage';

export function gameScreen(go: (r: Route) => void, root: HTMLElement, route: Extract<Route, { page: 'game' }>) {
  const engine = createEngine(route.scene, route.seed);
  const rng = new Rng(route.seed ^ 0x9e3779b9);
  // 本地动作流初始化为回放/存档动作的可变副本，保证继续游戏后再次存档仍含完整历史
  const actions: Action[] = route.replay ? route.replay.map((a) => ({ ...a })) : [];
  let seqCounter = actions.reduce((m, a) => Math.max(m, a.seq + 1), 0);
  let speed = 1; // 1x / 2x / 4x
  let paused = false;
  let selected: { flight?: string; truck?: string; pad?: string } = {};
  let timer = 0;

  // 回放模式：预置动作流（与本地 actions 独立，按原序自动施加）
  const replayActions = route.replay ? [...route.replay] : null;
  let replayIdx = 0;

  const canvas = h('canvas', { class: 'game-canvas' }) as HTMLCanvasElement;
  const renderer = new Renderer(canvas, rng);
  const hud = h('div', { class: 'hud' });
  const side = h('div', { class: 'side-panel' });
  const eventLog = h('div', { class: 'event-log' });

  root.append(
    h('div', { class: 'game-layout' },
      h('div', { class: 'canvas-wrap' }, canvas, hud),
      side,
    ),
    eventLog,
  );
  renderer.resize();
  window.addEventListener('resize', onResize);

  function onResize() {
    renderer.resize();
  }

  function record(a: Omit<Action, 'tick' | 'seq'>) {
    if (replayActions) {
      pushToast('录像回放中，手动操作已禁用');
      return;
    }
    const action: Action = { tick: engine.tick, seq: seqCounter++, ...a };
    actions.push(action);
    applyAction(engine, action);
    refreshSide();
  }

  // 若从存档恢复：先把历史动作重放到指定 tick
  if (route.replay && route.resumeTick) {
    const ordered = [...route.replay].sort((a, b) => a.tick - b.tick || a.seq - b.seq);
    while (engine.tick < route.resumeTick && !engine.finished) {
      while (ordered[replayIdx] && ordered[replayIdx].tick <= engine.tick) {
        applyAction(engine, ordered[replayIdx]);
        replayIdx++;
      }
      step(engine);
    }
  }

  canvas.addEventListener('click', (ev) => {
    const p = renderer.worldFromEvent(ev);
    // 优先选车，再选飞机，再选坪
    for (const t of engine.trucks) {
      const tp = posOfTruck(engine, t);
      if (Math.hypot(tp.x - p.x, tp.y - p.y) < 16) {
        selected = { truck: t.specId };
        refreshSide();
        return;
      }
    }
    for (const f of engine.flights) {
      if (f.phase === 'departed') continue;
      const fp = posOfFlight(engine, f);
      if (Math.hypot(fp.x - p.x, fp.y - p.y) < 18) {
        selected = { flight: f.planId };
        refreshSide();
        return;
      }
    }
    const node = engine.scene.nodes.find((n) => Math.hypot(n.x - p.x, n.y - p.y) < 24);
    if (node?.kind === 'pad') {
      selected = { pad: node.id };
      refreshSide();
      return;
    }
    selected = {};
    refreshSide();
  });

  function tickLoop() {
    if (paused || engine.finished) return;
    for (let i = 0; i < speed; i++) {
      if (engine.finished) break;
      if (replayActions) {
        const ordered = replayActions;
        while (ordered[replayIdx] && ordered[replayIdx].tick <= engine.tick) {
          applyAction(engine, ordered[replayIdx]);
          replayIdx++;
        }
      }
      step(engine);
    }
  }

  timer = window.setInterval(() => {
    tickLoop();
    renderer.draw(engine, selected);
    refreshHud();
    refreshLog();
    if (engine.finished) {
      window.clearInterval(timer);
      showSummary();
    }
  }, TICK_SECONDS * 100);

  function refreshHud() {
    const wl = WEATHER_LEVELS[engine.weatherLevel];
    hud.replaceChildren(
      chip('时刻', fmtTick(engine.tick)),
      ...(replayActions ? [chip('模式', '录像回放', 'warn')] : []),
      chip('天气', wl.name, wl.id >= 3 ? 'warn' : ''),
      chip('预算', money(engine.budget), engine.budget < 0 ? 'warn' : ''),
      chip('在场航班', String(engine.flights.filter((f) => f.phase !== 'departed').length)),
      chip('已离场', `${engine.stats.departed}/${engine.scene.flights.length}`),
      chip('重喷', String(engine.stats.reSprays), engine.stats.reSprays > 0 ? 'warn' : ''),
      h('div', { class: 'spacer' }),
      h('button', { class: 'mini', onclick: () => { paused = !paused; } }, paused ? '继续' : '暂停'),
      h('button', { class: 'mini', onclick: () => { speed = speed === 1 ? 2 : speed === 2 ? 4 : 1; } }, `${speed}x`),
      h('button', { class: 'mini', onclick: () => { saveNow(); } }, '存档'),
      h('button', { class: 'mini', onclick: () => go({ page: 'menu' }) }, '菜单'),
    );
  }

  function refreshLog() {
    eventLog.replaceChildren(
      h('div', { class: 'log-title' }, '运行日志'),
      ...engine.events.slice(-12).reverse().map((e) =>
        h('div', { class: `log-line ${e.kind}` }, `${fmtTick(e.tick)} ${e.text}`),
      ),
    );
  }

  function refreshSide() {
    side.replaceChildren();
    side.append(h('h3', {}, '调度操作'));

    // 选中航班
    const flight = selected.flight ? engine.flights.find((f) => f.planId === selected.flight) : undefined;
    if (flight && flight.phase !== 'departed') {
      side.append(flightCard(engine, flight, record));
    }
    // 选中除冰车
    const truck = selected.truck ? engine.trucks.find((t) => t.specId === selected.truck) : undefined;
    if (truck) {
      side.append(truckCard(engine, truck, record));
    }
    // 选中坪位：列出可派航班
    if (selected.pad) {
      const pad = selected.pad;
      side.append(h('h4', {}, `坪位 ${pad}`));
      for (const f of engine.flights.filter((x) => x.phase === 'queued')) {
        side.append(h('button', {
          class: 'side-btn',
          onclick: () => { record({ type: 'assignPad', flightId: f.planId, padNode: pad }); selected = { flight: f.planId }; refreshSide(); },
        }, `派 ${f.planId}${f.vip ? ' (VIP)' : ''} 入坪`));
      }
    }

    if (!flight && !truck && !selected.pad) {
      side.append(h('p', { class: 'hint' }, '点击飞机、除冰车或坪位进行调度。'));
      side.append(h('h4', {}, '队列概览'));
      for (const f of engine.flights.filter((x) => x.phase === 'queued' || x.phase === 'waitingPad' || x.phase === 'toPad')) {
        side.append(h('button', { class: 'side-btn', onclick: () => { selected = { flight: f.planId }; refreshSide(); } },
          `${f.planId} · ${phaseLabel(f.phase)}${f.vip ? ' · VIP' : ''} · 压力${Math.round(f.pressure)}`));
      }
      side.append(h('h4', {}, '车辆概览'));
      for (const t of engine.trucks) {
        side.append(h('button', { class: 'side-btn', onclick: () => { selected = { truck: t.specId }; refreshSide(); } },
          `${t.specId} · ${truckPhase(t)} · 液${Math.round(t.fluidL)}L · 班${t.shiftLeft}`));
      }
    }
  }

  function saveNow() {
    const label = `${route.scene.name} @${fmtTick(engine.tick)}`;
    writeSave({ seed: route.seed, scene: route.scene, actions, tick: engine.tick, label });
    pushToast(`已存档：${label}`);
  }

  function showSummary() {
    const snap = snapshot(engine);
    // 离线重放校验确定性：用同一串动作从头跑一遍，比较终局校验和
    const replay = runToEnd(route.scene, route.seed, actions);
    const replayChecksum = snapshot(replay.engine).checksum;
    const check = replay.engine.finished && replayChecksum === snap.checksum;
    const overlay = h('div', { class: 'overlay' },
      h('div', { class: 'summary-card' },
        h('h2', {}, '班次结算'),
        statRow('离场航班', `${engine.stats.departed} / ${engine.scene.flights.length}`),
        statRow('累计延误', `${fmtTick(engine.stats.delayTicks)}`),
        statRow('重喷次数', String(engine.stats.reSprays)),
        statRow('罚则总额', money(-engine.stats.fines)),
        statRow('液体成本', money(-engine.stats.fluidCost)),
        statRow('运营成本', money(-engine.stats.opCost)),
        statRow('服务收入', money(engine.stats.revenue)),
        statRow('期末预算', money(engine.budget), engine.budget < 0 ? 'warn' : 'good'),
        h('p', { class: check ? 'good' : 'warn' }, check ? '✓ 离线重放校验通过，本局可完全复现' : '✗ 重放校验不一致（请上报）'),
        h('div', { class: 'menu-btns' },
          h('button', { class: 'primary', onclick: () => { exportJSON({ seed: route.seed, scene: route.scene, actions, tick: engine.tick, label: route.scene.name }, 'savegame.json'); } }, '导出存档'),
          h('button', { onclick: () => { exportJSON(encodeReplay(route.seed, route.scene.name, actions), 'replay.txt'); } }, '导出录像'),
          h('button', { onclick: () => { overlay.remove(); } }, '留在本局'),
          h('button', { onclick: () => { cleanup(); go({ page: 'menu' }); } }, '返回主菜单'),
        ),
      ),
    );
    root.append(overlay);
  }

  function cleanup() {
    window.clearInterval(timer);
    window.removeEventListener('resize', onResize);
  }

  refreshHud();
  refreshSide();
  refreshLog();
  renderer.draw(engine, selected);
}

// ---------- 小部件 ----------

function chip(k: string, v: string, cls = '') {
  return h('div', { class: `chip ${cls}` }, h('span', { class: 'chip-k' }, k), h('span', { class: 'chip-v' }, v));
}

function statRow(k: string, v: string, cls = '') {
  return h('div', { class: `stat-row ${cls}` }, h('span', {}, k), h('b', {}, v));
}

function phaseLabel(p: FlightRT['phase']): string {
  return { incoming: '进场', queued: '排队', toPad: '入坪', waitingPad: '等车', deicing: '除冰中', holdover: '保持期', toExit: '离场滑行', departed: '已离场' }[p];
}

function truckPhase(t: TruckRT): string {
  return { idle: '空闲', moving: '出动', working: '作业', refilling: '加液', swapping: '换班', recalled: '返库' }[t.phase];
}

function flightCard(engine: EngineState, f: FlightRT, record: (a: Omit<Action, 'tick' | 'seq'>) => void) {
  const box = h('div', { class: 'card' });
  box.append(h('h4', {}, `航班 ${f.planId}${f.vip ? ' · VIP' : ''}`));
  box.append(h('p', { class: 'hint' }, `${f.airline} · 状态 ${phaseLabel(f.phase)} · 催单压力 ${Math.round(f.pressure)}`));
  if (f.fluid) box.append(h('p', { class: 'hint' }, `液体 ${f.fluid} · 保持剩余 ${f.holdoverLeft} tick`));
  if (f.phase === 'queued') {
    for (const pad of engine.scene.nodes.filter((n) => n.kind === 'pad')) {
      const occupied = engine.padUse.has(pad.id);
      box.append(h('button', {
        class: 'side-btn',
        disabled: occupied,
        onclick: () => record({ type: 'assignPad', flightId: f.planId, padNode: pad.id }),
      }, occupied ? `${pad.id} 占用中` : `分配到 ${pad.id}`));
    }
  }
  if (f.phase === 'waitingPad') {
    for (const t of engine.trucks) {
      box.append(h('button', {
        class: 'side-btn',
        disabled: t.phase === 'working' || t.phase === 'refilling' || t.phase === 'swapping' || t.shiftLeft <= 0,
        onclick: () => record({ type: 'assignTruck', truckId: t.specId, flightId: f.planId }),
      }, `派 ${t.specId}（${truckPhase(t)}）`));
    }
  }
  return box;
}

function truckCard(engine: EngineState, t: TruckRT, record: (a: Omit<Action, 'tick' | 'seq'>) => void) {
  const box = h('div', { class: 'card' });
  const depot = engine.scene.trucks.find((x) => x.id === t.specId)!.depotNode;
  box.append(h('h4', {}, `除冰车 ${t.specId}`));
  box.append(h('p', { class: 'hint' }, `状态 ${truckPhase(t)} · 液量 ${Math.round(t.fluidL)}L · 班次剩余 ${t.shiftLeft} tick · 已服务 ${t.totalServed}`));
  const select = h('select', {}, ...FLUIDS.map((f) => h('option', { value: f.id, selected: t.fluidChoice === f.id }, `${f.name}（¥${f.costPerL}/L）`)));
  select.addEventListener('change', () => record({ type: 'setFluid', truckId: t.specId, fluid: select.value as Action['fluid'] }));
  box.append(h('label', { class: 'fluid-pick' }, '液体型号', select));
  box.append(h('button', { class: 'side-btn', onclick: () => record({ type: 'recallTruck', truckId: t.specId }) }, '召回车库'));
  box.append(h('button', {
    class: 'side-btn',
    disabled: t.node !== depot,
    onclick: () => record({ type: 'refillTruck', truckId: t.specId }),
  }, t.node === depot ? '加液' : `加液（需在 ${depot}）`));
  box.append(h('button', {
    class: 'side-btn',
    disabled: t.node !== depot,
    onclick: () => record({ type: 'swapShift', truckId: t.specId }),
  }, t.node === depot ? '换班' : `换班（需在 ${depot}）`));
  return box;
}

function posOfFlight(s: EngineState, f: FlightRT) {
  return moverPos(s, f.node, f.path, f.segIdx, f.segProgress);
}
function posOfTruck(s: EngineState, t: TruckRT) {
  return moverPos(s, t.node, t.path, t.segIdx, t.segProgress);
}

let toastTimer = 0;
export function pushToast(msg: string) {
  const old = document.querySelector('.toast');
  old?.remove();
  const el = h('div', { class: 'toast' }, msg);
  document.body.append(el);
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el.remove(), 2200);
}
