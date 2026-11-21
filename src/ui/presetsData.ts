import type { UserPreset } from '../store/storage.ts';

/** 内置常用档位（可被用户自定义预设追加） */
export const BUILTIN_PRESETS: UserPreset[] = [
  // —— 内页 / 衬纸 用纸 ——
  {
    id: 'b-dual-70',
    group: '纸张 · 书刊纸',
    name: '双胶纸 70g',
    desc: '5,200 元/吨',
    target: 'inner',
    values: [
      { path: 'gram', value: 70 },
      { path: 'ton', value: 5200 },
    ],
    builtin: true,
  },
  {
    id: 'b-dual-80',
    group: '纸张 · 书刊纸',
    name: '双胶纸 80g',
    desc: '5,500 元/吨',
    target: 'inner',
    values: [
      { path: 'gram', value: 80 },
      { path: 'ton', value: 5500 },
    ],
    builtin: true,
  },
  {
    id: 'b-dual-100',
    group: '纸张 · 书刊纸',
    name: '双胶纸 100g',
    desc: '5,800 元/吨',
    target: 'liner',
    values: [
      { path: 'gram', value: 100 },
      { path: 'ton', value: 5800 },
    ],
    builtin: true,
  },
  {
    id: 'b-light-80',
    group: '纸张 · 书刊纸',
    name: '轻型纸 80g',
    desc: '6,000 元/吨',
    target: 'inner',
    values: [
      { path: 'gram', value: 80 },
      { path: 'ton', value: 6000 },
    ],
    builtin: true,
  },

  // —— 封面 / 封底 ——
  {
    id: 'b-coat-157',
    group: '纸张 · 封面卡纸',
    name: '铜版纸 157g',
    desc: '6,200 元/吨',
    target: 'cover',
    values: [
      { path: 'gram', value: 157 },
      { path: 'ton', value: 6200 },
    ],
    builtin: true,
  },
  {
    id: 'b-coat-200',
    group: '纸张 · 封面卡纸',
    name: '铜版纸 200g',
    desc: '6,200 元/吨',
    target: 'back',
    values: [
      { path: 'gram', value: 200 },
      { path: 'ton', value: 6200 },
    ],
    builtin: true,
  },
  {
    id: 'b-coat-250',
    group: '纸张 · 封面卡纸',
    name: '铜版纸 250g',
    desc: '6,800 元/吨',
    target: 'cover',
    values: [
      { path: 'gram', value: 250 },
      { path: 'ton', value: 6800 },
    ],
    builtin: true,
  },
  {
    id: 'b-card-300',
    group: '纸张 · 封面卡纸',
    name: '白卡纸 300g',
    desc: '7,200 元/吨',
    target: 'cover',
    values: [
      { path: 'gram', value: 300 },
      { path: 'ton', value: 7200 },
    ],
    builtin: true,
  },
  {
    id: 'b-kraft-150',
    group: '纸张 · 封面卡纸',
    name: '牛皮纸 150g',
    desc: '6,500 元/吨',
    target: 'cover',
    values: [
      { path: 'gram', value: 150 },
      { path: 'ton', value: 6500 },
    ],
    builtin: true,
  },

  // —— 灰板 ——
  {
    id: 'b-gray-600',
    group: '纸张 · 灰板',
    name: '灰板 600g',
    desc: '4,500 元/吨',
    target: 'gray',
    values: [
      { path: 'gram', value: 600 },
      { path: 'ton', value: 4500 },
    ],
    builtin: true,
  },
  {
    id: 'b-gray-800',
    group: '纸张 · 灰板',
    name: '灰板 800g',
    desc: '4,600 元/吨',
    target: 'gray',
    values: [
      { path: 'gram', value: 800 },
      { path: 'ton', value: 4600 },
    ],
    builtin: true,
  },

  // —— 工艺单价 ——
  {
    id: 'b-foil-1',
    group: '工艺 · 烫金 / UV',
    name: '烫金 0.10 元/手',
    desc: '常规金/银',
    target: 'cover',
    values: [{ path: 'foilPrice', value: 0.1 }],
    builtin: true,
  },
  {
    id: 'b-foil-08',
    group: '工艺 · 烫金 / UV',
    name: '烫金 0.08 元/手',
    desc: '小面积单色',
    target: 'cover',
    values: [{ path: 'foilPrice', value: 0.08 }],
    builtin: true,
  },
  {
    id: 'b-uv-09',
    group: '工艺 · 烫金 / UV',
    name: 'UV 0.09 元/手',
    desc: '局部上光',
    target: 'cover',
    values: [{ path: 'uvPrice', value: 0.09 }],
    builtin: true,
  },
  {
    id: 'b-uv-07',
    group: '工艺 · 烫金 / UV',
    name: 'UV 0.07 元/手',
    desc: '满版上光',
    target: 'cover',
    values: [{ path: 'uvPrice', value: 0.07 }],
    builtin: true,
  },

  // —— 装订 ——
  {
    id: 'b-coil-35',
    group: '装订 · 线圈 / 包装',
    name: '线圈 0.35 元/个',
    desc: '常规黑色',
    target: 'misc',
    values: [{ path: 'coilPrice', value: 0.35 }],
    builtin: true,
  },
  {
    id: 'b-coil-30',
    group: '装订 · 线圈 / 包装',
    name: '线圈 0.30 元/个',
    desc: '批量价',
    target: 'misc',
    values: [{ path: 'coilPrice', value: 0.3 }],
    builtin: true,
  },
  {
    id: 'b-binding',
    group: '装订 · 线圈 / 包装',
    name: '装订 0.28 元/本',
    desc: '打孔穿线圈',
    target: 'misc',
    values: [{ path: 'bindingFee', value: 0.28 }],
    builtin: true,
  },
  {
    id: 'b-pack',
    group: '装订 · 线圈 / 包装',
    name: '包装 0.22 元/本',
    desc: 'OPP 袋 + 纸箱',
    target: 'misc',
    values: [{ path: 'packagingFee', value: 0.22 }],
    builtin: true,
  },
];

export const PRESET_TARGETS: Array<{ value: string; label: string }> = [
  { value: 'inner', label: '内页' },
  { value: 'liner', label: '衬纸' },
  { value: 'cover', label: '封面' },
  { value: 'back', label: '封底' },
  { value: 'gray', label: '灰板' },
  { value: 'misc', label: '线圈 / 装订 / 包装' },
];
