export type FieldKind = 'number' | 'select' | 'check';

export interface FieldOption {
  value: string;
  label: string;
}

export interface FieldDef {
  /** 数据路径，如 inner.len */
  path: string;
  label: string;
  unit?: string;
  kind?: FieldKind;
  step?: number;
  min?: number;
  digits?: number;
  options?: FieldOption[];
  /** 在网格中占两列 */
  span?: 2;
}

export interface ProcessDef {
  /** 勾选路径 */
  path: string;
  label: string;
  /** 单价路径（可选，覆膜没有单价） */
  pricePath?: string;
  priceLabel?: string;
  priceUnit?: string;
  priceDigits?: number;
  priceStep?: number;
  /** 是否默认勾选 */
  desc?: string;
}

export type ModuleKind = 'plain' | 'process' | 'gray' | 'misc' | 'waste' | 'profit';

export interface ModuleDef {
  id: 'inner' | 'liner' | 'cover' | 'back' | 'gray' | 'misc' | 'waste' | 'profit';
  no: string;
  name: string;
  desc: string;
  kind: ModuleKind;
  fields: FieldDef[];
  process?: ProcessDef[];
  /** 模块说明（脚注） */
  footNote?: string;
}

const paperFields = (prefix: string): FieldDef[] => [
  { path: `${prefix}.len`, label: '长', unit: 'm', step: 0.005, digits: 3 },
  { path: `${prefix}.wid`, label: '宽', unit: 'm', step: 0.005, digits: 3 },
  { path: `${prefix}.gram`, label: '克重', unit: 'g/m²', step: 10 },
  { path: `${prefix}.ton`, label: '吨价', unit: '元/吨', step: 100 },
  { path: `${prefix}.sheets`, label: '每本张数', unit: '张', step: 1 },
  { path: `${prefix}.paperWaste`, label: '纸张损耗', unit: '%', step: 0.5, digits: 2 },
  { path: `${prefix}.imposition`, label: '拼版数', unit: '面/版', step: 1 },
  { path: `${prefix}.wasteSheets`, label: '备损张数', unit: '张', step: 50 },
  {
    path: `${prefix}.printSide`,
    label: '印刷面',
    kind: 'select',
    options: [
      { value: 'single', label: '单面' },
      { value: 'double', label: '双面' },
    ],
  },
  { path: `${prefix}.setupFee`, label: '上机费', unit: '元', step: 10 },
  { path: `${prefix}.pricePerPrint`, label: '印工单价', unit: '元/印', step: 0.001, digits: 3 },
];

