import { SAVE_VERSION, SCENE_VERSION } from '../config';
import type { Action, Scene } from '../types';
import { defaultScene } from './defaultScene';

export interface SaveFile {
  version: number;
  savedAt: string;
  seed: number;
  scene: Scene;
  actions: Action[];
  tick: number;
  label: string;
}

const SAVE_KEY = 'frostbay.saves.v1';

// ---------- 版本迁移：每个旧版本 -> 新版本的结构修补 ----------

function migrate(raw: Record<string, unknown>): SaveFile {
  let v = Number(raw.version ?? 1);
  const data = structuredClone(raw);

  // v1 -> v2：场景缺少天气分段时补默认天气；动作增加 seq 字段
  if (v === 1) {
    const scene = (data.scene ?? {}) as Record<string, unknown>;
    if (!Array.isArray(scene.weather)) {
      scene.weather = [
        { startTick: 0, level: 1 },
        { startTick: 90, level: 2 },
      ];
    }
    (data.actions as Record<string, unknown>[] | undefined)?.forEach((a, i) => {
      if (a.seq === undefined) a.seq = i;
    });
    v = 2;
  }

  // v2 -> v3：场景节点补充 kind 缺省值（旧版节点只有坐标），存档增加 label
  if (v === 2) {
    const scene = data.scene as (Scene & { nodes?: Record<string, unknown>[] }) | undefined;
    scene?.nodes?.forEach((n) => {
      if (!n.kind) n.kind = 'taxi';
    });
    if (data.label === undefined) data.label = '迁移存档';
    v = 3;
  }

  if (v > SAVE_VERSION) {
    throw new Error(`存档版本 v${v} 高于当前支持的 v${SAVE_VERSION}，请升级游戏`);
  }

  const save = data as unknown as SaveFile;
  save.version = SAVE_VERSION;
  if (!save.scene.version) save.scene.version = SCENE_VERSION;
  return save;
}

// ---------- 本地存档 ----------

export function listSaves(): SaveFile[] {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw) as Record<string, unknown>[];
    return arr.map(migrate).sort((a, b) => (a.savedAt < b.savedAt ? 1 : -1));
  } catch (e) {
    console.error('读取存档失败', e);
    return [];
  }
}

export function writeSave(save: Omit<SaveFile, 'version' | 'savedAt'> & { savedAt?: string }): SaveFile {
  const full: SaveFile = {
    ...save,
    version: SAVE_VERSION,
    savedAt: save.savedAt ?? new Date().toISOString(),
  };
  const all = listSaves().filter((x) => x.label !== full.label);
  all.unshift(full);
  localStorage.setItem(SAVE_KEY, JSON.stringify(all.slice(0, 20)));
  return full;
}

export function deleteSave(label: string) {
  const all = listSaves().filter((x) => x.label !== label);
  localStorage.setItem(SAVE_KEY, JSON.stringify(all));
}

// ---------- 文件导入导出（场景 / 存档通用 JSON） ----------

export function exportJSON(obj: unknown, filename: string) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function importJSON(file: File): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        resolve(JSON.parse(String(reader.result)));
      } catch (e) {
        reject(e);
      }
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

// 识别导入内容是存档还是场景
export function asScene(obj: unknown): Scene {
  const o = obj as Record<string, unknown>;
  if (Array.isArray(o.nodes) && Array.isArray(o.edges)) {
    const scene = obj as Scene;
    scene.version = SCENE_VERSION;
    scene.weather ??= defaultScene().weather;
    scene.trucks ??= [];
    scene.flights ??= [];
    return scene;
  }
  throw new Error('文件不是有效的场景数据');
}
