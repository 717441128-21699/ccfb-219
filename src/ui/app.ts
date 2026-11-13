import type { Action, Scene } from '../types';
import { balancerScreen } from './balancer';
import { clear, h } from './dom';
import { editorScreen } from './editor';
import { gameScreen } from './game';
import { mainMenu } from './menu';
import { savesScreen } from './saves';

export type Route =
  | { page: 'menu' }
  | { page: 'game'; scene: Scene; seed: number; replay: Action[] | null; resumeTick?: number }
  | { page: 'editor'; scene: Scene }
  | { page: 'balancer' }
  | { page: 'saves' };

export function startApp(root: HTMLElement) {
  const go = (r: Route) => {
    clear(root);
    root.append(h('div', { class: 'topbar' },
      h('span', { class: 'brand' }, '除冰坪调度 · Frost Bay Ops'),
      h('button', { class: 'mini', onclick: () => go({ page: 'menu' }) }, '主菜单'),
    ));
    const view = h('div', { class: 'view' });
    root.append(view);
    switch (r.page) {
      case 'menu': mainMenu(go, view); break;
      case 'game': gameScreen(go, view, r); break;
      case 'editor': editorScreen(go, view, r); break;
      case 'balancer': balancerScreen(go, view); break;
      case 'saves': savesScreen(go, view); break;
    }
  };
  go({ page: 'menu' });
}
