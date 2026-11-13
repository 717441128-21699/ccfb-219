import { simulateBatch, type BatchReport, type Distribution } from '../sim/balancer';
import { defaultScene } from '../sim/defaultScene';
import type { Scene } from '../types';
import { h } from './dom';
import type { Route } from './app';
import { asScene, exportJSON, importJSON } from '../sim/storage';
import { pushToast } from './game';

export function balancerScreen(go: (r: Route) => void, root: HTMLElement) {
  let scene: Scene = defaultScene();
  let report: BatchReport | null = null;
  let running = false;

  const countInput = h('input', { type: 'number', value: '200', min: '10', max: '1000' }) as HTMLInputElement;
  const result = h('div', { class: 'bal-result' });
  const hist = h('canvas', { class: 'hist-canvas', width: 640, height: 220 }) as HTMLCanvasElement;

  root.append(
    h('div', { class: 'page' },
      h('div', { class: 'page-head' },
        h('button', { class: 'mini', onclick: () => go({ page: 'menu' }) }, '← 菜单'),
        h('h2', {}, '平衡模拟器'),
        h('span', { class: 'spacer' }),
        h('label', { class: 'mini file-btn' }, '载入场景', h('input', {
          type: 'file', accept: '.json', style: 'display:none', onchange: async (e) => {
            const file = (e.target as HTMLInputElement).files?.[0];
            if (file) { try { scene = asScene(await importJSON(file)); pushToast('已载入场景：' + scene.name); } catch (err) { pushToast('载入失败：' + (err as Error).message); } }
          },
        })),
      ),
      h('p', { class: 'hint' }, '使用内置自动调度策略，按不同种子批量跑局，统计延误、成本与罚则分布。所有数值来自 config.ts 与场景配置表。'),
      h('div', { class: 'bal-controls' },
        h('label', {}, '局数', countInput),
        h('button', {
          class: 'primary',
          onclick: () => {
            if (running) return;
            running = true;
            result.replaceChildren(h('p', {}, '批量模拟运行中…'));
            // 让浏览器先渲染再进行同步计算
            setTimeout(() => {
              const n = Math.max(10, Math.min(1000, Number(countInput.value) || 200));
              const t0 = performance.now();
              report = simulateBatch(scene, n);
              running = false;
              renderResult(performance.now() - t0);
            }, 30);
          },
        }, '开始批量模拟'),
        h('button', { class: 'mini', disabled: true, id: 'export-btn', onclick: () => report && exportJSON(report, 'balance-report.json') }, '导出报告'),
      ),
      result,
      hist,
    ),
  );

  function renderResult(ms: number) {
    const r = report!;
    const exportBtn = document.getElementById('export-btn') as HTMLButtonElement;
    exportBtn.disabled = false;
    result.replaceChildren(
      h('p', { class: 'hint' }, `完成 ${r.runs.length} 局，耗时 ${ms.toFixed(0)} ms · 平均离场保障率 ${(r.departedRate * 100).toFixed(1)}%`),
      table('延误 tick 分布', r.delayTicks),
      table('期末预算分布（¥）', r.budget),
      table('罚则分布（¥）', r.fines),
      table('重喷次数分布', r.reSprays),
      h('h4', {}, '各局明细（前 20）'),
      h('table', { class: 'data-table' },
        h('thead', {}, h('tr', {}, ...['种子', '离场', '延误tick', '重喷', '罚则', '期末预算', '动作数'].map((x) => h('th', {}, x)))),
        h('tbody', {}, ...r.runs.slice(0, 20).map((run) =>
          h('tr', {},
            h('td', {}, String(run.seed)),
            h('td', {}, `${run.stats.departed}/${scene.flights.length}`),
            h('td', {}, String(run.stats.delayTicks)),
            h('td', {}, String(run.stats.reSprays)),
            h('td', {}, String(run.stats.fines)),
            h('td', {}, String(run.finalBudget)),
            h('td', {}, String(run.actionCount)),
          ))),
      ),
    );
    drawHistogram(hist, r.runs.map((x) => x.finalBudget));
  }

  function table(title: string, d: Distribution) {
    return h('div', { class: 'dist-card' },
      h('h4', {}, title),
      h('div', { class: 'dist-grid' },
        ...([['最小', d.min], ['P10', d.p10], ['中位', d.median], ['P90', d.p90], ['最大', d.max], ['均值', d.mean]] as [string, number][]).map(
          ([k, v]) => h('div', { class: 'dist-cell' }, h('b', {}, String(v)), h('span', {}, k)),
        ),
      ),
    );
  }
}

function drawHistogram(canvas: HTMLCanvasElement, values: number[]) {
  const ctx = canvas.getContext('2d')!;
  const W = canvas.width, H = canvas.height, pad = 28;
  ctx.clearRect(0, 0, W, H);
  const min = Math.min(...values), max = Math.max(...values);
  const bins = 20;
  const counts = new Array(bins).fill(0);
  for (const v of values) {
    const idx = Math.min(bins - 1, Math.floor(((v - min) / Math.max(1, max - min)) * bins));
    counts[idx]++;
  }
  const peak = Math.max(...counts, 1);
  const bw = (W - pad * 2) / bins;
  ctx.fillStyle = '#2a3a52';
  counts.forEach((c, i) => {
    const bh = (c / peak) * (H - pad * 2);
    ctx.fillRect(pad + i * bw + 1, H - pad - bh, bw - 2, bh);
  });
  ctx.fillStyle = '#8aa0bb';
  ctx.font = '12px monospace';
  ctx.fillText(`min ${min}`, pad, H - 8);
  ctx.fillText(`max ${max}`, W - pad - 60, H - 8);
  ctx.fillText('期末预算直方图', pad, 16);
}
