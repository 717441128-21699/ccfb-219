import { decodeReplay, encodeReplay } from '../sim/replay';
import { deleteSave, exportJSON, listSaves, type SaveFile } from '../sim/storage';
import { h, fmtTick } from './dom';
import type { Route } from './app';
import { pushToast } from './game';

export function savesScreen(go: (r: Route) => void, root: HTMLElement) {
  function render() {
    const saves = listSaves();
    root.replaceChildren();
    root.append(
      h('div', { class: 'page' },
        h('div', { class: 'page-head' },
          h('button', { class: 'mini', onclick: () => go({ page: 'menu' }) }, '← 菜单'),
          h('h2', {}, '存档与录像管理'),
        ),
        h('h3', {}, `本地存档（${saves.length}，结构版本 v${saves[0]?.version ?? '—'}）`),
        saves.length === 0 ? h('p', { class: 'hint' }, '还没有存档。在调度界面点击「存档」即可生成。') : h('div', {}, ...saves.map(saveRow)),
        h('h3', {}, '录像回放'),
        h('p', { class: 'hint' }, '录像为纯文本动作流：同种子下逐 tick 复现。选择录像文件并回放。'),
        h('label', { class: 'mini file-btn' }, '选择录像 (.txt)', h('input', {
          type: 'file', accept: '.txt', style: 'display:none', onchange: async (e) => {
            const file = (e.target as HTMLInputElement).files?.[0];
            if (!file) return;
            try {
              const text = await file.text();
              const rec = decodeReplay(text);
              const match = listSaves().find((s) => s.scene.name === rec.sceneName);
              if (!match) {
                pushToast(`找不到场景「${rec.sceneName}」，请先导入对应场景`);
                return;
              }
              go({ page: 'game', scene: match.scene, seed: rec.seed, replay: rec.actions });
            } catch (err) {
              pushToast('录像解析失败：' + (err as Error).message);
            }
          },
        })),
      ),
    );
  }

  function saveRow(s: SaveFile) {
    return h('div', { class: 'save-row' },
      h('div', {},
        h('b', {}, s.label),
        h('span', { class: 'hint' }, ` 种子 ${s.seed} · tick ${fmtTick(s.tick)} · 动作 ${s.actions.length} · v${s.version} · ${new Date(s.savedAt).toLocaleString()}`),
      ),
      h('div', { class: 'save-btns' },
        h('button', { class: 'mini primary', onclick: () => go({ page: 'game', scene: s.scene, seed: s.seed, replay: s.actions, resumeTick: s.tick }) }, '继续'),
        h('button', { class: 'mini', onclick: () => go({ page: 'game', scene: s.scene, seed: s.seed, replay: s.actions }) }, '从头回放'),
        h('button', { class: 'mini', onclick: () => exportJSON(s, 'savegame.json') }, '导出'),
        h('button', { class: 'mini', onclick: () => exportJSON(encodeReplay(s.seed, s.scene.name, s.actions), 'replay.txt') }, '导出录像'),
        h('button', { class: 'mini danger', onclick: () => { deleteSave(s.label); render(); } }, '删除'),
      ),
    );
  }

  render();
}
