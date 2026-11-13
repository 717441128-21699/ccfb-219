# 除冰坪调度 · Frost Bay De-icing Ops

浏览器端冬季机场除冰调度经营游戏。玩家扮演除冰坪调度员，在变化的天气、有限的坪位/车辆和催单压力下安排航班除冰。
纯 TypeScript + Canvas 矢量图形，无第三方游戏引擎、无现成游戏美术。

## 运行

```bash
npm install
npm run dev        # 开发服务器
npm run build      # 类型检查 + 生产构建到 dist/
npm run selftest   # Node 端确定性/回放/迁移自检
```

## 页面

1. **主菜单**：新班次（选种子）、继续存档、进入编辑器/平衡模拟器/存档管理。
2. **调度主界面**：Canvas 机坪，点击飞机/除冰车/坪位完成派坪、派车、选液体、召回、加液、换班；HUD 显示天气/预算/重喷，右侧操作面板，底部运行日志；结算页做离线重放校验并可导出存档与录像。
3. **场景编辑器**：加节点（机位/除冰坪/加液站/离场口/滑行点）、连滑行道、拖动、删除；右侧编辑航班表、天气分段、车辆配置；可校验连通性、直接试玩、导入/导出 JSON。
4. **平衡模拟器**：内置自动调度策略，按不同种子批量跑 10–1000 局，输出延误、预算、罚则、重喷的 P10/中位/P90 分布与直方图。
5. **存档与录像**：localStorage 存档（带版本迁移）、JSON 导出、文本录像回放。

## 确定性模型（同种子 + 同操作完全复现）

- `sim/rng.ts`：mulberry32。随机数**只在 `createEngine()` 初始化时消费一次**（每架航班的到达抖动），`step()` 推进过程不调用任何随机源，也不读取 `Date`/`Math.random`。
- 玩家的每个操作是带 `(tick, seq)` 的不可变 `Action`，按序施加；操作流即录像（`sim/replay.ts` 文本编解码）。
- 图遍历、邻接表、实体迭代顺序全部固定；`snapshot()` 对完整状态做 FNV 校验和，结算页用同一动作流离线重跑并比对终局校验和。
- 雪粒等视觉效果由 tick 与种子派生，不进入模拟状态。

## 数值配置

所有数值集中在 `src/config.ts`（液体型号/保持时间/单价、天气保持倍率、车辆参数、经济罚则）与场景 JSON（节点/边/航班表/天气分段/车辆），代码内不散落魔法数字。

## 存档版本

`SAVE_VERSION` 位于 `config.ts`，迁移链在 `sim/storage.ts` 的 `migrate()`：v1→v2 补天气分段与动作 seq，v2→v3 补节点 kind 与 label。新版本读取旧档时逐级迁移；读到更高版本则明确报错。

## 目录

```
src/
  config.ts            数值配置表
  types.ts             场景/实体/动作类型
  sim/
    rng.ts             确定性 RNG
    graph.ts           图结构、Dijkstra 寻路、场景校验
    engine.ts          逐 tick 模拟（移动/占用/坪位/保持时间/车辆/经济）
    replay.ts          动作流排序、重放、录像编解码
    policy.ts          自动调度策略（平衡模拟用）
    balancer.ts        批量模拟与分布统计
    defaultScene.ts    默认场景
    storage.ts         存档、版本迁移、JSON 导入导出
    renderer.ts        Canvas 矢量渲染
  ui/                  五个页面与路由
scripts/selftest.ts    确定性与迁移自检
```
