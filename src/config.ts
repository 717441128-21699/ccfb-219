// 全局常量与数值配置表（所有数值只允许在这里或场景/液体配置中出现）

export const TICK_SECONDS = 10; // 一个模拟 tick = 10 秒
export const WORLD_W = 960;
export const WORLD_H = 600;

export const SAVE_VERSION = 3; // 存档结构版本号，迁移逻辑见 storage.ts
export const SCENE_VERSION = 2; // 场景文件版本号

export const FLUIDS = [
  { id: 'type1', name: 'I 型 · 加热除冰液', baseHoldover: 2, costPerL: 0.4, color: '#5ab1ef' },
  { id: 'type4', name: 'IV 型 · 防冰保持液', baseHoldover: 5, costPerL: 1.1, color: '#7be0a3' },
  { id: 'type4p', name: 'IV+ 型 · 极寒增稠液', baseHoldover: 9, costPerL: 2.0, color: '#c39bff' },
] as const;
export type FluidId = (typeof FLUIDS)[number]['id'];

// 天气等级 -> 保持时间倍率、雪粒密度、名称
export const WEATHER_LEVELS = [
  { id: 0, name: '晴冷', holdoverMul: 1.0, snow: 0.0, color: '#1c2a3a' },
  { id: 1, name: '小雪', holdoverMul: 0.8, snow: 0.35, color: '#24344a' },
  { id: 2, name: '中雪', holdoverMul: 0.55, snow: 0.7, color: '#2d3d54' },
  { id: 3, name: '暴雪', holdoverMul: 0.32, snow: 1.0, color: '#3a4a63' },
] as const;

export const TRUCK = {
  capacityL: 2000,
  fluidPerPlane: 320, // 每架次耗液（升）
  deiceTicks: 3, // 喷液作业 30 秒
  refillTicks: 6, // 加液 60 秒
  swapTicks: 4, // 换班 40 秒
  shiftLength: 540, // 540 tick = 90 分钟一班
  shiftWarn: 60, // 剩余 60 tick 告警
  opCostPerTick: 2, // 每 tick 人工/燃油固定成本
};

export const ECONOMY = {
  initialBudget: 60000,
  delayFinePerTick: 18, // 每延误 10 秒的航司罚则
  pressureFine: 900, // 催单压力爆表一次
  pressurePerWaitTick: 0.8, // 等待中的航班每 tick 累积
  pressureThreshold: 100,
  vipPriorityBonus: 0,
  deiceRewardRate: 0.15, // 除冰服务费 = 液体成本 * (1 + 该值)
};

export const COLORS = {
  bg: '#101826',
  apron: '#2a3a52',
  pad: '#3d5573',
  padActive: '#4f7aa8',
  taxi: '#8aa0bb',
  depot: '#b98a3e',
  stand: '#46586f',
  exit: '#5fbf8f',
  flight: '#e8eef7',
  vip: '#ffd166',
  truck: '#7be0a3',
  warn: '#ef6f6c',
  text: '#dce6f2',
  muted: '#8aa0bb',
};
