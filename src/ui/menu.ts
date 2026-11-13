import type { Scene } from '../types';
import { defaultScene } from '../sim/defaultScene';
import { listSaves, type SaveFile } from '../sim/storage';
import { h } from './dom';
import type { Route } from './app';

export function mainMenu(go: (r: Route) => void, root: HTMLElement) {
  const saves = listSaves();
  const continueSave: SaveFile | undefined = saves[0];

  root.append(
    h('div', { class: 'menu-wrap' },
      h('div', { class: 'menu-card' },
        h('h1', {}, '除冰坪调度'),
        h('p', { class: 'subtitle' }, 'Frost Bay De-icing Ops · 冬季机场经营模拟'),
        h('div', { class: 'menu-btns' },
          h('button', {
            class: 'primary',
            onclick: () => go({ page: 'game', scene: defaultScene(), seed: seedFromInput(), replay: null }),
          }, '新的班次'),
          h('button', {
            disabled: !continueSave,
            onclick: () => continueSave && go({ page: 'game', scene: continueSave.scene, seed: continueSave.seed, replay: continueSave.actions, resumeTick: continueSave.tick }),
          }, continueSave ? `继续游戏 · ${continueSave.label}` : '暂无存档'),
          h('button', { onclick: () => go({ page: 'editor', scene: defaultScene() }) }, '场景编辑器'),
          h('button', { onclick: () => go({ page: 'balancer' }) }, '平衡模拟器'),
          h('button', { onclick: () => go({ page: 'saves' }) }, '存档与录像管理'),
        ),
        h('div', { class: 'menu-seed' },
          h('label', {}, '随机种子：'),
          seedInput(),
        ),
        h('p', { class: 'menu-hint' }, '同一种子 + 同一串操作将逐 tick 完全复现，可在结算页导出录像。'),
      ),
    ),
  );
}

let currentSeed = (Date.now() % 1000000) >>> 0;

function seedFromInput(): number {
  return currentSeed;
}

function seedInput() {
  const input = h('input', {
    type: 'number',
    value: String(currentSeed),
    oninput: (e) => { currentSeed = Number((e.target as HTMLInputElement).value) >>> 0; },
  });
  return input;
}

export function freshScene(): Scene {
  return defaultScene();
}