export const MODULES: ModuleDef[] = [
  {
    id: 'inner',
    no: '01',
    name: '内页',
    desc: '纸张 + 印刷',
    kind: 'plain',
    fields: paperFields('inner'),
    footNote: '印张 = 订单数×每本张数÷拼版数（向上取整）+ 备损张数；双面按两倍印次计。',
  },
  {
    id: 'liner',
    no: '02',
    name: '衬纸',
    desc: '纸张 + 印刷 · 算法同内页',
    kind: 'plain',
    fields: paperFields('liner'),
    footNote: '衬纸算法与内页完全一致；不要衬纸时把「每本张数」填 0，整块（纸 + 上机费 + 备损）都不计。',
  },
  {
    id: 'cover',
    no: '03',
    name: '封面',
    desc: '纸张 + 印刷 + 后工艺',
    kind: 'process',
    fields: paperFields('cover'),
    process: [
      { path: 'cover.laminate', label: '覆膜', desc: '面积×0.38×1.1，最低 60 元' },
      {
        path: 'cover.foil',
        label: '烫金',
        pricePath: 'cover.foilPrice',
        priceLabel: '烫金单价',
        priceUnit: '元/手',
        priceStep: 0.01,
      },
      {
        path: 'cover.uv',
        label: 'UV',
        pricePath: 'cover.uvPrice',
        priceLabel: 'UV 单价',
        priceUnit: '元/手',
        priceStep: 0.01,
      },
    ],
    footNote: '烫金 / UV 按手计价：每手本数 = 订单数 ÷ 拼版数。「每本张数」填 0 时整块（含后工艺）不计。',
  },
  {
    id: 'back',
    no: '04',
    name: '封底',
    desc: '纸张 + 印刷 + 后工艺',
    kind: 'process',
    fields: paperFields('back'),
    process: [
      { path: 'back.laminate', label: '覆膜', desc: '面积×0.38×1.1，最低 60 元' },
      {
        path: 'back.foil',
        label: '烫金',
        pricePath: 'back.foilPrice',
        priceLabel: '烫金单价',
        priceUnit: '元/手',
        priceStep: 0.01,
      },
      {
        path: 'back.uv',
        label: 'UV',
        pricePath: 'back.uvPrice',
        priceLabel: 'UV 单价',
        priceUnit: '元/手',
        priceStep: 0.01,
      },
    ],
    footNote: '封底与封面算法一致，单价通常更低；「每本张数」填 0 时整块不计。',
  },
  {
    id: 'gray',
    no: '05',
    name: '灰板',
    desc: '硬纸板 · 无印刷',
    kind: 'gray',
    fields: [
      { path: 'gray.len', label: '长', unit: 'm', step: 0.005, digits: 3 },
      { path: 'gray.wid', label: '宽', unit: 'm', step: 0.005, digits: 3 },
      { path: 'gray.gram', label: '克重', unit: 'g/m²', step: 50 },
      { path: 'gray.ton', label: '吨价', unit: '元/吨', step: 100 },
      { path: 'gray.sheetsPerBook', label: '每本块数', unit: '块', step: 1 },
      { path: 'gray.paperWaste', label: '纸张损耗', unit: '%', step: 0.5, digits: 2 },
    ],
    footNote: '灰板只算纸张：张价 × 每本块数 × (1 + 损耗)；每本块数填 0 即不计。',
  },
  {
    id: 'misc',
    no: '06',
    name: '线圈 · 装订 · 包装',
    desc: '按本计费',
    kind: 'misc',
    fields: [
      { path: 'misc.coilPrice', label: '线圈单价', unit: '元/个', step: 0.01 },
      { path: 'misc.coilsPerBook', label: '每本线圈数', unit: '个', step: 1 },
      { path: 'misc.bindingFee', label: '装订加工费', unit: '元/本', step: 0.01 },
      { path: 'misc.packagingFee', label: '包装费', unit: '元/本', step: 0.01 },
    ],
    footNote: '全部按本计，不随批量摊薄。',
  },
  {
    id: 'waste',
    no: '07',
    name: '固定杂费与损耗',
    desc: '一次性费用 + 比例损耗',
    kind: 'waste',
    fields: [
      { path: 'misc.fixedOverhead', label: '固定杂费', unit: '元', step: 10 },
      { path: 'misc.wasteRate', label: '订单损耗率', unit: '%', step: 0.1, digits: 2 },
    ],
    footNote: '固定杂费按订单数摊到每本；订单损耗率在加完杂费后的总额上计提。',
  },
  {
    id: 'profit',
    no: '08',
    name: '利润与税',
    desc: '以订单总成本为基数',
    kind: 'profit',
    fields: [
      { path: 'profitTax.profitRate', label: '利润率', unit: '%', step: 1, digits: 2 },
      { path: 'profitTax.taxRate', label: '税率', unit: '%', step: 1, digits: 2 },
    ],
    footNote: '利润与税都以成本为基数上浮，不是从售价里倒扣。',
  },
];

export const MODULE_BY_ID = Object.fromEntries(MODULES.map((m) => [m.id, m])) as Record<
  ModuleDef['id'],
  ModuleDef
>;

/** 结果明细里各模块的顺序与名称 */
export const BREAK_LABELS: Array<{ key: string; no: string; name: string }> = [
  { key: 'inner', no: '01', name: '内页' },
  { key: 'liner', no: '02', name: '衬纸' },
  { key: 'cover', no: '03', name: '封面' },
  { key: 'back', no: '04', name: '封底' },
  { key: 'gray', no: '05', name: '灰板' },
  { key: 'coil', no: '06', name: '线圈' },
  { key: 'binding', no: '07', name: '装订' },
  { key: 'pack', no: '08', name: '包装' },
  { key: 'fixed', no: '09', name: '固定杂费' },
  { key: 'waste', no: '10', name: '订单损耗' },
  { key: 'profit', no: '11', name: '利润' },
  { key: 'tax', no: '12', name: '税额' },
];
